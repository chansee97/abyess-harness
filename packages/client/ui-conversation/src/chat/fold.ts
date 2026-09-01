import type { ToolItem } from '@abyss-harness/client-ui-tool'

/**
 * One renderable item derived from the ordered session log. */
export type ChatItem =
  | { kind: 'user'; text: string; time?: number }
  | { kind: 'assistant'; text: string; reasoning?: string; time?: number }
  // The tool-call record reuses ui-tool's contract so the presentation
  // domain and the fold never drift apart.
  | ({ kind: 'tool' } & ToolItem)
  | { kind: 'error'; text: string; time?: number }
  | { kind: 'notice'; text: string }
  | { kind: 'divider' }

/** Human-readable text for a turn/end reason that merits a visible notice. */
const TURN_END_NOTICES: Record<string, string | undefined> = {
  stopped: '已停止生成',
  'max-steps': '已达到单轮最大步数，回合被截断',
  error: '本轮因错误结束',
}

const SANDBOX_MODE_LABELS: Record<string, string | undefined> = {
  'read-only': '只读',
  'workspace-write': '工作区可写',
  'danger-full-access': '完全访问',
}

/** A turn is open when a turn/start has no matching turn/end yet. */
export function isTurnOpen(events: readonly { type: string }[]): boolean {
  let lastStart = -1
  let lastEnd = -1
  events.forEach((event, i) => {
    if (event.type === 'turn/start') lastStart = i
    else if (event.type === 'turn/end') lastEnd = i
  })
  return lastStart > lastEnd
}

/** Seq of the currently open turn/start, or -1 when none is open. */
export function openTurnSeq(events: readonly { seq: number; type: string }[]): number {
  let lastStart: { seq: number } | null = null
  let lastEnd: { seq: number } | null = null
  for (const event of events) {
    if (event.type === 'turn/start') lastStart = event
    else if (event.type === 'turn/end') lastEnd = event
  }
  if (lastStart === null) return -1
  return lastEnd === null || lastEnd.seq < lastStart.seq ? lastStart.seq : -1
}

/** Fold the append-only log into display items (pure, replayable). */
export function fold(events: readonly { seq: number; type: string; payload: unknown; time?: number }[]): ChatItem[] {
  const items: ChatItem[] = []
  const toolByCall = new Map<string, ChatItem & { kind: 'tool' }>()
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        if (items.some(i => i.kind === 'user' || i.kind === 'assistant')) {
          items.push({ kind: 'divider' })
        }
        break
      case 'user/message':
        items.push({ kind: 'user', text: (event.payload as { message: { content: string } }).message.content, time: event.time })
        break
      case 'assistant/message': {
        const message = (event.payload as { message: { content: string | null; reasoning?: string; toolCalls?: { id: string; name: string; argsText: string }[] } }).message
        for (const call of message.toolCalls ?? []) {
          const item: ChatItem & { kind: 'tool' } = {
            kind: 'tool', callId: call.id, name: call.name, argsText: call.argsText,
          }
          items.push(item)
          toolByCall.set(call.id, item)
        }
        // Surface assistant text when it is the final answer of a step, or when the step produced reasoning.
        if (message.content || message.reasoning) {
          items.push({ kind: 'assistant', text: message.content ?? '', reasoning: message.reasoning, time: event.time })
        }
        break
      }
      case 'tool/result': {
        const payload = event.payload as { callId: string; content: string; denied?: boolean }
        const item = toolByCall.get(payload.callId)
        if (item) {
          item.result = { content: String(payload.content ?? ''), denied: payload.denied }
        }
        break
      }
      case 'turn/error':
        items.push({ kind: 'error', text: (event.payload as { message: string }).message, time: event.time })
        break
      case 'tool/policy': {
        // The file-policy decision for a gated tool call — the allow/deny
        // indication between the tool card and its result.
        const payload = event.payload as { tool: string; mode: string; decision: 'allow' | 'escalate' | 'deny'; reason?: string }
        const modeLabel = SANDBOX_MODE_LABELS[payload.mode] ?? payload.mode
        if (payload.decision === 'allow') {
          items.push({ kind: 'notice', text: `已按「${modeLabel}」策略放行 ${payload.tool}` })
        } else if (payload.decision === 'deny') {
          items.push({ kind: 'notice', text: `已被「${modeLabel}」策略拒绝 ${payload.tool}${payload.reason ? `：${payload.reason}` : ''}` })
        } else {
          items.push({ kind: 'notice', text: `${payload.tool} 超出「${modeLabel}」策略边界，已转人工审批` })
        }
        break
      }
      case 'turn/end': {
        const reason = (event.payload as { reason?: string }).reason
        const notice = reason !== undefined ? TURN_END_NOTICES[reason] : undefined
        if (notice !== undefined) items.push({ kind: 'notice', text: notice })
        break
      }
    }
  }
  return items
}
