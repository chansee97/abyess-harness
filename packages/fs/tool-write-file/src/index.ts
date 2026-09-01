/** write tool: create or overwrite a UTF-8 text file. */

import { writeFile, mkdir } from 'node:fs/promises'
import { isAbsolute, resolve, dirname } from 'node:path'
import type { Context } from '@abyss-harness/cordis'

export const name = 'tool-write-file'
export const inject = ['tools']

function toAbsolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

export function apply(ctx: Context) {
  ctx.tools.register({
    name: 'write',
    description: 'Create or overwrite a UTF-8 text file with the given content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, absolute or relative to the working directory' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
    async execute(args) {
      const target = toAbsolute(String(args.path))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, String(args.content), 'utf8')
      return `wrote ${String(args.content).length} bytes to ${args.path}`
    },
  })
}
