/**
 * Approval seam: the Service Definition for human-in-the-loop interaction.
 * Lives in its own module so the policy plugin (which consumes the service)
 * and the API plugin (which relays decisions) can both depend on it without
 * either of them owning it. This mirrors dsh's three-role seam split:
 * definition here, provider in the web composition, consumers elsewhere.
 *
 * Two interaction kinds ride the same channel:
 *  - `tool`: an allow/deny gate for a tool call (request/settle).
 *  - `question`: a batch of questions (options / multi-select / free text)
 *    the model asked for (ask/settle+answers), mirroring dsh's ask_user_question.
 */

import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@abyss-harness/cordis'
import type { ToolExecution } from '@abyss-harness/tools'

/** One selectable choice of a question; the label string IS the answer value. */
export interface AskOption {
  label: string
  description?: string
}

/** One question in a batch: stable id echoed in the answer, optional
    option menu, optional multi-select. No options = free-text. */
export interface AskQuestion {
  id: string
  question: string
  header?: string
  options?: AskOption[]
  multiSelect?: boolean
}

/** The human's answer to one question: selected labels plus an optional
    free-text "other" (coexists with selected only for multi-select). */
export interface AskAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

export interface ApprovalRequest {
  id: string
  tool: string
  argsText: string
  /** Session the tool call belongs to; the UI shows the card only in that chat. */
  sessionId?: string
  /** What the human is asked for: a decision, or a batch of questions. */
  kind?: 'tool' | 'question'
  /** Structured question batch for kind 'question' (the UI renders from
      this instead of parsing argsText). */
  questions?: AskQuestion[]
}

declare module '@abyss-harness/cordis' {
  interface Context {
    approval?: ApprovalService
  }

  interface Events {
    /**
     * A tool call or question awaits the human. Fire-and-forget; listeners
     * relay it to connected browsers.
     *
     * @mode emit
     */
    'approval/request'(request: ApprovalRequest): void
    /**
     * A request was settled by a browser, aborted, or timed out; listeners
     * drop it from their UI. For questions the `reason` carries the answer
     * batch serialized as JSON.
     *
     * @mode emit
     */
    'approval/settled'(request: ApprovalRequest, decision: 'allow' | 'deny', reason: string): void
  }
}

/** One pending human interaction. */
interface PendingEntry {
  request: ApprovalRequest
  resolveDecision?: (decision: 'allow' | 'deny') => void
  resolveAnswers?: (answers: AskAnswerItem[] | null) => void
  /** Removes this entry's abort listener from the tool signal. */
  detach: () => void
}

/** The provider mounts this; consumers reach it as an optional capability. */
export class ApprovalService extends Service {
  private readonly pending = new Map<string, PendingEntry>()

  constructor(ctx: Context) {
    super(ctx, 'approval')
  }

  /** Ask the human for an allow/deny decision (abort = deny; no timeout). */
  request(exec: ToolExecution): Promise<'allow' | 'deny'> {
    return new Promise(resolvePromise => {
      this.register(this.createEntry(exec, 'tool', { resolveDecision: resolvePromise }))
    })
  }

  /**
   * Ask the human a batch of questions (dismissal or abort = null; there is
   * deliberately no timeout — like dsh, the wait is user-paced).
   * @param exec - the ask_user_question tool execution carrying the questions.
   * @param questions - the structured question batch; ids echo in the answers.
   */
  ask(exec: ToolExecution, questions: AskQuestion[]): Promise<AskAnswerItem[] | null> {
    return new Promise(resolvePromise => {
      const entry = this.createEntry(exec, 'question', { resolveAnswers: resolvePromise })
      entry.request.questions = questions
      this.register(entry)
    })
  }

  private createEntry(
    exec: ToolExecution,
    kind: 'tool' | 'question',
    resolvers: Pick<PendingEntry, 'resolveDecision' | 'resolveAnswers'>,
  ): PendingEntry {
    const request: ApprovalRequest = {
      id: randomUUID(),
      tool: exec.call.name,
      argsText: exec.call.argsText,
      sessionId: exec.sessionId,
      kind,
    }
    // A turn stop aborts its tool calls' signal: settle immediately so the
    // turn ends now instead of waiting for the human forever (harness is
    // user-paced: no timeout, the turn's abort is the only automatic exit).
    const onAbort = () => this.settle(request.id, 'deny')
    exec.signal?.addEventListener('abort', onAbort, { once: true })
    return {
      request,
      ...resolvers,
      detach: () => exec.signal?.removeEventListener('abort', onAbort),
    }
  }

  private register(entry: PendingEntry): void {
    this.pending.set(entry.request.id, entry)
    this.ctx.emit('approval/request', entry.request)
  }

  /**
   * Apply a browser decision; unknown ids are ignored (already settled).
   * For questions, `answers` is the batch the browser collected (one item
   * per question, ids echoing the questions; skipped questions arrive with
   * an empty `selected`).
   */
  settle(id: string, decision: 'allow' | 'deny', answers?: AskAnswerItem[]): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    entry.detach()
    if (entry.resolveDecision) {
      entry.resolveDecision(decision)
    } else if (entry.resolveAnswers) {
      entry.resolveAnswers(decision === 'allow' ? (answers ?? []) : null)
    }
    const reason = entry.request.kind === 'question'
      ? (decision === 'allow' ? JSON.stringify(answers ?? []) : 'user dismissed the question')
      : (decision === 'deny' ? 'user declined' : '')
    this.ctx.emit('approval/settled', entry.request, decision, reason)
  }

  protected [Service.init]() {
    return () => {
      for (const [, entry] of this.pending) {
        entry.detach()
        entry.resolveDecision?.('deny')
        entry.resolveAnswers?.(null)
      }
      this.pending.clear()
    }
  }
}
