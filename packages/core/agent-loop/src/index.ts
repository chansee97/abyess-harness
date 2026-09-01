/**
 * The agent driver: one turn = zero or more steps; a step = one model request
 * plus the tool calls it makes. History is derived from the target session's
 * log on every step, so the log stays the single source of truth. A turn runs
 * against exactly one session, addressed by id (the browser owns selection).
 *
 * Concurrency: one turn per session at a time (a per-session lock); a second
 * run() against a busy session is rejected with a durable `turn/error` fact.
 * Cancellation: each turn owns an AbortController; stop() aborts the model
 * stream and any in-flight tool call (including pending approvals, which the
 * approval service settles as denied on abort). Aborted turns stay
 * REPLAYABLE: text the user already saw is committed as an `interrupted`
 * assistant message, and tool calls the abort prevented from dispatching get
 * synthetic error results — an OpenAI-compatible provider rejects a
 * tool_calls message whose calls have no matching tool results. Failure
 * visibility: LLM and infrastructure errors land in the log as `turn/error`
 * and end the turn with reason `error`; the step bound ends it with
 * `max-steps`, a provider length cut with `max-tokens`.
 *
 * Tool scheduling: parallel-safe tools (read-only lookups) run in a bounded
 * rolling pool; exclusive tools (default) are barriers. Results and their
 * session events always commit in model order. Steering: text queued via
 * steer() joins the log as user messages at the next step boundary, so a
 * running turn can be redirected without stopping it.
 */

import type { Context } from '@abyss-harness/cordis'
import type { ChatMessage, StreamChunk, ToolCall, ToolSpec } from '@abyss-harness/session/types'
import type { TurnEndReason } from '@abyss-harness/session'

export const name = 'agent-loop'
export const inject = ['llm', 'session', 'tools', 'systemPrompt']

export interface Config {
  route: string
  /** Safety bound on steps per turn. */
  maxSteps?: number
  /** Bound on concurrently running parallel-safe tool calls. Default 4. */
  maxParallelToolCalls?: number
  persona?: string
}

/** Decision at the `agent/pre-step` boundary: enter the step with (possibly rewritten) messages, or reject it. */
export type PreStepDecision =
  | { kind: 'enter'; messages?: ChatMessage[] }
  | { kind: 'reject' }

/** Action after a failed model request: retry it, or let the failure end the turn. */
export type RequestErrorAction =
  | { kind: 'retry' }
  | { kind: 'terminal' }

declare module '@abyss-harness/cordis' {
  interface Context {
    agentLoop: AgentLoop
  }

  interface Events {
    /** One model delta for the currently open turn. Transient: not appended to the session log. */
    'assistant/stream'(stream: { sessionId: string; turnSeq: number; text: string; reasoning?: string }): void
    /** A session's turn started or settled — the authoritative running/idle signal. */
    'agent/status'(status: { sessionId: string; status: 'running' | 'idle' }): void
    /**
     * Intercept the step's message list before it reaches the provider:
     * compaction rewrites it, policies may reject the step. `next()` delegates
     * (entering with the original messages); returning without `next()`
     * replaces the decision. Rejection ends the turn with reason `complete`
     * without a model call.
     *
     * @mode waterfall
     */
    'agent/pre-step'(this: AgentLoop, payload: {
      sessionId: string
      turn: number
      step: number
      /** The user messages the step is about to answer (steering included). */
      messages: ChatMessage[]
      signal: AbortSignal
    }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
    /**
     * A model request failed (thrown error or error finish). Listeners may
     * repair state, wait, and return `{ kind: 'retry' }` — the step is then
     * re-attempted with the same history — or `{ kind: 'terminal' }` /
     * leave it unhandled to end the turn with reason `error`.
     *
     * @mode waterfall
     */
    'agent/request-error'(this: AgentLoop, payload: {
      sessionId: string
      turn: number
      step: number
      failure: { message: string }
      attempt: number
      signal: AbortSignal
    }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
    /**
     * A turn is about to end naturally (no tool or steering continuation).
     * Serial listeners run before the final steering drain — a budget policy
     * can still queue steering to keep the turn open, or observe the boundary.
     *
     * @mode serial
     */
    'agent/turn-stopping'(payload: { sessionId: string; turn: number; signal: AbortSignal }): Promise<void> | void
  }
}

/** Per-session turn state while a turn is being driven. */
interface TurnState {
  controller: AbortController
  /** Text queued by steer(), waiting for the next step boundary. */
  steering: string[]
}

/** How one step ended. */
type StepOutcome = 'done' | 'tools' | 'aborted' | 'request-error'

/** Safety bound on request retries per step (listeners may retry fewer times). */
const MAX_REQUEST_ATTEMPTS = 8

/** Marker for a tool result synthesized for a call the abort never dispatched. */
const ABORTED_BEFORE_DISPATCH = 'Error: tool call aborted before dispatch'

export class AgentLoop {
  constructor(
    private ctx: Context,
    private config: Config,
  ) {}

