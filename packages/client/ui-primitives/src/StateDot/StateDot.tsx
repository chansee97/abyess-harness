import clsx from 'clsx'
import css from './StateDot.module.css'

const STATES = {
  idle: css.idle,
  running: css.running,
  ok: css.ok,
  denied: css.denied,
  error: css.error,
}

/** Status dot with a themed color by state. */
export function StateDot({ state, className = '' }: { state: 'idle' | 'running' | 'ok' | 'denied' | 'error'; className?: string }) {
  return <span className={clsx(css.dot, STATES[state], className)} aria-hidden />
}
