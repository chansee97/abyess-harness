/**
 * Tool-result limiter: caps the durable content of every tool result so one
 * huge bash output or file read cannot blow the context window of every
 * later step (the log IS the history — truncation here is the cheapest
 * context management there is). Runs on the `tools/post-execute` waterfall,
 * so it rewrites what gets logged and shown, after the tool itself ran.
 *
 * The kept window is head + tail (command output usually starts with the
 * useful part and ends with the error; the middle is bulk).
 */

import type { Context } from '@abyss-harness/cordis'
import type { ToolResult } from '@abyss-harness/tools'

export const name = 'tool-result-limiter'
export const inject = ['tools']

export interface Config {
  /** Maximum characters kept per tool result. Default 6000. */
  maxChars?: number
  /** Fraction of the budget kept from the head (rest is the tail). Default 0.6. */
  headRatio?: number
}

const DEFAULT_MAX_CHARS = 6000

function truncate(content: string, maxChars: number, headRatio: number): string {
  const head = Math.max(1, Math.floor(maxChars * headRatio))
  const tail = Math.max(0, maxChars - head)
  const omitted = content.length - head - tail
  return `${content.slice(0, head)}\n[… ${omitted} characters truncated …]\n${content.slice(content.length - tail)}`
}

export function apply(ctx: Context, config: Config) {
  const maxChars = config.maxChars ?? DEFAULT_MAX_CHARS
  const headRatio = config.headRatio ?? 0.6

  ctx.on('tools/post-execute', async (_exec, result, next) => {
    const settled = await next()
    if (settled.content.length <= maxChars) return settled
    const truncated: ToolResult = { ...settled, content: truncate(settled.content, maxChars, headRatio) }
    return truncated
  })
}
