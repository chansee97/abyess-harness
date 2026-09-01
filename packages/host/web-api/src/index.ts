/**
 * API bridge: HTTP routes for send/approve/state/session-management plus a
 * downlink-only WebSocket that streams session events and approval requests to
 * browsers — the miniature of dsh's client-connection node half. One all-session
 * mux: every frame carries `sessionId`, and each browser filters by the session
 * it has selected. Browsers never send application data over the socket;
 * upstream traffic stays on HTTP.
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { Context } from '@abyss-harness/cordis'
import type { SessionEvent, SessionSummary } from '@abyss-harness/session'
import type { ApprovalRequest } from '@abyss-harness/approval'
import type { SessionStats } from '@abyss-harness/token-meter'
import type { SandboxPolicyService } from '@abyss-harness/sandbox-policy'

export const name = 'web-api'
// approval is an optional capability: without the policy plugin mounted,
// /api/approve answers 503 but everything else still works.
export const inject = ['webServer', 'session', 'agentLoop']

/** One message pushed to every connected browser. */
export type WireMessage =
  | { kind: 'session/event'; sessionId: string; event: SessionEvent }
  | { kind: 'session/created'; session: SessionSummary }
  | { kind: 'session/removed'; sessionId: string }
  | { kind: 'stream/delta'; stream: { sessionId: string; turnSeq: number; text: string; reasoning?: string } }
  | { kind: 'approval/request'; request: ApprovalRequest }
  | { kind: 'approval/settled'; id: string; decision: 'allow' | 'deny'; reason: string }
  | { kind: 'stats'; sessionId: string; stats: SessionStats }
  | { kind: 'agentStatus'; sessionId: string; status: 'running' | 'idle' }
  | { kind: 'reload' }

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > 1024 * 1024) rejectPromise(new Error('body too large'))
    })
    req.on('end', () => resolvePromise(body))
    req.on('error', rejectPromise)
  })
}

function json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/** Parse `<id>/<action>` off the /api/sessions prefix. */
const SESSIONS_PREFIX = '/api/sessions'