  /** Sessions with a turn currently being driven (the per-session lock). */
  private readonly active = new Map<string, TurnState>()
  /** Session this loop was last asked to drive (diagnostics only; the turn itself is pinned by argument). */
  private sessionId: string | null = null

  /** True while a turn is running in the given session. */
  isBusy(sessionId: string): boolean {
    return this.active.has(sessionId)
  }

  /** Abort the open turn of a session (model stream + tool calls + pending approvals). */
  stop(sessionId: string): boolean {
    const state = this.active.get(sessionId)
    if (!state) return false
    state.controller.abort()
    return true
  }

  /**
   * Queue text to join the log at the NEXT step boundary of the open turn.
   * Returns false when no turn is open (or it is already aborting) — the
   * caller should fall back to a fresh run().
   */
  steer(sessionId: string, text: string): boolean {
    const state = this.active.get(sessionId)
    if (!state || state.controller.signal.aborted) return false
    state.steering.push(text)
    return true
  }

  /** Run one full turn for a user input in a specific session, streaming deltas. */
  async run(
    sessionId: string,
    userInput: string,
    onDelta?: (text: string) => void,
    onToolCall?: (call: ToolCall) => void,
  ): Promise<void> {
    if (this.active.has(sessionId)) {
      // Reject BEFORE appending the user message: the input stays unsent and
      // the caller (and the UI) sees a durable, visible reason.
      this.ctx.session.append(sessionId, 'turn/error', {
        message: 'session busy: a turn is already running in this session',
      })
      return
    }
    this.sessionId = sessionId
    const session = this.ctx.session
    session.append(sessionId, 'user/message', { message: { role: 'user', content: userInput } })
    await this.driveTurn(sessionId, onDelta, onToolCall)
  }

  /** Continue the turn of a session until the model stops requesting tools (resume support). */
  async driveTurn(
    sessionId: string,
    onDelta?: (text: string) => void,
    onToolCall?: (call: ToolCall) => void,
  ): Promise<void> {
    if (this.active.has(sessionId)) {
      throw new Error('agent-loop: a turn is already running in this session')
    }
    const session = this.ctx.session
    const controller = new AbortController()
    const state: TurnState = { controller, steering: [] }
    this.active.set(sessionId, state)
    this.sessionId = sessionId
    this.ctx.emit('agent/status', { sessionId, status: 'running' })
    try {
      // Capture the turn's start seq whether it begins now or resumes an open turn.
      let turnSeq: number
      if (!this.turnIsOpen(sessionId)) {
        const turnEvent = session.append(sessionId, 'turn/start', { seq: session.events(sessionId).length })
        turnSeq = turnEvent.seq
      } else {
        const events = session.events(sessionId)
        turnSeq = -1
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].type === 'turn/start') {
            turnSeq = events[i].seq
            break
          }
        }
      }

