/**
 * Shared vocabulary: the message and stream shapes every LLM adapter speaks,
 * independent of any provider wire format.
 */

/** One tool call requested by the model. */
export interface ToolCallRequest {
  /** Correlation id issued by the provider (or the mock). */
  id: string
  name: string
  /** Raw JSON text of the arguments, exactly as streamed. */
  argsText: string
}

/** A parsed tool call with decoded arguments. */
export interface ToolCall {
  id: string
  name: string
  /** Raw JSON text of the arguments, exactly as the model produced it. */
  argsText: string
  /** Decoded arguments; validated against the tool's schema before execute. */
  arguments: Record<string, unknown>
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

/** Provider-neutral chat message; this is what the session log projects to. */
export interface ChatMessage {
  role: ChatRole
  content: string | null
  /** Reasoning/rethinking content (e.g. DeepSeek reasoning_content). Display-only: never sent back to the provider. */
  reasoning?: string
  /**
   * Present on assistant messages committed after an abort cut the stream:
   * the content is the prefix the user already saw. It stays in the derived
   * history so the next request replays the visible prefix, and the provider
   * ignores the extra field (toWire drops unknown fields).
   */
  interrupted?: boolean
  /** Present on assistant messages that request tools. */
  toolCalls?: ToolCall[]
  /** Present on role:'tool' messages answering a call. */
  toolCallId?: string
  toolName?: string
}

/** Provider-reported token usage for one model call. The cache buckets are
 *  present only when the provider reports them; `inputTokens` stays the
 *  TOTAL prompt-side figure (uncached + cache read + cache write). */
export interface StreamUsage {
  inputTokens: number
  outputTokens: number
  /** Prompt tokens served from the provider's prompt cache. */
  cacheReadTokens?: number
  /** Prompt tokens written to (or missing from) the provider's prompt cache. */
  cacheWriteTokens?: number
}

/** One settled model call's metering record, appended to the session log as
 *  a durable `llm/call` event so stats survive restarts (fold the log). */
export interface LlmCallUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Epoch ms when the model call started (≈ step start). */
  startAt: number
  /** Start → first delta/reasoning chunk, when one arrived. */
  ttftMs?: number
  /** Epoch ms when the call finished (including failures/aborts). */
  endAt: number
}

/** One chunk of a streaming model response. */
export type StreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | {
    type: 'finish'
    reason: { kind: 'stop' } | { kind: 'max-tokens' } | { kind: 'error'; message: string }
    /** Exact usage when the provider reported one (e.g. OpenAI stream usage). */
    usage?: StreamUsage
  }

/** A tool's provider-neutral description: handed to the provider alongside
 *  messages so it can exercise native function calling. */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema (object form) describing the parameters. */
  parameters: Record<string, unknown>
}

/** Options for one model call. */
export interface GenerateOptions {
  route: string
  messages: ChatMessage[]
  /** Tools the model may call, when the caller (the agent loop) offers them. */
  tools?: ToolSpec[]
  signal?: AbortSignal
  /** Session the call belongs to, when the loop knows it (metering, compaction). */
  sessionId?: string
}
