/**
 * Web server service: a node:http carrier with effect-scoped route
 * registration — the same seam shape as dsh's `webServer` (a miniature
 * packages/host/webserver). Knows no harness concepts: routes and the SPA
 * fallback are owned by other plugins.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { Service, type Context } from '@abyss-harness/cordis'

export type WebRouteKind = 'exact' | 'prefix'

export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebUpgradeRoute {
  /** Absolute pathname. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

declare module '@abyss-harness/cordis' {
  interface Context {
    webServer: WebServerService
  }
}

export interface Config {
  host: '127.0.0.1' | '0.0.0.0'
  port: number
}

/** The browser HTTP carrier. Activation listens; disposal closes. */
export class WebServerService extends Service {
  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly upgradedSockets = new Set<Duplex>()
  private fallback: WebRoute['handler'] | undefined
  private server!: Server

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'webServer')
  }

  /** The actually-bound port (OS-assigned value when config.port is 0). */
  get port(): number {
    return (this.server.address() as { port: number }).port
  }

  get host(): Config['host'] {
    return this.config.host
  }

  /** Register a named HTTP route; duplicate (kind, path) throws. */
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => table.delete(route.path)
  }

  /** Register an exact-path upgrade route; one socket has one protocol owner. */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => this.upgrades.delete(route.path)
  }

  /**
   * Claim the fallback seat answering every unmatched request (the SPA owner).
   * Single-owner by design: a second claim is a misconfiguration.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('webserver: fallback already registered')
    }
    this.fallback = handler
    return () => this.fallback === handler ? this.fallback = undefined : undefined
  }

  protected async [Service.init]() {
    const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const route = this.exact.get(pathname) ?? [...this.prefixes.values()]
        .filter(r => pathname === r.path || pathname.startsWith(r.path + '/'))
        .sort((a, b) => b.path.length - a.path.length)[0]
      if (route) {
        await route.handler(req, res)
        return
      }
      const fallback = this.fallback
      if (!fallback) {
        res.writeHead(404)
        res.end()
        return
      }
      await fallback(req, res)
    }

    // Per-request failures log and answer 400 — never a process exit.
    this.server = createServer((req, res) => {
      handle(req, res).catch(error => {
        console.warn('[webserver] request failed:', error)
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(400)
        res.end()
      })
    })

    this.server.on('upgrade', (req, socket, head) => {
      let route: WebUpgradeRoute | undefined
      try {
        route = this.upgrades.get(new URL(req.url ?? '/', 'http://x').pathname)
      } catch {
        socket.destroy()
        return
      }
      if (!route) {
        socket.destroy()
        return
      }
      this.upgradedSockets.add(socket)
      socket.once('close', () => this.upgradedSockets.delete(socket))
      try {
        void route.handler(req, socket, head)
      } catch (error) {
        console.warn('[webserver] upgrade failed:', error)
        socket.destroy()
      }
    })

    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.server.once('error', rejectPromise)
      this.server.listen(this.config.port, this.config.host, () => resolvePromise())
    })
    console.log(`[webserver] listening on http://${this.config.host}:${this.port}`)

    // Teardown is an effect owned by this fiber: close the listener and every
    // tracked upgraded socket before the service unregisters.
    this.ctx.effect(() => async () => {
      const serverClosed = new Promise<void>(resolvePromise => {
        this.server.close(() => resolvePromise())
      })
      this.server.closeAllConnections()
      const socketsClosed = [...this.upgradedSockets].map(socket =>
        new Promise<void>(resolvePromise => {
          socket.once('close', () => resolvePromise())
          socket.destroy()
        }))
      await Promise.all([serverClosed, ...socketsClosed])
    }, 'webServer.listen')
  }
}

export const name = 'webserver'

export function apply(ctx: Context, config: Config) {
  ctx.plugin(WebServerService, config)
}