export function apply(ctx: Context) {
  const sockets = new Set<WebSocket>()

  function broadcast(message: WireMessage): void {
    const text = JSON.stringify(message)
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(text)
    }
  }

  // Relay durable facts, session lifecycle, and approval traffic to every browser.
  ctx.on('session/event', ({ sessionId, event }) => broadcast({ kind: 'session/event', sessionId, event }))
  ctx.on('session/created', session => broadcast({ kind: 'session/created', session }))
  ctx.on('session/deleted', sessionId => broadcast({ kind: 'session/removed', sessionId }))
  ctx.on('assistant/stream', stream => broadcast({ kind: 'stream/delta', stream }))
  ctx.on('approval/request', request => broadcast({ kind: 'approval/request', request }))
  ctx.on('approval/settled', (request, decision, reason) =>
    broadcast({ kind: 'approval/settled', id: request.id, decision, reason }))
  // Per-session folded stats (tokens + timing; only when the meter plugin is mounted).
  ctx.on('tokenMeter/stats', ({ sessionId, stats }) => broadcast({ kind: 'stats', sessionId, stats }))
  // Authoritative turn running/idle transitions from the agent loop.
  ctx.on('agent/status', ({ sessionId, status }) => broadcast({ kind: 'agentStatus', sessionId, status }))
  // The dist was rebuilt (vite build --watch): ask browsers to reload.
  ctx.on('frontend/rebuilt', () => broadcast({ kind: 'reload' }))

  // GET /api/sessions — the conversation history list.
  // POST /api/sessions — create (or reuse a blank) session; returns its id.
  ctx.webServer.register({
    kind: 'exact',
    path: SESSIONS_PREFIX,
    handler: async (req, res) => {
      if (req.method === 'GET') {
        json(res, 200, { sessions: ctx.session.list() })
        return
      }
      if (req.method === 'POST') {
        json(res, 200, { id: ctx.session.create() })
        return
      }
      json(res, 405, { error: 'method not allowed' })
    },
  })

  // /api/sessions/<id>/state | rename | delete
  ctx.webServer.register({
    kind: 'prefix',
    path: SESSIONS_PREFIX,
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const rest = pathname.slice(SESSIONS_PREFIX.length + 1)
      const [id, action] = rest.split('/')

      if (action === 'state') {
        if (req.method !== 'GET') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        if (!id || !ctx.session.has(id)) {
          json(res, 404, { error: 'session not found' })
          return
        }
        // Initial stats ride the state fetch so a refresh/switch restores
        // the metered totals without waiting for the next model call.
        const meter = ctx.get('tokenMeter')
        json(res, 200, { events: [...ctx.session.events(id)], stats: meter?.stats(id) ?? null })
        return
      }

      if (action === 'rename') {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        if (!id || !ctx.session.has(id)) {
          json(res, 404, { error: 'session not found' })
          return
        }
        let body: { title?: unknown }
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          json(res, 400, { error: 'invalid JSON' })
          return
        }
        if (typeof body.title !== 'string' || !body.title.trim()) {
          json(res, 400, { error: 'title is required' })
          return
        }
        ctx.session.rename(id, body.title)
        json(res, 200, { ok: true })
        return
      }

      if (action === 'delete') {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        if (!id || !ctx.session.has(id)) {
          json(res, 404, { error: 'session not found' })
          return
        }
        ctx.session.delete(id)
        json(res, 200, { ok: true })
        return
      }

      json(res, 404, { error: 'unknown session action' })
    },
  })

  // GET /api/sandbox — the resolved file-effect policy for the settings
  // surface; `?sessionId=` resolves the session's effective mode (override
  // folded from its `sandbox/mode` events). POST /api/sandbox — switch one
  // session's mode (durable `sandbox/mode` event). Optional capability: 503
  // when sandbox-policy is not mounted.
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/sandbox',
    handler: async (req, res) => {
      const policy = ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
      if (!policy) {
        json(res, 503, { error: 'no sandbox policy mounted' })
        return
      }
      if (req.method === 'GET') {
        const sessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('sessionId') ?? undefined
        json(res, 200, policy.resolve(sessionId && ctx.session.has(sessionId) ? sessionId : undefined))
        return
      }
      if (req.method === 'POST') {
        let body: { sessionId?: unknown; mode?: unknown }
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          json(res, 400, { error: 'invalid JSON' })
          return
        }
        const { sessionId, mode } = body
        if (mode !== 'read-only' && mode !== 'workspace-write' && mode !== 'danger-full-access') {
          json(res, 400, { error: 'unknown sandbox mode' })
          return
        }
        // With a sessionId: the session's durable override. Without: the
        // deployment default (in-memory; new sessions pick it up).
        if (typeof sessionId === 'string') {
          if (!ctx.session.has(sessionId)) {
            json(res, 400, { error: 'sessionId is required' })
            return
          }
          policy.setMode(sessionId, mode)
          json(res, 200, policy.resolve(sessionId))
          return
        }
        policy.setDefaultMode(mode)
        json(res, 200, policy.resolve())
        return
      }
      json(res, 405, { error: 'method not allowed' })
    },
  })

  // POST /api/send — enqueue one user turn in the addressed session; the loop
  // runs in the background.
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/send',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      let body: { text?: unknown; sessionId?: unknown }
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        json(res, 400, { error: 'invalid JSON' })
        return
      }
      const { text, sessionId } = body
      if (typeof text !== 'string' || !text.trim()) {
        json(res, 400, { error: 'text is required' })
        return
      }
      if (typeof sessionId !== 'string' || !ctx.session.has(sessionId)) {
        json(res, 400, { error: 'sessionId is required' })
        return
      }
      // Fire-and-forget: errors surface as session events / console, never
      // as an HTTP failure after we already acknowledged acceptance.
      void ctx.agentLoop.run(sessionId, text).catch(error => {
        console.error('[web-api] turn failed:', error)
      })
      json(res, 200, { ok: true })
    },
  })

  // POST /api/steer — queue text to join the open turn at its next step
  // boundary. Rejects (ok: false) when no turn is open; the browser then
  // falls back to a fresh /api/send.
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/steer',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      let body: { text?: unknown; sessionId?: unknown }
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        json(res, 400, { error: 'invalid JSON' })
        return
      }
      const { text, sessionId } = body
      if (typeof text !== 'string' || !text.trim()) {
        json(res, 400, { error: 'text is required' })
        return
      }
      if (typeof sessionId !== 'string' || !ctx.session.has(sessionId)) {
        json(res, 400, { error: 'sessionId is required' })
        return
      }
      json(res, 200, { ok: ctx.agentLoop.steer(sessionId, text) })
    },
  })

  // POST /api/stop — abort the open turn of a session (model stream, tool
  // calls, pending approvals). Idempotent: stopping a session with no open
  // turn just reports { ok: false }.
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/stop',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      let body: { sessionId?: unknown }
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        json(res, 400, { error: 'invalid JSON' })
        return
      }
      if (typeof body.sessionId !== 'string') {
        json(res, 400, { error: 'sessionId is required' })
        return
      }
      json(res, 200, { ok: ctx.agentLoop.stop(body.sessionId) })
    },
  })

  // POST /api/approve — deliver one browser decision. For questions the
  // body may carry the structured answer batch (one item per question).
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/approve',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      let body: { id?: unknown; decision?: unknown; answers?: unknown }
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        json(res, 400, { error: 'invalid JSON' })
        return
      }
      if (typeof body.id !== 'string' || (body.decision !== 'allow' && body.decision !== 'deny')) {
        json(res, 400, { error: 'id and decision are required' })
        return
      }
      const answers = Array.isArray(body.answers)
        ? (body.answers as { id?: unknown; selected?: unknown; custom?: unknown }[]).map(item => ({
            id: String(item.id ?? ''),
            selected: Array.isArray(item.selected) ? item.selected.map(String) : [],
            ...(typeof item.custom === 'string' && item.custom.trim() !== '' ? { custom: item.custom.trim() } : {}),
          }))
        : undefined
      const approval = ctx.get('approval')
      if (!approval) {
        json(res, 503, { error: 'no approval service mounted' })
        return
      }
      approval.settle(body.id, body.decision, answers)
      json(res, 200, { ok: true })
    },
  })

  // WS /api/events — the all-session mux. No connect snapshot: the browser
  // fetches its selected session's state over HTTP and seq-merges with the
  // live stream, which closes the fetch/WS race.
  const wss = new WebSocketServer({ noServer: true })
  ctx.webServer.registerUpgrade({
    path: '/api/events',
    handler: async (_req, socket, head) => {
      wss.handleUpgrade(_req, socket as never, head, ws => {
        sockets.add(ws)
        ws.on('close', () => sockets.delete(ws))
        ws.on('error', () => sockets.delete(ws))
        // Downlink-only: any client message is a protocol violation.
        ws.on('message', () => ws.close(1002, 'downlink only'))
      })
    },
  })

  // Socket cleanup rides this plugin's fiber.
  ctx.effect(() => () => {
    for (const ws of sockets) ws.close(1001, 'server stopping')
    sockets.clear()
    wss.close()
  }, 'web-api.sockets')
}
