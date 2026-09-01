import { useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import type { ApprovalRequest, SessionEvent, SessionStats, SessionSummary, StreamDelta } from '@abyss-harness/client-connection'
import { useSidebarLayout } from './use-sidebar-layout.ts'
import { DragHandle } from './DragHandle.tsx'
import css from './AppFrame.module.css'

/**
 * The session-bound state + actions AppFrame feeds into its slots.
 * The renderer owns the live hub; ui-layout stays pure layout and only
 * shapes the view model (structural contract).
 */
export interface SessionHubState {
  /** Conversation history (newest first), including blank drafts. */
  sessions: SessionSummary[]
  activeId: string | null
  /** The ACTIVE session's events. */
  events: readonly SessionEvent[]
  pending: ApprovalRequest[]
  stream: StreamDelta | null
  /** Folded token + timing totals for the active session, when metered. */
  stats?: SessionStats | null
  /** Authoritative running flag from agent/status frames; null = unknown. */
  running?: boolean | null
  connected: boolean
  onSelect: (id: string) => void
  onSend: (text: string) => Promise<void>
  /** Abort the active session's open turn. */
  onStop: () => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

/** Two-column application shell (sidebar | conversation). */
export function AppFrame(props: {
  /** The session-bound state + actions; fed to both slots. */
  hub: SessionHubState
  /** Sidebar slot; receives the resolved collapsed state, the toggle handler,
      and the session list state + actions. */
  sidebar: (state: {
    collapsed: boolean
    onToggle: () => void
    sessions: SessionSummary[]
    activeId: string | null
    onSelect: (id: string) => void
    onNewChat: () => void
    onRename: (id: string, title: string) => void
    onDelete: (id: string) => void
  }) => ReactNode
  /** Conversation slot; shows the ACTIVE session's events. */
  conversation: (data: {
    activeId: string | null
    events: readonly SessionEvent[]
    pending: ApprovalRequest[]
    connected: boolean
    stream: StreamDelta | null
    stats?: SessionStats | null
    running?: boolean | null
    onSend: (text: string) => Promise<void>
    onStop: () => void
  }) => ReactNode
}) {
  const { hub } = props
  const frameRef = useRef<HTMLDivElement>(null)
  const layout = useSidebarLayout(frameRef)

  return (
    <div
      ref={frameRef}
      className={css.frame}
      data-dragging={layout.dragging || undefined}
      data-sidebar-collapsed={layout.collapsed || undefined}
    >
      <div className={css.frameRow} style={{ gridTemplateColumns: `${layout.cols.sidebar}px minmax(0, 1fr)` }}>
        <section className={clsx(css.col, css.colSidebar)}>
          {props.sidebar({
            collapsed: layout.collapsed,
            onToggle: layout.onToggle,
            sessions: hub.sessions,
            activeId: hub.activeId,
            onSelect: hub.onSelect,
            onNewChat: hub.onNewChat,
            onRename: hub.onRename,
            onDelete: hub.onDelete,
          })}
        </section>
        <main className={clsx(css.col, css.colCenter)}>
          {props.conversation({
            activeId: hub.activeId,
            events: hub.events,
            pending: hub.pending,
            connected: hub.connected,
            onSend: hub.onSend,
            onStop: hub.onStop,
            stream: hub.stream,
            stats: hub.stats,
            running: hub.running,
          })}
        </main>
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!layout.collapsed && (
        <DragHandle left={layout.cols.sidebar} onStart={layout.onHandleStart} onDrag={layout.onHandleDrag} onEnd={layout.onHandleEnd} />
      )}
    </div>
  )
}
