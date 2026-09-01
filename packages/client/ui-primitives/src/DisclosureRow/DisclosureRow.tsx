import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, IconTriangleRightFill14 } from '../icons/index.tsx'
import css from './DisclosureRow.module.css'

/**
 * Expandable disclosure row. While collapsed, an optional leading `icon` is
 * shown and a chevron replaces it on hover; without an icon a chevron shows
 * outright. A `collapsedContent` preview may follow the title while collapsed.
 * The expanded body holds the full content.
 */
export function DisclosureRow({ icon, title, collapsedContent, keepContentWhenOpen = false, summaryClassName, children, defaultOpen = false, className }: {
  icon?: ReactNode
  title: ReactNode
  collapsedContent?: ReactNode
  /** Keep the collapsed preview inline while open too (default hides it). */
  keepContentWhenOpen?: boolean
  /** Extra class for the clickable summary row (e.g. a running sweep). */
  summaryClassName?: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  const leading = open
    ? <IconChevronDownOutline14 className={clsx(css.chevron, css.chevronOpen)} />
    : icon !== undefined
      ? (
        <>
          <IconChevronDownOutline14 className={clsx(css.chevron, css.chevronHover)} />
          <span className={css.icon}>{icon}</span>
        </>
      )
      : <IconTriangleRightFill14 className={css.chevron} />

  return (
    <details className={clsx(css.disclosure, open && css.open, className)} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className={clsx(css.summary, summaryClassName)}>
        <span className={css.leading}>{leading}</span>
        <span className={css.title}>{title}</span>
        {(keepContentWhenOpen || !open) && collapsedContent}
      </summary>
      <div className={css.body}>{children}</div>
    </details>
  )
}
