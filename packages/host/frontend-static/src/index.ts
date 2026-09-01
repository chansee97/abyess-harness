/**
 * SPA dist server over the webserver fallback seat — the miniature of
 * dsh-host-frontend-static. Serves the built frontend directory; misses fall
 * back to index.html (client-side routing), traversal is refused, and every
 * other extension ships as octet-stream. During development the dist is
 * rebuilt by `vite build --watch`; this plugin stat-polls the entry document
 * and emits `frontend/rebuilt` when it changes, so the web-api downlink can
 * tell browsers to reload (harness's stat-poll + `rebuilt` frame pattern).
 */

import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@abyss-harness/cordis'
import type {} from '@abyss-harness/webserver' // webServer Context merge

export const name = 'web-frontend'
export const inject = ['webServer']

export interface Config {
  /** Path of index.html inside the built dist, relative to the process cwd. */
  distIndex: string
  /** How often to check the dist entry for a rebuild (ms). Default 1000. */
  pollMs?: number
}

declare module '@abyss-harness/cordis' {
  interface Events {
    /**
     * The served frontend dist was rebuilt (entry document mtime changed).
     * Listeners — e.g. the web-api downlink — relay this to browsers.
     *
     * @mode emit
     */
    'frontend/rebuilt'(): void
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

export function apply(ctx: Context, config: Config) {
  const distRoot = resolve(process.cwd(), config.distIndex, '..')
  const entry = resolve(process.cwd(), config.distIndex)

  async function sendFile(res: import('node:http').ServerResponse, file: string): Promise<void> {
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': type })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  }

  ctx.webServer.registerFallback(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const target = resolve(distRoot, '.' + pathname)
    // Refuse anything escaping the dist root.
    if (target !== distRoot && !target.startsWith(distRoot + sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    const info = await stat(target).catch(() => undefined)
    if (info?.isFile()) {
      await sendFile(res, target)
      return
    }
    // SPA miss → the entry document.
    await sendFile(res, entry)
  })

  // Stat-poll the entry document so a `vite build --watch` rebuild signals
  // browsers to reload. The timer is an effect: it stops when this fiber
  // unloads (HMR reload of this plugin included).
  let lastMtimeMs: number | undefined
  ctx.effect(() => {
    const timer = setInterval(() => {
      void stat(entry).then(
        info => {
          const mtimeMs = info.mtimeMs
          if (lastMtimeMs !== undefined && mtimeMs !== lastMtimeMs) {
            ctx.emit('frontend/rebuilt')
          }
          lastMtimeMs = mtimeMs
        },
        () => {}, // entry missing (not built yet) — keep last known mtime
      )
    }, config.pollMs ?? 1000)
    timer.unref()
    return () => clearInterval(timer)
  }, 'frontend-static.watchDist')

  console.log(`[web-frontend] serving ${distRoot}`)
}
