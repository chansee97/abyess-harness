import { useLayoutEffect, useRef, useState } from 'react'

/** Treat "near the bottom" as pinned; content growth only auto-scrolls while pinned. */
const FOLLOW_THRESHOLD = 24

/**
 * Follow-the-bottom scrolling for a transcript scroller: ref to attach to
 * the scroll container, autoscroll on `deps` changes only while pinned,
 * and pin/unpin driven by how close the user has scrolled to the bottom.
 *
 * `resetKey` (the active session id) re-pins to the bottom on session
 * switch so the back-to-bottom button never lingers from a previous session
 * the user had scrolled up in.
 */
export function usePinnedScroll(deps: readonly unknown[], resetKey?: unknown) {
  const listRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)

  // Session switch: re-pin so a scroll-up state from the previous session
  // doesn't carry over (and the new session starts at the bottom).
  useLayoutEffect(() => {
    pinnedRef.current = true
    setPinned(true)
  }, [resetKey])

  // Follow the bottom only while pinned (near bottom); never yank the user away.
  useLayoutEffect(() => {
    if (!pinnedRef.current) return
    const el = listRef.current
    if (el !== null) el.scrollTo({ top: el.scrollHeight })
  }, deps)

  const handleScroll = () => {
    const el = listRef.current
    if (el === null) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD
    pinnedRef.current = near
    setPinned(prev => (prev === near ? prev : near))
  }

  const scrollToBottom = () => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }

  return { listRef, pinned, handleScroll, scrollToBottom }
}
