/**
 * Token meter: metering + session stats, aligned with dsh's StatsLine. Hooks
 * the `llm/stream` waterfall and appends one durable `llm/call` event per
 * settled model call (tokens + timing) to the session log — so the numbers
 * survive restarts by folding the persisted log, exactly like any other
 * session fact. Token counts are heuristic when the provider reports none:
 * CJK characters count ~1 token each, everything else ~4 characters per
 * token. Good enough to display usage; never billing-grade.
 *
 * The service is optional to consumers (ctx.get('tokenMeter')); every
 * settled call emits `tokenMeter/stats` carrying the session's folded
 * totals for the UI.
 */

import { Service, type Context } from '@abyss-harness/cordis'
import type { GenerateOptions, StreamChunk, StreamUsage, ChatMessage, LlmCallUsage } from '@abyss-harness/session/types'

export const name = 'token-meter'
export const inject = ['llm', 'session']

/** Provider- or heuristic-derived token totals for one session. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Window-scoped display totals folded from the session log (the fold of
 *  dsh's sessionStats + tokenUsage projections). */
export interface SessionStats {
  /** Durable turn/start events. */
  turns: number
  /** Durable assistant messages (one per settled step). */
  steps: number
  /** Summed model-call wall time (llm/call startAt → endAt); 0 when none. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair. */
  toolMs: number
  /** Summed time-to-first-token over `ttftSteps`; 0 when none record it. */
  ttftMs: number
  /** Model calls carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time (first token → finish) over decode-timed calls. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed calls. */
  decodeTokens: number
  /** Token totals over every settled call. */
  usage: TokenUsage
}

declare module '@abyss-harness/cordis' {
  interface Context {
    tokenMeter?: TokenMeterService
  }

  interface Events {
    /**
     * A model call settled and the session's folded stats changed.
     *
     * @mode emit
     */
    'tokenMeter/stats'(update: { sessionId: string; stats: SessionStats }): void
  }
}

/** Rough token count for arbitrary text: CJK ~1/char, other ~1/4 chars. */
function approxTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (const char of text) {
    if (char.charCodeAt(0) > 0x2e7f) cjk++
  }
  return cjk + Math.ceil((text.length - cjk) / 4)
}

/** Everything the provider sees of one message, as flat text. */
function messageText(message: ChatMessage): string {
  let text = message.content ?? ''
  for (const call of message.toolCalls ?? []) {
    text += call.name + call.argsText
  }
  return text
}

const ZERO_USAGE = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0 })

const ZERO_STATS = (): SessionStats => ({
  turns: 0,
  steps: 0,
  llmMs: 0,
  toolMs: 0,
  ttftMs: 0,
  ttftSteps: 0,
  decodeMs: 0,
  decodeTokens: 0,
  usage: ZERO_USAGE(),
})

export class TokenMeterService extends Service {
  /** Memoized fold per session, keyed by log length (append-only, so a
   *  stable length means a stable fold). */
  private readonly folded = new Map<string, { logLength: number; stats: SessionStats }>()

  constructor(ctx: Context) {
    super(ctx, 'tokenMeter')
  }

