/**
 * Tool observer: watches every completed tool call through the `tools/result`
 * event. Knows nothing about the approval policy or the loop — this is the
 * decoupling events buy you.
 */

import type { Context } from '@abyss-harness/cordis'
import type {} from '@abyss-harness/tools' // declaration merges: types 'tools/result'

export const name = 'tool-observer'

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    const status = result.ok ? 'ok' : result.denied ? 'DENIED' : 'error'
    const preview = result.content.length > 120 ? result.content.slice(0, 120) + '…' : result.content
    console.log(`[observer] ${exec.call.name} -> ${status} ${preview}`)
  })
}
