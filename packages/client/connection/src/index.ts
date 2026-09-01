/**
 * Browser API client: one downlink WebSocket plus the HTTP calls.
 * Mirrors the host wire contract in src/web/api.ts.
 */

export interface ToolCall {
  id: string
  name: string
  argsText: string
}

export interface SessionEvent {
  seq: number
  type: string
  payload: any
  /** Wall-clock epoch ms at append; old persisted events may lack it. */
  time?: number
}

/** One selectable choice of a question; the label string IS the answer value. */
export interface AskOption {
  label: string
  description?: string
}

/** One question in a batch: mirrors @abyss-harness/approval's AskQuestion. */
export interface AskQuestion {
  id: string
  question: string
  header?: string
  options?: AskOption[]
  multiSelect?: boolean
}

/** The human's answer to one question (mirrors approval's AskAnswerItem). */
export interface AskAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

export interface ApprovalRequest {
  id: string
  tool: string
  argsText: string
  /** Session the request belongs to; legacy frames may omit it. */
  sessionId?: string
  /** What the human is asked for: a tool decision, or a batch of questions. */
  kind?: 'tool' | 'question'
  /** Structured question batch for kind 'question'. */
  questions?: AskQuestion[]
}

/** Provider- or heuristic-derived token totals for one session. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Window-scoped display totals folded server-side from the session log
 *  (tokens + timing; mirrors @abyss-harness/token-meter's SessionStats). */
export interface SessionStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
  usage: TokenUsage
}

/** One row of the conversation history list. */
export interface SessionSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  blank: boolean
}

/** The host's resolved file-effect sandbox policy (see packages/sandbox). */
export interface SandboxPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
}

/** One streamed model delta for a turn (text and/or reasoning fragment). */
export interface StreamDelta {
  sessionId: string
  turnSeq: number
  text: string
  reasoning?: string
}

export type WireMessage =
  | { kind: 'session/event'; sessionId: string; event: SessionEvent }
  | { kind: 'session/created'; session: SessionSummary }
  | { kind: 'session/removed'; sessionId: string }
  | { kind: 'stream/delta'; stream: StreamDelta }
  | { kind: 'approval/request'; request: ApprovalRequest }
  | { kind: 'approval/settled'; id: string; decision: 'allow' | 'deny'; reason: string }
  | { kind: 'stats'; sessionId: string; stats: SessionStats }
  | { kind: 'agentStatus'; sessionId: string; status: 'running' | 'idle' }
  | { kind: 'reload' }

/** Open the event socket; returns a disposer. Reports real connection state. */
export function connect(
  onMessage: (message: WireMessage) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${proto}//${location.host}/api/events`)
  ws.onopen = () => onStatus?.(true)
  ws.onclose = () => onStatus?.(false)
  ws.onerror = () => onStatus?.(false)
  ws.onmessage = event => {
    try {
      onMessage(JSON.parse(event.data) as WireMessage)
    } catch {
      // malformed frame; ignore — the stream is downlink-only JSON
    }
  }
  return () => ws.close()
}

async function requestJson(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, init)
  if (!response.ok) throw new Error(`${path} ${response.status}`)
  return response.json()
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const data = await requestJson('/api/sessions')
  return data.sessions as SessionSummary[]
}

export async function createSession(): Promise<string> {
  const data = await requestJson('/api/sessions', { method: 'POST' })
  return data.id as string
}

/** The ACTIVE session's durable log plus its folded stats (null when the
 *  meter plugin is not mounted). */
export async function fetchState(sessionId: string): Promise<{ events: SessionEvent[]; stats: SessionStats | null }> {
  const data = await requestJson(`/api/sessions/${sessionId}/state`)
  return { events: data.events as SessionEvent[], stats: (data.stats ?? null) as SessionStats | null }
}

export async function send(text: string, sessionId: string): Promise<void> {
  const response = await fetch('/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, sessionId }),
  })
  if (!response.ok) throw new Error(`send ${response.status}`)
}

/**
 * Queue text to join the open turn at its next step boundary (steering).
 * Resolves false when no turn is open — the caller should fall back to send().
 */
export async function steer(text: string, sessionId: string): Promise<boolean> {
  const response = await fetch('/api/steer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, sessionId }),
  })
  if (!response.ok) throw new Error(`steer ${response.status}`)
  return (await response.json()).ok === true
}

/** Abort the open turn of a session (model stream, tools, approvals). */
export async function stop(sessionId: string): Promise<void> {
  const response = await fetch('/api/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  if (!response.ok) throw new Error(`stop ${response.status}`)
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) throw new Error(`rename ${response.status}`)
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/delete`, { method: 'POST' })
  if (!response.ok) throw new Error(`delete ${response.status}`)
}

/** Answer an approval request; `answers` carries the structured question
 *  answer batch (one item per question, ids echoing the questions). */
export async function approve(id: string, decision: 'allow' | 'deny', answers?: AskAnswerItem[]): Promise<void> {
  const response = await fetch('/api/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(answers !== undefined ? { id, decision, answers } : { id, decision }),
  })
  if (!response.ok) throw new Error(`approve ${response.status}`)
}

/** The resolved file-effect sandbox policy. With a sessionId, the session's
 *  effective mode (override folded from its log); without, the deployment
 *  default. */
export async function fetchSandboxPolicy(sessionId?: string): Promise<SandboxPolicy> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  return requestJson(`/api/sandbox${query}`) as Promise<SandboxPolicy>
}

/** Switch the DEPLOYMENT's default mode (settings surface; new sessions pick it up). */
export async function setDefaultSandboxMode(mode: SandboxPolicy['mode']): Promise<SandboxPolicy> {
  return postSandboxMode({ mode })
}

/** Switch one session's file mode (durable per-session override; the composer chip). */
export async function setSandboxMode(sessionId: string, mode: SandboxPolicy['mode']): Promise<SandboxPolicy> {
  return postSandboxMode({ sessionId, mode })
}

async function postSandboxMode(body: Record<string, unknown>): Promise<SandboxPolicy> {
  const response = await fetch('/api/sandbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`setSandboxMode ${response.status}`)
  return response.json() as Promise<SandboxPolicy>
}
