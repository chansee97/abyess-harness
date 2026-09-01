// Button: token-styled button atom for every button control in the client
// (pills→soft rects, discs, rail rows, quiet icon actions). Call sites never
// re-chrome a raw <button> — they consume this atom and pass a className
// stating only their own geometry/tint deltas; base chrome and hover/disabled
// come from here. Feature stylesheets load after this package's, so those
// overrides win.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Button.module.css'

/** Visual variant. */
export type ButtonVariant = 'primary' | 'ghost' | 'outline'

/**
 * Render a soft-cornered rectangular button sized by content + padding.
 * A button with an icon but no label renders as a 1:1 disc (mirroring the
 * harness icon-only buttons).
 * @param props.variant - visual family (default 'ghost').
 * @param props.size - 'md' default or 'sm' compact.
 * @param props.icon - optional leading 16px icon node.
 * @returns the button element; native button attributes pass through.
 */
export function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }: {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  icon?: ReactNode
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  // No textual content → the button is its icon alone: shape it as a circle
  // (`false` and `''` count as absent, so conditional labels stay clean).
  const iconOnly = children == null || children === false || children === ''
  return (
    <button type="button" className={clsx(css.button, css[variant], css[size], iconOnly && css.iconOnly, className)} {...rest}>
      {icon != null && <span className={css.icon}>{icon}</span>}
      {children}
    </button>
  )
}
