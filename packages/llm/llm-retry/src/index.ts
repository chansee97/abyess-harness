/**
 * LLM retry: retries a failed model call at the `agent/request-error` seam —
 * the loop's normalized recovery point for failed requests. A listener
 * returning `{ kind: 'retry' }` makes the loop re-attempt the SAME step with
 * the SAME history; the failure ends the turn only when retries are
 * exhausted or the listener lets it pass (terminal).
 *
 * Retries apply to every failed attempt, with linear backoff between them.
 * Partially streamed answers are NOT retried here — the loop commits an
 * interrupted anchor when a stream was cut, and that outcome never reaches
 * this seam.
 */

import type { Context } from '@abyss-harness/cordis'
import type { RequestErrorAction } from '@abyss-harness/agent-loop'

export const name = 'llm-retry'
export const inject = ['agentLoop']

export interface Config {
  /** Extra attempts after the first. Default 2. */
  retries?: number
  /** Base backoff between attempts, milliseconds; grows linearly. Default 800. */
  backoffMs?: number
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function apply(ctx: Context, config: Config) {
  const retries = config.retries ?? 2
  const backoffMs = config.backoffMs ?? 800

  ctx.on('agent/request-error', async (payload, next): Promise<RequestErrorAction> => {
    // Retries are exhausted (attempt counts retries already used by earlier
    // listeners in the chain), the turn is aborting, or the failure is
    // terminal for another listener's reasons — delegate.
    if (payload.attempt >= retries || payload.signal.aborted) return next()
    console.warn(`[llm-retry] attempt ${payload.attempt + 1}/${retries} after failure (${payload.failure.message}), backing off ${(payload.attempt + 1) * backoffMs}ms`)
    await delay((payload.attempt + 1) * backoffMs)
    return { kind: 'retry' }
  })
}
