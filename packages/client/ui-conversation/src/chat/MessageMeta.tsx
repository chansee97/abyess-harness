import clsx from 'clsx'
import { Button, formatClock, IconCheckOutline16, IconCopyOutline16, Tooltip, useCopyFeedback } from '@abyss-harness/client-ui-primitives'
import css from './MessageMeta.module.css'

/**
 * Timestamp + copy under a message. The clock is hover-revealed (touch
 * devices keep it visible) and sits at the outer edge: left under user
 * bubbles, right under assistant text. The copy action is always visible.
 */
export function MessageMeta({ time, copyable, side }: {
  time: number | undefined
  copyable: string
  side: 'user' | 'assistant'
}) {
  const { copied, onCopy } = useCopyFeedback(copyable)
  const clock = formatClock(time)
  const timeEl = clock !== '' && <span className={css.time}>{clock}</span>
  const copyEl = (
    <Tooltip label={copied ? '已复制' : '复制'} side="top">
      <Button
        variant="ghost"
        size="sm"
        className={css.action}
        icon={copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        aria-label={copied ? '已复制' : '复制'}
        onClick={onCopy}
      />
    </Tooltip>
  )

  return (
    <div className={clsx(css.meta, side === 'assistant' && css.assistantMeta)}>
      {side === 'user' ? timeEl : copyEl}
      {side === 'user' ? copyEl : timeEl}
    </div>
  )
}