      const maxSteps = this.config.maxSteps ?? 8
      let reason: TurnEndReason = 'complete'
      let completed = false
      try {
        for (let step = 0; step < maxSteps; step++) {
          if (controller.signal.aborted) {
            reason = 'stopped'
            break
          }
          // Steering queued mid-turn joins the log before this step's request.
          this.drainSteering(sessionId)
          // The pre-step seam: policies may rewrite the entering messages or
          // reject the step outright (ends the turn without a model call).
          const decision = await this.ctx.waterfall(
            this, 'agent/pre-step',
            {
              sessionId,
              turn: turnSeq,
              step,
              messages: this.stepMessages(sessionId, step),
              signal: controller.signal,
            },
            (): Promise<PreStepDecision> => Promise.resolve({ kind: 'enter' }),
          )
          if (decision.kind === 'reject') {
            completed = true
            break
          }
          const stepMessages = decision.messages
          let attempt = 0
          let result: Awaited<ReturnType<AgentLoop['step']>>
          while (true) {
            result = await this.step(sessionId, turnSeq, stepMessages ?? this.stepMessages(sessionId, step), controller.signal, onDelta, onToolCall, { turn: turnSeq, step, attempt })
            if (result.outcome !== 'request-error') break
            // The request-error seam: a listener may repair and retry; an
            // unhandled failure is terminal and ends the turn.
            const action = await this.ctx.waterfall(
              this, 'agent/request-error',
              {
                sessionId,
                turn: turnSeq,
                step,
                failure: { message: result.errorMessage ?? 'llm request failed' },
                attempt,
                signal: controller.signal,
              },
              (): Promise<RequestErrorAction> => Promise.resolve({ kind: 'terminal' }),
            )
            if (action.kind !== 'retry' || controller.signal.aborted || attempt + 1 >= MAX_REQUEST_ATTEMPTS) {
              const message = result.errorMessage ?? 'llm request failed'
              session.append(sessionId, 'turn/error', { message })
              reason = 'error'
              completed = true
              break
            }
            attempt++
          }
          if (reason === 'error') break
          if (result.outcome === 'done') {
            completed = true
            if (result.endReason) reason = result.endReason
            // The turn-stopping seam runs before the final steering drain: a
            // budget policy can still observe or extend the boundary.
            await this.ctx.serial('agent/turn-stopping', { sessionId, turn: turnSeq, signal: controller.signal })
            // Steering arrived mid-step: keep the turn open and answer it,
            // instead of silently dropping the queued input.
            if (!result.endReason && this.hasPendingSteering(sessionId)) {
              completed = false
              continue
            }
            break
          }
          if (result.outcome === 'aborted') {
            reason = 'stopped'
            break
          }
        }
        if (!completed && reason === 'complete') {
          // The loop exited on the step bound, not because the model finished.
          reason = controller.signal.aborted ? 'stopped' : 'max-steps'
        }
      } catch (error) {
        if (controller.signal.aborted) {
          // A user abort surfaced as a stream error (fetch rejects on abort):
          // not a failure, just the requested stop.
          reason = 'stopped'
        } else {
          const message = error instanceof Error ? error.message : String(error)
          session.append(sessionId, 'turn/error', { message })
          reason = 'error'
        }
      }
      session.append(sessionId, 'turn/end', { seq: session.events(sessionId).length, reason })
    } finally {
      this.ctx.emit('agent/status', { sessionId, status: 'idle' })
      this.active.delete(sessionId)
    }
  }

  private turnIsOpen(id: string): boolean {
    const events = this.ctx.session.events(id)
    const lastTurnStart = [...events].reverse().find(event => event.type === 'turn/start')
    if (!lastTurnStart) return false
    return !events.some(event =>
      event.type === 'turn/end' && (event.payload as { seq: number }).seq >= lastTurnStart.seq)
  }

  /** Whether un-drained steering input is queued for the open turn. */
  private hasPendingSteering(sessionId: string): boolean {
    const state = this.active.get(sessionId)
    return state !== undefined && state.steering.length > 0
  }

  /** Append queued steering text as user messages, in queue order. */
  private drainSteering(sessionId: string): void {
    const state = this.active.get(sessionId)
    if (!state || state.steering.length === 0) return
    const queued = state.steering.splice(0)
    for (const text of queued) {
      this.ctx.session.append(sessionId, 'user/message', { message: { role: 'user', content: text } })
    }
  }

  /** The step's message list: the freshly assembled system prompt over the
   *  session-derived history. Pre-step listeners may rewrite this. */
  private stepMessages(id: string, step: number): ChatMessage[] {
    const { session, tools, systemPrompt } = this.ctx
    const systemMessage: ChatMessage = {
      role: 'system',
      content: systemPrompt.assemble(tools.schemas()),
    }
    // Only the first step of a turn needs a full derivation pass; later steps
    // re-derive anyway because their tool results just landed.
    void step
    return [systemMessage, ...session.deriveMessages(id)]
  }

  /**
   * One model request plus its tool calls. `done` = the turn is complete
   * (optionally with a distinct end reason); `tools` = results owe another
   * request; `aborted` = the turn was stopped mid-flight; `request-error` =
   * the model call failed and the error seam gets to decide.
   */
  private async step(
    id: string,
    turnSeq: number,
    messages: ChatMessage[],
    signal: AbortSignal,
    onDelta?: (text: string) => void,
    onToolCall?: (call: ToolCall) => void,
    coordinates: { turn: number; step: number; attempt: number } = { turn: turnSeq, step: 0, attempt: 0 },
  ): Promise<{ outcome: StepOutcome; endReason?: 'max-tokens'; errorMessage?: string }> {
    const { llm, session, tools } = this.ctx

    // Native function calling: hand the provider the same tool list the
    // system prompt describes, so it can emit structured tool calls.
    const toolSpecs: ToolSpec[] = tools.schemas().map(schema => ({
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters as unknown as Record<string, unknown>,
    }))

    let text = ''
    let reasoning = ''
    const pendingCalls: ToolCall[] = []
    let finishKind: 'stop' | 'max-tokens' = 'stop'

    const stream = (signal: AbortSignal): AsyncIterable<StreamChunk> =>
      llm.stream({ route: this.config.route, messages, tools: toolSpecs, signal, sessionId: id })

    try {
      for await (const chunk of stream(signal)) {
        if (chunk.type === 'delta') {
          text += chunk.text
          this.ctx.emit('assistant/stream', { sessionId: id, turnSeq, text: chunk.text })
          onDelta?.(chunk.text)
        } else if (chunk.type === 'reasoning') {
          reasoning += chunk.text
          this.ctx.emit('assistant/stream', { sessionId: id, turnSeq, text: '', reasoning: chunk.text })
        } else if (chunk.type === 'tool_call') {
          pendingCalls.push(chunk.call)
        } else if (chunk.reason.kind === 'error') {
          return { outcome: 'request-error', errorMessage: `llm error: ${chunk.reason.message}` }
        } else if (chunk.reason.kind === 'max-tokens') {
          finishKind = 'max-tokens'
        }
      }
    } catch (error) {
      if (signal.aborted) {
        // The stream was cut mid-flight: commit what the user already saw as
        // an interrupted anchor, so the next request replays the visible
        // prefix instead of silently losing it.
        if (text || reasoning) {
          session.append(id, 'assistant/message', {
            message: { role: 'assistant', content: text || null, reasoning: reasoning || undefined, interrupted: true },
          })
        }
        return { outcome: 'aborted' }
      }
      return { outcome: 'request-error', errorMessage: error instanceof Error ? error.message : String(error) }
    }

    if (pendingCalls.length) {
      session.append(id, 'assistant/message', {
        message: { role: 'assistant', content: text || null, reasoning: reasoning || undefined, toolCalls: pendingCalls },
      })
      await this.runToolCalls(id, pendingCalls, signal, onToolCall)
      // tools owe another request (or the turn was stopped)
      return signal.aborted ? { outcome: 'aborted' } : { outcome: 'tools' }
    }

    // A step with no visible content and no calls leaves no durable trace.
    if (text || reasoning) {
      session.append(id, 'assistant/message', { message: { role: 'assistant', content: text, reasoning: reasoning || undefined } })
    }
    return { outcome: 'done', ...(finishKind === 'max-tokens' ? { endReason: 'max-tokens' as const } : {}) }
  }

  /**
   * Execute one step's tool calls. Exclusive calls run alone as barriers;
   * consecutive parallel-safe calls share a bounded rolling pool. Durable
   * `tool/call` events and results always commit in model order. On abort,
   * calls that never dispatched get synthetic error results so the history
   * stays replayable (every requested call has a matching result).
   */
  private async runToolCalls(
    id: string,
    calls: readonly ToolCall[],
    signal: AbortSignal,
    onToolCall?: (call: ToolCall) => void,
  ): Promise<void> {
    const { session, tools } = this.ctx
    const bound = Math.max(1, this.config.maxParallelToolCalls ?? 4)
    const settled = new Set<string>()

    const record = (callId: string, content: string, denied?: boolean): void => {
      session.append(id, 'tool/result', { callId, content, denied })
      settled.add(callId)
    }

    let index = 0
    while (index < calls.length) {
      if (signal.aborted) break
      const call = calls[index]
      if (!tools.isParallelSafe(call.name)) {
        // Exclusive call: a barrier — dispatch alone, in model order.
        session.append(id, 'tool/call', { call })
        onToolCall?.(call)
        const result = await tools.execute(call, { caller: 'agent-loop', sessionId: id, signal })
        record(call.id, result.content, result.denied)
        index += 1
        continue
      }
      // Consecutive parallel-safe calls share a bounded rolling pool.
      let end = index
      while (end < calls.length && tools.isParallelSafe(calls[end].name)) end += 1
      const group = calls.slice(index, end)
      for (const queued of group) {
        session.append(id, 'tool/call', { call: queued })
        onToolCall?.(queued)
      }
      for (let start = 0; start < group.length; start += bound) {
        if (signal.aborted) break
        const window = group.slice(start, start + bound)
        // tools.execute normalizes body failures into error results, so this
        // Promise.all settles even when individual calls fail.
        const results = await Promise.all(window.map(call =>
          tools.execute(call, { caller: 'agent-loop', sessionId: id, signal })))
        for (let offset = 0; offset < window.length; offset++) {
          record(window[offset].id, results[offset].content, results[offset].denied)
        }
      }
      index = end
    }

    // Replayability: synthesize results for calls the abort never dispatched.
    if (signal.aborted) {
      for (const call of calls) {
        if (settled.has(call.id)) continue
        session.append(id, 'tool/call', { call })
        record(call.id, ABORTED_BEFORE_DISPATCH)
      }
    }
  }
}

export function apply(ctx: Context, config: Config) {
  // The configured persona is a prompt section like any other: plugins can
  // add more sections (environment, time, instructions) around it.
  if (config.persona?.trim()) {
    ctx.systemPrompt.section({ name: 'persona', order: -100, text: config.persona.trim() })
  }
  // Provide the loop as a proper service so consumers reach it via inject.
  ctx.provide('agentLoop', new AgentLoop(ctx, config))
}
