/**
 * Built-in tools: read, write, bash. Each is its own plugin so it
 * can be unmounted (and hot-reloaded) independently from cordis.yml.
 * Tool names follow dsh's vocabulary: no `_file` suffix.
 */

import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@abyss-harness/cordis'

const execFileAsync = promisify(execFile)

/** Resolve a user-supplied path against the process cwd. */
function toAbsolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

export const name = 'tool-read-file'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register({
    name: 'read',
    description: 'Read a UTF-8 text file and return its content.',
    concurrency: 'parallel',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, absolute or relative to the working directory' },
      },
      required: ['path'],
    },
    async execute(args) {
      return readFile(toAbsolute(String(args.path)), 'utf8')
    },
  })
}
