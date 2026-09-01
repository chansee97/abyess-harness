/**
 * Session service: an event-sourced, append-only log PER SESSION. Everything
 * the model sees is derived from a session's log ("model-visible means
 * logged"), and every append is broadcast as `session/event` (carrying the
 * session id) so observers (persistence, UI, telemetry) can follow without
 * touching the loop. The server holds NO "active session" — the browser owns
 * selection and addresses sessions by id.
 */

import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@abyss-harness/cordis'
import type { ChatMessage, LlmCallUsage, ToolCall } from '@abyss-harness/session/types'

/** Why a turn ended. `complete` = model stopped calling tools; `stopped` = user abort; `error` = failure; `max-steps` = safety bound hit; `max-tokens` = provider cut the output at the token ceiling. */
export type TurnEndReason = 'complete' | 'stopped' | 'error' | 'max-steps' | 'max-tokens'

/** Durable session facts. Extend this map to add new event kinds. */
export interface SessionEventMap {
  'turn/start': { seq: number }
  'turn/end': { seq: number; reason?: TurnEndReason }
  'turn/error': { message: string }
  'user/message': { message: ChatMessage }
  'assistant/message': { message: ChatMessage }
  'tool/call': { call: ToolCall }
  'tool/result': { callId: string; content: string; denied?: boolean }
  /** One settled model call's metering + timing record (token-meter's fold). */
  'llm/call': LlmCallUsage
  'session/title': { title: string }
  /** Per-session file-policy override (sandbox-policy's fold; last wins). */
  'sandbox/mode': { mode: string }
  /** A policy-gated tool call was allowed, denied, or escalated by the file policy. */
  'tool/policy': { tool: string; mode: string; decision: 'allow' | 'escalate' | 'deny'; reason?: string }
}

export type SessionEventType = keyof SessionEventMap & string

export interface SessionEvent {
  seq: number
  type: SessionEventType
  payload: unknown
  /** Wall-clock epoch ms at append; old persisted events may lack it. */
  time?: number
}

/** One row of the conversation history list. */
export interface SessionSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** True while the log is empty — drives the "new chat" empty state and reuse. */
  blank: boolean
}

declare module '@abyss-harness/cordis' {
  interface Context {
    session: SessionService
  }

  interface Events {
    /**
     * A durable fact was appended to a session's log. Fire-and-forget
     * broadcast; listener failures are logged, never fail the commit.
     *
     * @mode emit
     */
    'session/event'(event: { sessionId: string; event: SessionEvent }): void
    /** A session was created, or a blank one was reused by create(). */
    'session/created'(session: SessionSummary): void
    /** A session was deleted. */
    'session/deleted'(sessionId: string): void
  }
}

interface SessionRecord {
  createdAt: number
  log: SessionEvent[]
}

/** Derive the fallback title from the first user message (whitespace-collapsed, ≤30 chars). */
function fallbackTitle(events: readonly SessionEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const content = (event.payload as { message: { content: string | null } }).message.content
    if (!content) continue
    const flat = content.replace(/\s+/g, ' ').trim()
    return flat.length > 30 ? `${flat.slice(0, 30)}…` : flat
  }
  return undefined
}

export class SessionService extends Service {
  private readonly store = new Map<string, SessionRecord>()

  constructor(ctx: Context) {
    super(ctx, 'session')
  }

  /**
   * Create a session, reusing the newest blank one so "new chat" never
   * accumulates empties. Emits `session/created` either way.
   */
  create(): string {
    let newestId: string | undefined
    let newestCreatedAt = -1
    for (const [id, record] of this.store) {
      if (record.log.length === 0 && record.createdAt > newestCreatedAt) {
        newestCreatedAt = record.createdAt
        newestId = id
      }
    }
    if (newestId !== undefined) {
      this.ctx.emit('session/created', this.summary(newestId)!)
      return newestId
    }
    return this.mint()
  }

  private mint(): string {
    let id: string
    do {
      id = randomUUID()
    } while (this.store.has(id))
    this.store.set(id, { createdAt: Date.now(), log: [] })
    this.ctx.emit('session/created', this.summary(id)!)
    return id
  }

  has(id: string): boolean {
    return this.store.has(id)
  }

  /** Immutable snapshot of a session's log so far (empty for unknown ids). */
  events(id: string): readonly SessionEvent[] {
    return this.store.get(id)?.log ?? []
  }

  /** Append one durable fact to a session and broadcast it. */
  append<K extends keyof SessionEventMap & string>(id: string, type: K, payload: SessionEventMap[K]): SessionEvent {
    const record = this.store.get(id)
    if (!record) throw new Error(`session: unknown session "${id}"`)
    const event: SessionEvent = { seq: record.log.length, type, payload, time: Date.now() }
    record.log.push(event)
    this.ctx.emit('session/event', { sessionId: id, event })
    return event
  }

  /**
   * Project the model-visible history out of one session's log. This is the
   * only place conversation history comes from — no parallel in-memory state.
   */
  deriveMessages(id: string): ChatMessage[] {
    const messages: ChatMessage[] = []
    for (const event of this.store.get(id)?.log ?? []) {
      switch (event.type) {
        case 'user/message':
        case 'assistant/message':
          messages.push((event.payload as { message: ChatMessage }).message)
          break
        case 'tool/result':
          messages.push({
            role: 'tool',
            content: (event.payload as { content: string }).content,
            toolCallId: (event.payload as { callId: string }).callId,
          })
          break
        // turn boundaries carry no model-visible content
      }
    }
    return messages
  }

  /** Last `session/title` event wins; else the first-user-message fallback; else placeholder. */
  titleOf(id: string): string {
    const record = this.store.get(id)
    if (!record) return '新对话'
    for (let i = record.log.length - 1; i >= 0; i--) {
      const event = record.log[i]
      if (event.type === 'session/title') {
        return (event.payload as { title: string }).title
      }
    }
    return fallbackTitle(record.log) ?? '新对话'
  }

  summary(id: string): SessionSummary | undefined {
    const record = this.store.get(id)
    if (!record) return undefined
    const last = record.log[record.log.length - 1]
    return {
      id,
      title: this.titleOf(id),
      createdAt: record.createdAt,
      updatedAt: last?.time ?? record.createdAt,
      blank: record.log.length === 0,
    }
  }

  /** All sessions, newest activity first. */
  list(): SessionSummary[] {
    return [...this.store.keys()]
      .map(id => this.summary(id)!)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Explicit rename: appends a last-wins `session/title` event (persists with the log). */
  rename(id: string, title: string): SessionEvent {
    const clean = title.trim()
    if (!clean) throw new Error('session: title is required')
    return this.append(id, 'session/title', { title: clean })
  }

  delete(id: string): void {
    if (!this.store.delete(id)) return
    this.ctx.emit('session/deleted', id)
  }

  /** Restore a persisted session before any append of this process. */
  load(id: string, events: readonly SessionEvent[]): void {
    if (this.store.has(id)) throw new Error(`session: "${id}" already exists`)
    this.store.set(id, { createdAt: events[0]?.time ?? Date.now(), log: [...events] })
  }
}

export const name = 'session'

export function apply(ctx: Context) {
  ctx.plugin(SessionService)
}
