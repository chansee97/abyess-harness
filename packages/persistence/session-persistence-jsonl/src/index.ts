/**
 * JSONL session persistence: every durable event appends to one file PER
 * session (<id>.jsonl), and every previous log is replayed into its session at
 * boot (config.resume, default true) — restarting the process continues the
 * conversations. A session that was created but never produced an event writes
 * no file and vanishes on restart (lazy materialization, like dsh). Deleting a
 * session removes its file.
 */

import { appendFile, mkdir, unlink } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@abyss-harness/cordis'
import type { SessionEvent } from '@abyss-harness/session'

export const name = 'session-persistence-jsonl'
export const inject = ['session']

export interface Config {
  dir: string
  /** Replay the previous logs at boot. Default true; false starts empty. */
  resume?: boolean
}

function logPath(dir: string, id: string): string {
  return join(resolve(dir), `${id}.jsonl`)
}

export function apply(ctx: Context, config: Config) {
  const root = resolve(config.dir)

  // Seed BEFORE registering the append listener, so the resumed logs are in
  // place before any event of this process can fire. Synchronous on purpose:
  // apply() completes before the fiber becomes ACTIVE.
  if (config.resume ?? true) {
    let files: string[] = []
    try {
      files = readdirSync(root).filter(name => name.endsWith('.jsonl'))
    } catch {
      // No session dir yet; start fresh.
    }
    for (const file of files) {
      const id = file.slice(0, -'.jsonl'.length)
      try {
        const text = readFileSync(logPath(root, id), 'utf8')
        const events = text
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line) as SessionEvent)
        if (events.length) {
          ctx.session.load(id, events)
          console.log(`[persistence] resumed ${events.length} events from ${file}`)
        }
      } catch (error) {
        console.warn(`[persistence] skipped unreadable ${file}:`, error)
      }
    }
  }

  // Serialize writes so appends stay in seq order even under bursts.
  let tail: Promise<void> = Promise.resolve()
  let ready: Promise<void> | undefined

  ctx.on('session/event', ({ sessionId, event }) => {
    ready ??= mkdir(root, { recursive: true }).then(() => undefined)
    const file = logPath(root, sessionId)
    tail = tail.then(async () => {
      await ready
      await appendFile(file, JSON.stringify(event) + '\n', 'utf8')
    })
    tail.catch(() => {}) // a failed append must not poison the chain
  })

  ctx.on('session/deleted', sessionId => {
    const file = logPath(root, sessionId)
    tail = tail.then(async () => {
      await ready
      await unlink(file).catch(() => {}) // ENOENT is fine
    })
    tail.catch(() => {})
  })
}

// The Loader registers plugins by passing the whole module namespace, so
// `export const inject` is what it reads. Direct `ctx.plugin(apply)` usage
// (tests, the sanity script) reads `apply.inject` instead — carry the
// declaration there too so both paths inject `session`.
apply.inject = inject
