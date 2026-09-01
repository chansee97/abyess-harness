import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { DisclosureRow, IconThinkOutline14 } from '@abyss-harness/client-ui-primitives'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Collapsible "Think" block. The leading think icon becomes a chevron on
 * hover (and stays a chevron while open); the fixed label follows; the
 * collapsed state shows a one-line preview after the label, the expanded
 * body holds the full prose (nothing duplicated on top).
 */
export function ReasoningRow({ text, running }: { text: string; running?: boolean }) {
  const isRunning = running ?? false
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = isRunning ? latestLine(text) : firstLine(text)

  // While running, keep the collapsed preview scrolled to its tail.
  useEffect(() => {
    if (!isRunning) return
    const el = summaryRef.current
    if (el === null) return
    let raf = 0
    const frame = () => { el.scrollLeft = el.scrollWidth; raf = 0 }
    frame()
    raf = requestAnimationFrame(frame)
    return () => { if (raf !== 0) cancelAnimationFrame(raf) }
  }, [text, isRunning])

  const preview = summary !== '' && (
    <>
      <span className={css.separator} aria-hidden />
      <span ref={summaryRef} className={clsx(css.content, isRunning && css.followEnd)}>{summary}</span>
    </>
  )

  return (
    <div className={css.root}>
      <DisclosureRow
        icon={<IconThinkOutline14 className={css.leadingIcon} />}
        title="Think"
        summaryClassName={isRunning ? css.sweep : undefined}
        collapsedContent={preview}>
        <div className={css.body}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
