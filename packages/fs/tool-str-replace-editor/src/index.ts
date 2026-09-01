/**
 * edit tool: surgical text replacement in a UTF-8 file — the cheap
 * alternative to rewriting whole files with write. The model supplies
 * an exact `oldText` snippet and its replacement; a snippet that is absent
 * or (without replaceAll) ambiguous is an error, never a guess.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@abyss-harness/cordis'

export const name = 'tool-str-replace-editor'
export const inject = ['tools']

function toAbsolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

export function apply(ctx: Context) {
  ctx.tools.register({
    name: 'edit',
    description: 'Replace an exact text snippet in a file. The snippet must match exactly (whitespace included); use replaceAll for every occurrence.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, absolute or relative to the working directory' },
        oldText: { type: 'string', description: 'The exact text to replace (must be unique in the file unless replaceAll is true)' },
        newText: { type: 'string', description: 'The replacement text' },
        replaceAll: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match' },
      },
      required: ['path', 'oldText', 'newText'],
    },
    async execute(args) {
      const path = toAbsolute(String(args.path))
      const oldText = String(args.oldText)
      const newText = String(args.newText)
      const replaceAll = args.replaceAll === true
      if (oldText === '') throw new Error('oldText must not be empty')

      const content = await readFile(path, 'utf8')
      const first = content.indexOf(oldText)
      if (first === -1) {
        throw new Error('oldText not found in file — copy the snippet exactly (whitespace included)')
      }
      if (!replaceAll && content.indexOf(oldText, first + 1) !== -1) {
        throw new Error('oldText is not unique in file — extend the snippet or pass replaceAll: true')
      }

      let updated: string
      let count: number
      if (replaceAll) {
        updated = content.split(oldText).join(newText)
        count = content.split(oldText).length - 1
      } else {
        updated = content.slice(0, first) + newText + content.slice(first + oldText.length)
        count = 1
      }

      await writeFile(path, updated, 'utf8')
      return `replaced ${count} occurrence${count === 1 ? '' : 's'} in ${args.path} (${updated.length} bytes total)`
    },
  })
}
