/**
 * File search tools: `glob` (find files by pattern) and `grep` (find text in
 * files). Recursive walk from a root (default the working directory) that
 * skips the usual junk (node_modules, .git, build output); results are
 * capped so one broad pattern cannot flood the context — the model narrows
 * the pattern instead.
 *
 * The glob matcher is a small pattern→regex translation (`**` crosses
 * directory separators, `*`/`?` do not) — no matcher dependency.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@abyss-harness/cordis'

export const name = 'tool-fs-search'
export const inject = ['tools']

const SKIP_DIRS = new Set(['node_modules', '.git', 'web-dist', '.sessions', 'dist'])
const MAX_GLOB_RESULTS = 200
const MAX_GREP_RESULTS = 200

function toAbsoluteRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

/** Translate a glob pattern into a RegExp over relative POSIX-style paths. */
function globToRegex(pattern: string): RegExp {
  let source = ''
  let i = 0
  while (i < pattern.length) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**` matches anything, including separators; consume `**/` as `**`
        // so `a/**/b` also matches `a/b`.
        source += '.*'
        i += 2
        if (pattern[i] === '/') i++
        continue
      }
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      source += `\\${char}`
    } else {
      source += char
    }
    i++
  }
  return new RegExp(`^${source}$`)
}

/** Depth-first walk yielding relative POSIX-style paths, junk skipped.
 *  A root that is itself a file yields just that file's name. */
async function* walk(root: string): AsyncGenerator<string> {
  const rootStat = await stat(root).catch(() => null)
  if (rootStat?.isFile()) {
    yield root.split(/[\\/]/).pop()!
    return
  }
  const stack: string[] = ['']
  while (stack.length) {
    const dir = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(join(root, dir), { withFileTypes: true })
    } catch {
      continue // unreadable directory: skip, not fail
    }
    for (const entry of entries) {
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(rel)
      } else if (entry.isFile()) {
        yield rel
      }
    }
  }
}

export function apply(ctx: Context) {
  ctx.tools.register({
    name: 'glob',
    description: 'Find files under a directory by glob pattern (** crosses directories, * and ? do not). Returns matching relative paths.',
    concurrency: 'parallel',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. "packages/**/index.ts" or "src/*.tsx"' },
        path: { type: 'string', description: 'Search root, absolute or relative to the working directory (default: working directory)' },
      },
      required: ['pattern'],
    },
    async execute(args) {
      const root = toAbsoluteRoot(String(args.path ?? '.'))
      const matcher = globToRegex(String(args.pattern))
      const matches: string[] = []
      for await (const rel of walk(root)) {
        if (matcher.test(rel)) {
          matches.push(rel)
          if (matches.length >= MAX_GLOB_RESULTS) break
        }
      }
      if (matches.length === 0) return 'no matches'
      return `${matches.length} match(es):\n${matches.join('\n')}`
    },
  })

  ctx.tools.register({
    name: 'grep',
    description: 'Search file CONTENTS for a regular expression. Returns "path:line: text" rows, newest files first walked. Use include to filter file names by glob.',
    concurrency: 'parallel',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression source text, e.g. "export function \\w+"' },
        path: { type: 'string', description: 'Search root, absolute or relative to the working directory (default: working directory)' },
        include: { type: 'string', description: 'Only search files matching this glob pattern, e.g. "*.ts"' },
      },
      required: ['pattern'],
    },
    async execute(args) {
      const root = toAbsoluteRoot(String(args.path ?? '.'))
      let regex: RegExp
      try {
        regex = new RegExp(String(args.pattern), 'u')
      } catch (error) {
        throw new Error(`invalid pattern: ${error instanceof Error ? error.message : String(error)}`)
      }
      const include = args.include !== undefined ? globToRegex(String(args.include)) : null
      // A file root is searched directly; a directory root is walked.
      const rootStat = await stat(root).catch(() => null)
      const rootIsFile = rootStat?.isFile() ?? false
      const rows: string[] = []
      for await (const rel of walk(root)) {
        if (include && !include.test(rel)) continue
        let content: string
        try {
          content = await readFile(rootIsFile ? root : join(root, rel), 'utf8')
        } catch {
          continue // binary or unreadable: skip
        }
        if (content.includes('\u0000')) continue // binary heuristic
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            rows.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
            if (rows.length >= MAX_GREP_RESULTS) {
              return `${rows.length}+ match(es) (capped):\n${rows.join('\n')}`
            }
          }
        }
      }
      if (rows.length === 0) return 'no matches'
      return `${rows.length} match(es):\n${rows.join('\n')}`
    },
  })
}
