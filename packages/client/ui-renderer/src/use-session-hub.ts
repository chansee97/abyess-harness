import { useCallback, useEffect, useRef, useState } from 'react'
import { connect, createSession, deleteSession, fetchSessions, fetchState, renameSession, send, steer, stop,
  type ApprovalRequest, type SessionEvent, type SessionStats, type SessionSummary, type StreamDelta } from '@abyss-harness/client-connection'
import { isTurnOpen } from '@abyss-harness/client-ui-conversation'
import { mergeBySeq, mergeDelta } from './merge.ts'

/** How an openSession should reflect in the URL. 'push' = new history entry
 *  (user pick), 'replace' = correct in place (initial/auto-reselect), 'none'
 *  = the browser already moved (popstate). */
type HistoryMode = 'push' | 'replace' | 'none'

/** The URL path for a session: a blank (draft) session lives at /sessions;
 *  once it has content it is addressed by id at /sessions/{id}. */
function urlForSession(id: string | null, blank: boolean): string {
  return (!id || blank) ? '/sessions' : `/sessions/${id}`
}

/** Read the session id from the URL: /sessions/{id} → id, /sessions or / → null (draft). */
function sessionFromUrl(): string | null {
  const path = location.pathname
  if (path === '/' || path === '/sessions') return null
  const m = path.match(/^\/sessions\/([^/]+)\/?$/)
  return m ? decodeURIComponent(m[1]) : null
}

/** Sync the URL. push = user pick (new entry), replace = silent correction, none = browser already moved. */
function navigate(target: string, mode: HistoryMode): void {
  if (location.pathname === target) return
  if (mode === 'push') history.pushState({}, '', target)
  else if (mode === 'replace') history.replaceState({}, '', target)
}

/**
 * The session data hub: one live downlink (session events, stream deltas,
 * approvals, stats, agent status) plus the session list CRUD the UI binds
 * against. The session list itself is refreshed via HTTP (debounced); events
 * for the ACTIVE session are appended here, others ignored.
 */
