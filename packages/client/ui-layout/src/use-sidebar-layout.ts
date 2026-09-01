import { useCallback, useEffect, useRef, useState } from 'react'
import { clampSidebar, computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'

/**
 * The sidebar solver for AppFrame: viewport tracking on the frame's own box
 * (rAF-throttled ResizeObserver), auto-collapse below the breakpoint with a
 * manual override, and the drag gesture whose base is the rendered width
 * captured at drag start (grabbing a clamp-limited panel must not jump back
 * to the stored preference; it stays frozen for the whole gesture so dx
 * deltas do not compound).
 */
export function useSidebarLayout(frameRef: React.RefObject<HTMLDivElement | null>) {
  const [sidebarPref, setSidebarPref] = useState(SIDEBAR_DEFAULT)
  const [viewport, setViewport] = useState(window.innerWidth)
  const [narrow, setNarrow] = useState(window.innerWidth < SIDEBAR_AUTO_COLLAPSE)
  const [narrowExpanded, setNarrowExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Viewport tracking for the sidebar solver: rAF-throttled ResizeObserver on
  // the frame's own box (not the window).
  useEffect(() => {
    const el = frameRef.current
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [frameRef])

  // Narrow viewports auto-collapse the sidebar; crossing the breakpoint in
  // either direction drops the manual re-expand override.
  useEffect(() => {
    setNarrow(prev => (prev === (viewport < SIDEBAR_AUTO_COLLAPSE)) ? prev : (viewport < SIDEBAR_AUTO_COLLAPSE))
  }, [viewport])
  useEffect(() => {
    setNarrowExpanded(false)
  }, [narrow])

  const collapsed = narrow ? !narrowExpanded : sidebarPref === 0
  const onToggle = useCallback(() => {
    if (narrow) setNarrowExpanded(prev => !prev)
    else setSidebarPref(prev => prev === 0 ? SIDEBAR_DEFAULT : 0)
  }, [narrow])

  const cols = computeColumns(viewport, collapsed ? 0 : sidebarPref)

  const sidebarBase = useRef(0)
  const sidebarRef = useRef(cols.sidebar)
  sidebarRef.current = cols.sidebar
  const onHandleStart = useCallback(() => {
    sidebarBase.current = sidebarRef.current
    setDragging(true)
  }, [])
  const onHandleDrag = useCallback((dx: number) => {
    setSidebarPref(clampSidebar(sidebarBase.current + dx))
  }, [])
  const onHandleEnd = useCallback(() => { setDragging(false) }, [])

  return { collapsed, dragging, cols, onToggle, onHandleStart, onHandleDrag, onHandleEnd }
}
