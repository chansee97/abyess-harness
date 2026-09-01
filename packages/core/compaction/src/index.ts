/**
 * Basic context compaction: keeps each model request inside a character
 * budget by rewriting the step's message list on the `agent/pre-step`
 * waterfall. The session log is never touched — compaction is a projection
 * applied per step, so it is deterministic and idempotent (the same log
 * always compacts to the same request).
 *
 * Two stages, oldest-first:
 *  1. Stub out old tool-result bodies (keep the most recent few verbatim) —
 *     the bulk of long agent sessions is tool output, not conversation.
 *  2. If still over budget, drop the oldest middle messages entirely and
 *     insert one system note stating how much was elided, so the model knows
 *     the history is partial.
 *
 * This is dsh's compaction-basic in miniature: no LLM summarization, just
 * structural pruning. It runs at the step boundary (the pre-step seam), so
 * the rewrite is visible to every later listener and the request that ships
 * is exactly what this plugin produced.
 */

import type { Context } from '@abyss-harness/cordis'
import type { ChatMessage } from '@abyss-harness/session/types'
import type { PreStepDecision } from '@abyss-harness/agent-loop'

export const name = 'compaction'
// sandboxPolicy in the list is an ORDERING dependency, not a data one: the
// sandbox policy rewrites the system message's policy line on the pre-step
// waterfall and must sit OUTERMOST (register first) so its rewrite applies
// to the post-compaction message list this plugin produces.
export const inject = ['agentLoop', 'sandboxPolicy']

export interface Config {
  /** Approximate request budget in characters (~4 chars per token). Default 96_000. */
  maxChars?: number
  /** Tool results newer than this many are never stubbed. Default 4. */
  keepToolResults?: number
}

const DEFAULT_MAX_CHARS = 96_000

function totalChars(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0)
}

function stubToolResults(messages: ChatMessage[], keepRecent: number): ChatMessage[] {
  // Indexes of tool-role messages, oldest first.
  const toolIndexes = messages
    .map((message, index) => (message.role === 'tool' ? index : -1))
    .filter(index => index >= 0)
  const stubbed = new Set(toolIndexes.slice(0, Math.max(0, toolIndexes.length - keepRecent)))
  return messages.map((message, index) => {
    if (!stubbed.has(index) || !message.content) return message
    const head = message.content.slice(0, 120)
    return {
      ...message,
      content: `${head}\n[… tool result compacted, ${message.content.length} chars omitted …]`,
    }
  })
}

function dropOldest(messages: ChatMessage[], systemNote: string): { messages: ChatMessage[]; dropped: number } {
  // Keep: the leading system message, the first user message (task statement),
  // and the most recent third of the rest.
  const body = messages.slice(1)
  if (body.length <= 2) return { messages, dropped: 0 }
  const keepFrom = Math.max(1, body.length - Math.ceil(body.length / 3))
  const dropped = body.slice(1, keepFrom)
  if (dropped.length === 0) return { messages, dropped: 0 }
  const kept = [messages[0], body[0], { role: 'system' as const, content: systemNote }, ...body.slice(keepFrom)]
  return { messages: kept, dropped: dropped.length }
}

export function apply(ctx: Context, config: Config) {
  const maxChars = config.maxChars ?? DEFAULT_MAX_CHARS
  const keepToolResults = config.keepToolResults ?? 4

  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    let messages = decision.messages ?? payload.messages
    if (totalChars(messages) > maxChars) {
      messages = stubToolResults(messages, keepToolResults)
    }
    if (totalChars(messages) > maxChars) {
      const result = dropOldest(messages, '(context compacted: earlier messages were omitted to fit the budget)')
      messages = result.messages
    }
    // Never shrink below what the model needs to answer: if still over budget
    // after both stages, the request ships anyway — the provider's own limit
    // is the final authority and will surface a clear error.
    return { kind: 'enter', messages }
  })
}
