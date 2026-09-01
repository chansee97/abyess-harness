import type { ApprovalRequest, SessionEvent, StreamDelta } from '@abyss-harness/client-connection'
import { ToolCard } from '@abyss-harness/client-ui-tool'
import { Button, IconChevronDownOutline14, IconLoadingOutline16, IconWarningOutline16 } from '@abyss-harness/client-ui-primitives'
import { fold, isTurnOpen, openTurnSeq, type ChatItem } from './fold.ts'
import { MessageItem } from './MessageItem.tsx'
import { Welcome } from './Welcome.tsx'
import { usePinnedScroll } from './usePinnedScroll.ts'
import css from './ChatView.module.css'

function renderItem(item: ChatItem, index: number) {
  switch (item.kind) {
    case 'divider':
      // Turn boundaries are just column gap — no visible separator (harness has none).
      return null
    case 'user':
    case 'assistant':
      return (
        <MessageItem
          key={index}
          role={item.kind}
          text={item.text}
          reasoning={item.kind === 'assistant' ? item.reasoning : undefined}
          time={item.time}
        />
      )
    case 'tool':
      return <ToolCard key={index} item={item} />
    case 'error':
      return (
        <div key={index} className={css.error} role="alert">
          <IconWarningOutline16 />
          <span>{item.text}</span>
        </div>
      )
    case 'notice':
      return <div key={index} className={css.notice}>{item.text}</div>
  }
}

/** New chat: nothing folded yet, no approvals, no live stream — the layout
 *  uses this to center the welcome + composer group mid-screen. */
export function isEmptyConversation(events: readonly SessionEvent[], pending: readonly ApprovalRequest[], stream?: StreamDelta | null): boolean {
  const streaming = stream !== null && stream !== undefined && isTurnOpen(events) && stream.turnSeq === openTurnSeq(events)
  return fold(events).length === 0 && pending.length === 0 && !streaming
}

/** The conversation timeline: folded session events plus the live stream
 *  bubble. Pending approvals/questions are NOT rendered here — like dsh's
 *  composer chain, they take over the composer slot instead. */
export function ChatView({ activeId, events, pending, stream }: {
  activeId: string | null
  events: readonly SessionEvent[]
  /** Only counts toward the empty/new-chat state; rendering lives in the
   *  composer slot (app assembly). */
  pending: ApprovalRequest[]
  stream?: StreamDelta | null
}) {
  const items = fold(events)
  const empty = isEmptyConversation(events, pending, stream)
  const thinking = isTurnOpen(events) && !stream
  const streaming = stream !== null && stream !== undefined && isTurnOpen(events) && stream.turnSeq === openTurnSeq(events)
  const { listRef, pinned, handleScroll, scrollToBottom } = usePinnedScroll(
    [events, stream?.text, stream?.reasoning],
    activeId,
  )

  return (
    <div className={empty ? `${css.chatArea} ${css.chatAreaEmpty}` : css.chatArea}>
      <div
        className={css.chatList}
        ref={listRef}
        onScroll={handleScroll}>
        <div className={css.column}>
          {empty && <Welcome />}
          {items.map((item, index) => renderItem(item, index))}
          {streaming && stream !== null && (
            <MessageItem
              role="assistant"
              text={stream.text}
              reasoning={stream.reasoning}
              streaming
            />
          )}
          {thinking && (
            <div className={css.thinking}>
              <IconLoadingOutline16 className={css.thinkingIcon} />
              正在思考…
            </div>
          )}
        </div>
      </div>
      {/* Fixed to the chat area's bottom (sibling of the scroller, out of
          flow): shown only while scrolled up, fades in/out, jumps instantly. */}
      <Button
        variant="outline"
        className={css.backToBottom}
        icon={<IconChevronDownOutline14 />}
        aria-label="回到底部"
        data-visible={!pinned || undefined}
        onClick={scrollToBottom}
      />
    </div>
  )
}
