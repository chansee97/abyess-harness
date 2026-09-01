import { memo } from 'react'
import clsx from 'clsx'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { MessageMeta } from './MessageMeta.tsx'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './MessageItem.module.css'

/**
 * A message row. User: right-aligned solid bubble. Assistant: unbubbled —
 * markdown renders directly at full column width, with reasoning as its own
 * block above the text. Meta (clock/copy) is hidden while streaming.
 */
export const MessageItem = memo(function MessageItem({ role, text, reasoning, streaming, time }: {
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  streaming?: boolean
  time?: number
}) {
  const isUser = role === 'user'
  return (
    <div className={clsx(css.row, isUser ? css.rowUser : css.rowAssistant)}>
      {isUser ? (
        <div className={css.bubbleUser}>{text}</div>
      ) : (
        <>
          {reasoning !== undefined && <ReasoningRow text={reasoning} running={streaming} />}
          <AssistantMarkdown text={text} streaming={streaming} />
        </>
      )}
      {!streaming && <MessageMeta time={time} copyable={text} side={isUser ? 'user' : 'assistant'} />}
    </div>
  )
})
