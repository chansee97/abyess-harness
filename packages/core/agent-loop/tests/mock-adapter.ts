import type { GenerateOptions, StreamChunk } from '@abyss-harness/session/types'

/** One scripted model call: fixed chunks, a function of the request, or 'hang'
 *  (stream one delta, then wait until the request's signal aborts). */
export type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]) | 'hang'

/** A plain text answer that ends the turn. */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'delta', text },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** A text answer cut off at the output-token ceiling, with reported usage. */
export function maxTokensResponse(text: string): StreamChunk[] {
  return [
    { type: 'delta', text },
    { type: 'finish', reason: { kind: 'max-tokens' }, usage: { inputTokens: 10, outputTokens: 7 } },
  ]
}

/** One model answer requesting a single tool call. */
export function toolCallResponse(id: string, name: string, args: Record<string, unknown> = {}): StreamChunk[] {
  return toolCallsResponse([{ id, name, args }])
}

/** One model answer requesting several tool calls in model order. */
export function toolCallsResponse(calls: { id: string; name: string; args?: Record<string, unknown> }[]): StreamChunk[] {
  return [
    ...calls.map(({ id, name, args = {} }): StreamChunk => ({
      type: 'tool_call',
      call: { id, name, argsText: JSON.stringify(args), arguments: args },
    })),
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Script-driven adapter: each model call consumes the next script entry.
 *  Records every request for assertions. */
export class MockAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {}

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('MockAdapter: script exhausted')
    if (entry === 'hang') {
      yield { type: 'delta', text: 'partial ' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      return
    }
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}