  /** Fold the session's durable log into display totals. */
  stats(sessionId: string): SessionStats {
    const events = this.ctx.session.events(sessionId)
    const cached = this.folded.get(sessionId)
    if (cached && cached.logLength === events.length) return cached.stats

    const stats = ZERO_STATS()
    // tool/call → tool/result correlation (a result always follows its call).
    const openCalls = new Map<string, number>()
    for (const event of events) {
      if (event.type === 'turn/start') {
        stats.turns++
      } else if (event.type === 'assistant/message') {
        stats.steps++
      } else if (event.type === 'tool/call') {
        openCalls.set((event.payload as { call: { id: string } }).call.id, event.time ?? 0)
      } else if (event.type === 'tool/result') {
        const calledAt = openCalls.get((event.payload as { callId: string }).callId)
        if (calledAt !== undefined) {
          openCalls.delete((event.payload as { callId: string }).callId)
          stats.toolMs += Math.max(0, (event.time ?? 0) - calledAt)
        }
      } else if (event.type === 'llm/call') {
        const call = event.payload as LlmCallUsage
        stats.llmMs += Math.max(0, call.endAt - call.startAt)
        if (call.ttftMs !== undefined) {
          stats.ttftMs += Math.max(0, call.ttftMs)
          stats.ttftSteps++
          // Decode window: first token → finish, same call as the tokens.
          stats.decodeMs += Math.max(0, call.endAt - call.startAt - call.ttftMs)
          stats.decodeTokens += call.outputTokens
        }
        stats.usage.inputTokens += call.inputTokens
        stats.usage.outputTokens += call.outputTokens
        if (call.cacheReadTokens !== undefined) {
          stats.usage.cacheReadTokens = (stats.usage.cacheReadTokens ?? 0) + call.cacheReadTokens
        }
        if (call.cacheWriteTokens !== undefined) {
          stats.usage.cacheWriteTokens = (stats.usage.cacheWriteTokens ?? 0) + call.cacheWriteTokens
        }
      }
    }
    this.folded.set(sessionId, { logLength: events.length, stats })
    return stats
  }

  /** Append one settled call as a durable `llm/call` event, then broadcast
   *  the session's refreshed stats. */
  private record(sessionId: string, call: LlmCallUsage): void {
    if (!this.ctx.session.has(sessionId)) return
    this.ctx.session.append(sessionId, 'llm/call', call)
    this.ctx.emit('tokenMeter/stats', { sessionId, stats: this.stats(sessionId) })
  }

  /** Wrap one model call: meter the request, then the streamed response. */
  async *wrap(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const sessionId = options.sessionId
    const inputTokens = approxTokens(options.messages.map(messageText).join('\n'))
    let outputTokens = 0
    // Exact usage reported by the provider on the finish chunk, when present.
    let exact: StreamUsage | undefined
    const startAt = Date.now()
    let ttftMs: number | undefined
    let endAt = startAt
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'delta' || chunk.type === 'reasoning') {
          ttftMs ??= Date.now() - startAt
          outputTokens += approxTokens(chunk.text)
        } else if (chunk.type === 'tool_call') {
          ttftMs ??= Date.now() - startAt
          outputTokens += approxTokens(chunk.call.name + chunk.call.argsText)
        } else if (chunk.type === 'finish' && chunk.usage) {
          exact = chunk.usage
        }
        yield chunk
      }
    } finally {
      endAt = Date.now()
      if (sessionId !== undefined) {
        // Provider-reported usage wins over the heuristic estimate.
        this.record(sessionId, {
          inputTokens: exact ? exact.inputTokens : inputTokens,
          outputTokens: exact ? exact.outputTokens : outputTokens,
          ...(exact?.cacheReadTokens !== undefined ? { cacheReadTokens: exact.cacheReadTokens } : {}),
          ...(exact?.cacheWriteTokens !== undefined ? { cacheWriteTokens: exact.cacheWriteTokens } : {}),
          startAt,
          ...(ttftMs !== undefined ? { ttftMs } : {}),
          endAt,
        })
      }
    }
  }
}

export function apply(ctx: Context) {
  // The Service base class registers itself on construction (like
  // SessionService/ToolRegistry) — no separate ctx.provide here.
  const service = new TokenMeterService(ctx)
  ctx.on('llm/stream', (options, next) => service.wrap(options, next))
  // The fold also rides assistant messages (steps) and tool results
  // (toolMs); re-broadcast when those land so the live stats strip updates
  // mid-turn, not only when the next model call settles. `llm/call` itself
  // already broadcasts from record().
  ctx.on('session/event', ({ sessionId, event }) => {
    if (event.type === 'assistant/message' || event.type === 'tool/result') {
      ctx.emit('tokenMeter/stats', { sessionId, stats: service.stats(sessionId) })
    }
  })
}