export function useSessionHub() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [pending, setPending] = useState<ApprovalRequest[]>([])
  const [stream, setStream] = useState<StreamDelta | null>(null)
  const [stats, setStats] = useState<SessionStats | null>(null)
  const streamBuf = useRef<StreamDelta | null>(null)
  const streamRaf = useRef<number | null>(null)
  const [connected, setConnected] = useState(false)
  /** Authoritative running flag from agent/status frames; null = unknown, derive from events. */
  const [running, setRunning] = useState<boolean | null>(null)

  // Refs the mount effect reads so it always sees the CURRENT selection.
  const activeIdRef = useRef<string | null>(null)
  /** Mirror of `sessions` for synchronous blank-flag lookup in openSession. */
  const sessionsRef = useRef<SessionSummary[]>([])
  /** True while the active session's log is empty — drives the draft URL (/sessions). */
  const blankRef = useRef(true)
  const busyRef = useRef(false)
  const fetchGen = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track whether the active session has an open turn, for onSend routing.
  useEffect(() => {
    busyRef.current = isTurnOpen(events)
  }, [events])

  /** Load one session into the active view. `push` (default) records the pick
   *  as a history entry; `replace` silently corrects a stale/initial URL; the
   *  popstate handler passes `none` since the browser already moved.
   *  A blank (empty) session is addressed as /sessions (draft); the first
   *  content event promotes it to /sessions/{id}. */
  const openSession = useCallback((id: string, mode: HistoryMode = 'push') => {
    const gen = ++fetchGen.current
    activeIdRef.current = id
    setActiveId(id)
    // Unknown id (just created) is blank; known sessions use their flag.
    const summary = sessionsRef.current.find(s => s.id === id)
    blankRef.current = summary ? summary.blank : true
    navigate(urlForSession(id, blankRef.current), mode)
    setStream(null)
    setStats(null)
    setRunning(null)
    streamBuf.current = null
    setPending(prev => prev.filter(p => p.sessionId === undefined || p.sessionId === id))
    setEvents([])
    void fetchState(id).then(state => {
      if (gen !== fetchGen.current) return
      setEvents(prev => mergeBySeq(prev, state.events))
      setStats(state.stats)
    }).catch(() => {})
  }, [])

  /** Debounced /api/sessions refresh; re-selects a session if the active one vanished. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void fetchSessions().then(list => {
        sessionsRef.current = list
        setSessions(list)
        const id = activeIdRef.current
        if (id === null || !list.some(s => s.id === id)) {
          const next = list[0]?.id ?? null
          // Vanished auto-reselect is a correction, not a user navigation —
          // replace the stale URL instead of stacking history entries.
          if (next !== null) openSession(next, 'replace')
          else void createSession().then(created => { if (created) openSession(created, 'replace') }).catch(() => {})
        }
      }).catch(() => {})
    }, 400)
  }, [openSession])

  const onSend = useCallback(async (text: string) => {
    const id = activeIdRef.current
    if (id === null) return
    // A turn is already open: steer it into the next step boundary instead
    // of starting (and immediately rejecting) a second turn.
    if (busyRef.current) {
      const steered = await steer(text, id).catch(() => false)
      if (steered) return
    }
    await send(text, id).catch(() => {})
  }, [])

  /** Abort the open turn of the active session. */
  const onStop = useCallback(async () => {
    const id = activeIdRef.current
    if (id === null) return
    await stop(id).catch(() => {})
  }, [])

  const onNewChat = useCallback(async () => {
    const id = await createSession().catch(() => null)
    if (id === null) return
    openSession(id)
    scheduleRefresh()
  }, [openSession, scheduleRefresh])

  const onRename = useCallback(async (id: string, title: string) => {
    await renameSession(id, title).catch(() => {})
    scheduleRefresh()
  }, [scheduleRefresh])

  const onDelete = useCallback(async (id: string) => {
    await deleteSession(id).catch(() => {})
    scheduleRefresh()
  }, [scheduleRefresh])

  useEffect(() => {
    let disposed = false
    const dispose = connect((message) => {
      if (disposed) return
      switch (message.kind) {
        case 'session/event':
          if (message.sessionId === activeIdRef.current) {
            // A blank draft receiving its first event is now persisted —
            // commit its id into the URL (replace, so back stays clean).
            if (blankRef.current) {
              blankRef.current = false
              navigate(urlForSession(message.sessionId, false), 'replace')
            }
            // A step settling (or a turn boundary) ends the live stream for it.
            if (message.event.type === 'turn/start' || message.event.type === 'turn/end' || message.event.type === 'assistant/message') {
              setStream(null)
              streamBuf.current = null
            }
            setEvents(prev => mergeBySeq(prev, [message.event]))
          }
          scheduleRefresh()
          break
        case 'stream/delta':
          if (message.stream.sessionId === activeIdRef.current) {
            // Coalesce deltas into one per-frame update (accumulating, so bursts between frames are not dropped).
            streamBuf.current = mergeDelta(streamBuf.current, message.stream)
            if (streamRaf.current === null) {
              streamRaf.current = requestAnimationFrame(() => {
                streamRaf.current = null
                const buffered = streamBuf.current
                streamBuf.current = null
                if (buffered !== null) setStream(prev => mergeDelta(prev, buffered))
              })
            }
          }
          break
        case 'approval/request':
          if (message.request.sessionId === undefined || message.request.sessionId === activeIdRef.current) {
            setPending(prev => [...prev.filter(p => p.id !== message.request.id), message.request])
          }
          break
        case 'approval/settled':
          setPending(prev => prev.filter(p => p.id !== message.id))
          break
        case 'stats':
          if (message.sessionId === activeIdRef.current) setStats(message.stats)
          break
        case 'agentStatus':
          if (message.sessionId === activeIdRef.current) setRunning(message.status === 'running')
          break
        case 'session/created':
        case 'session/removed':
          scheduleRefresh()
          break
        case 'reload':
          location.reload()
          break
      }
    }, setConnected)

    // Back/forward: the browser already moved the URL, so load without
    // pushing a new entry. /sessions/{id} resumes that session; /sessions or
    // / (draft/root) is rewritten to the active session's state.
    const onPopState = () => {
      const id = sessionFromUrl()
      if (id !== null && id !== activeIdRef.current) openSession(id, 'none')
      else navigate(urlForSession(activeIdRef.current, blankRef.current), 'replace')
    }
    window.addEventListener('popstate', onPopState)

    // Initial load: the URL is authoritative. /sessions/{id} resumes that
    // conversation if it still exists; /sessions or / (or a stale id) opens a
    // blank draft — reusing an existing blank if one exists, else creating one.
    void (async () => {
      const list = await fetchSessions().catch(() => [] as SessionSummary[])
      if (disposed) return
      sessionsRef.current = list
      setSessions(list)
      const urlId = sessionFromUrl()
      if (urlId !== null && list.some(s => s.id === urlId)) {
        openSession(urlId, 'replace')
      } else {
        const blank = list.find(s => s.blank)
        if (blank) openSession(blank.id, 'replace')
        else {
          const created = await createSession().catch(() => null)
          if (disposed) return
          if (created !== null) {
            openSession(created, 'replace')
            scheduleRefresh()
          }
        }
      }
    })()

    return () => {
      disposed = true
      window.removeEventListener('popstate', onPopState)
      if (streamRaf.current !== null) cancelAnimationFrame(streamRaf.current)
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
      dispose()
    }
  }, [openSession, scheduleRefresh])

  return { sessions, activeId, events, pending, stream, stats, running, connected, onSelect: openSession, onSend, onStop, onNewChat, onRename, onDelete }
}
