import { useRef } from 'react'
import css from './AppFrame.module.css'

/**
 * One drag handle between the sidebar and center columns: pointer capture,
 * rAF-throttled dx reported against the drag-start origin (never reset), so
 * the caller derives width = base + total delta and the edge tracks the
 * pointer exactly. A pending frame is flushed on pointerup so the last
 * movement is not lost.
 */
export function DragHandle({ left, onStart, onDrag, onEnd }: {
  left: number
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
}) {
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart, onDrag, onEnd })
  callbacks.current = { onStart, onDrag, onEnd }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    callbacks.current.onEnd()
  }

  return (
    <div
      className={css.handle}
      style={{ left }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
