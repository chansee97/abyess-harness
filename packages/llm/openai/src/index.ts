/**
 * OpenAI-compatible LLM adapter (chat completions with SSE streaming).
 *
 * Works with DeepSeek, Moonshot, OpenRouter, vLLM, Ollama's OpenAI shim, and
 * any other `/chat/completions` endpoint. Credentials resolve from an
 * environment variable at request time — never inlined in config.
 */

import type { Context } from '@abyss-harness/cordis'
import type { GenerateOptions, StreamChunk, ToolCall } from '@abyss-harness/session/types'

export const name = 'llm-openai'
export const inject = ['llm']

export interface Config {
  /** Route name this adapter registers under; requests select it by name. */
  route: string
  /** API root, e.g. `https://api.deepseek.com/v1`. */
  baseUrl: string
  /** Environment variable holding the API key. */
  apiKeyEnv?: string
  model: string
  maxTokens?: number
}

interface WireMessage {
  role: string
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

/** Accumulated state of one streamed tool call. */
interface PartialCall {
  id: string
  name: string
  args: string
}

function safeParse(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args || '{}')
  } catch {
    return {}
  }
}

function toWire(options: GenerateOptions): WireMessage[] {
  return options.messages.map(message => ({
    role: message.role,
    content: message.content,
    ...(message.toolCalls?.length ? {
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.argsText },
      })),
    } : {}),
    ...(message.role === 'tool' ? { tool_call_id: message.toolCallId } : {}),
  }))
}

async function* sseToChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // Tool-call deltas arrive as fragments across many events; accumulate and
  // emit each call once its first argument fragment lands after the name.
  const partials = new Map<number, PartialCall>()
  const emitted = new Set<string>()
  // Provider-reported termination and usage, usually on the final chunks
  // (OpenAI sends usage in a trailing chunk with empty choices; DeepSeek
  // attaches it to the last choice-bearing chunk).
  let finishReason: 'stop' | 'max-tokens' | undefined
  let usage: { inputTokens: number; outputTokens: number } | undefined

  /** Emit every accumulated call that has a name. */
  function* flushPartials(): Generator<StreamChunk> {
    for (const partial of partials.values()) {
      if (partial.name && !emitted.has(partial.id)) {
        emitted.add(partial.id)
        yield { type: 'tool_call', call: { id: partial.id, name: partial.name, argsText: partial.args || '{}', arguments: safeParse(partial.args) } }
      }
    }
  }

  /** The terminal finish chunk, carrying the provider's termination and usage. */
  function finishChunk(): StreamChunk {
    return {
      type: 'finish',
      reason: finishReason === 'max-tokens' ? { kind: 'max-tokens' } : { kind: 'stop' },
      ...(usage ? { usage } : {}),
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      // [DONE] and stream end both flush accumulated tool-call fragments —
      // an early return here would silently drop them. The finish chunk is
      // emitted here too, so it always arrives after every content delta.
      if (payload === '[DONE]') {
        yield* flushPartials()
        yield finishChunk()
        return
      }
      let event: any
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }
      if (event.usage) {
        // inputTokens stays the TOTAL prompt-side figure; the cache buckets
        // decompose it when the provider reports them. DeepSeek exposes
        // hit/miss counters; OpenAI exposes the cached subset of prompt tokens.
        const promptTokens = event.usage.prompt_tokens ?? 0
        const cachedTokens: number | undefined
          = event.usage.prompt_cache_hit_tokens
            ?? event.usage.prompt_tokens_details?.cached_tokens
            ?? undefined
        const cacheWriteTokens: number | undefined
          = event.usage.prompt_cache_miss_tokens
            ?? (cachedTokens !== undefined ? promptTokens - cachedTokens : undefined)
        usage = {
          inputTokens: promptTokens,
          outputTokens: event.usage.completion_tokens ?? 0,
          ...(cachedTokens !== undefined ? { cacheReadTokens: cachedTokens } : {}),
          ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
        }
      }
      for (const choice of event.choices ?? []) {
        const delta = choice.delta ?? {}
        if (delta.content) yield { type: 'delta', text: delta.content }
        // DeepSeek / OpenAI o-series stream their reasoning chain here.
        if (delta.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content }
        for (const piece of delta.tool_calls ?? []) {
          const index: number = piece.index ?? 0
          const partial = partials.get(index) ?? { id: '', name: '', args: '' }
          if (piece.id) partial.id = piece.id
          if (piece.function?.name) partial.name += piece.function.name
          if (piece.function?.arguments) partial.args += piece.function.arguments
          partials.set(index, partial)
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason === 'length' ? 'max-tokens' : 'stop'
        }
      }
    }
  }

  // Stream closed without [DONE]: flush any complete accumulated calls and
  // still report termination + usage.
  yield* flushPartials()
  yield finishChunk()
}

export function apply(ctx: Context, config: Config) {
  async function* stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const apiKeyEnv = config.apiKeyEnv ?? 'OPENAI_API_KEY'
    const apiKey = process.env[apiKeyEnv]
    if (!apiKey) throw new Error(`llm-openai: environment variable ${apiKeyEnv} is not set`)

    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: toWire(options),
        // Native function calling: without the wire `tools` list the provider
        // cannot emit structured tool calls at all.
        ...(options.tools?.length ? {
          tools: options.tools.map(tool => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        } : {}),
        stream: true,
        // Ask the provider to report token usage on the final stream chunk.
        stream_options: { include_usage: true },
        ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
      }),
      signal: options.signal,
    })

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => response.statusText)
      yield { type: 'finish', reason: { kind: 'error', message: `${response.status}: ${detail}` } }
      return
    }

    let sawFinish = false
    for await (const chunk of sseToChunks(response.body)) {
      if (options.signal?.aborted) return
      yield chunk
      if (chunk.type === 'finish') sawFinish = true
    }
    if (!sawFinish) {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }

  ctx.llm.register(config.route, { stream })
}
