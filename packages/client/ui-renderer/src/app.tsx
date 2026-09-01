import { approve, type ApprovalRequest, type AskAnswerItem, type SessionEvent, type SessionStats, type StreamDelta } from '@abyss-harness/client-connection'
import { AppFrame } from '@abyss-harness/client-ui-layout'
import { Sidebar } from '@abyss-harness/client-ui-sidebar'
import { ApprovalCard, ChatView, Composer, StatsLine, isTurnOpen, isEmptyConversation } from '@abyss-harness/client-ui-conversation'
import { useSessionHub } from './use-session-hub.ts'
import css from './app.module.css'

/** Approve/deny/answer is the conversation slot's only backend call; pending
    removal follows via the approval/settled frame. */
async function onDecide(id: string, decision: 'allow' | 'deny', answers?: AskAnswerItem[]) {
  await approve(id, decision, answers).catch(() => {})
}

function Conversation({ activeId, events, pending, connected, stream, stats, running, onSend, onStop }: {
  activeId: string | null
  events: readonly SessionEvent[]
  pending: ApprovalRequest[]
  connected: boolean
  stream?: StreamDelta | null
  stats?: SessionStats | null
  running?: boolean | null
  onSend: (text: string) => Promise<void>
  onStop: () => void
}) {
  // agent/status frames are authoritative; before the first frame, derive
  // from the log (turn/start without a matching turn/end).
  const busy = running ?? isTurnOpen(events)
  // New chat: center the welcome + composer group; with messages, dock to bottom.
  const empty = isEmptyConversation(events, pending, stream)
  // dsh's composer chain: a pending interaction takes over the composer's
  // seat; the input bar returns once every request is settled.
  const takeover = pending.length > 0
  return (
    <div className={empty ? `${css.conversation} ${css.empty}` : css.conversation}>
      <ChatView activeId={activeId} events={events} pending={pending} stream={stream} />
      {takeover ? (
        <div className={css.interactions}>
          {pending.map(request => (
            <ApprovalCard key={request.id} request={request} onDecide={onDecide} />
          ))}
        </div>
      ) : (
        <Composer connected={connected} busy={busy} sessionId={activeId} onSend={onSend} onStop={onStop} />
      )}
      <StatsLine stats={stats} />
    </div>
  )
}

/**
 * Application assembly: one session data hub feeding the layout shell's two
 * slots. The miniature of dsh-client-ui-renderer/app.
 */
export function App() {
  const hub = useSessionHub()

  return (
    <AppFrame
      hub={hub}
      sidebar={({ collapsed, onToggle }) => (
        <Sidebar
          collapsed={collapsed}
          onToggle={onToggle}
          sessions={hub.sessions}
          activeId={hub.activeId}
          onSelect={hub.onSelect}
          onNewChat={hub.onNewChat}
          onRename={hub.onRename}
          onDelete={hub.onDelete}
        />
      )}
      conversation={({ activeId, events, pending, connected, stream, stats, running, onSend, onStop }) => (
        <Conversation
          activeId={activeId}
          events={events}
          pending={pending}
          connected={connected}
          stream={stream}
          stats={stats}
          running={running}
          onSend={onSend}
          onStop={onStop}
        />
      )}
    />
  )
}
