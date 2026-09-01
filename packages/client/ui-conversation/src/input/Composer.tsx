import { useEffect, useRef, useState } from 'react'
import { Button, IconSendOutline16, IconStopFill16, SandboxModeSelect, Tooltip } from '@abyss-harness/client-ui-primitives'
import type { SandboxMode } from '@abyss-harness/client-ui-primitives'
import { fetchSandboxPolicy, setSandboxMode, type SandboxPolicy } from '@abyss-harness/client-connection'
import css from './Composer.module.css'

/** The current session's file-policy chip: display + switch, mirroring
 *  harness's composer permission chip. Rides the composer's bottom-left
 *  slot; per-session override, distinct from the settings' global default. */
function PolicyChip({ sessionId }: { sessionId?: string | null }) {
  const [policy, setPolicy] = useState<SandboxPolicy | null>(null)

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    fetchSandboxPolicy(sessionId)
      .then(value => { if (!cancelled) setPolicy(value) })
      .catch(() => { if (!cancelled) setPolicy(null) })
    return () => { cancelled = true }
  }, [sessionId])

  if (!sessionId || !policy) return null

  async function switchMode(mode: SandboxMode) {
    // Optimistic; the POST returns the resolved policy as confirmation.
    setPolicy(previous => previous ? { ...previous, mode } : previous)
    try {
      setPolicy(await setSandboxMode(sessionId!, mode))
    } catch {
      fetchSandboxPolicy(sessionId!).then(setPolicy).catch(() => setPolicy(null))
    }
  }

  return (
    <SandboxModeSelect
      value={policy.mode}
      onSwitch={switchMode}
      side="top"
      align="start"
      title="当前对话的文件策略"
    />
  )
}

/** The message composer: a floating capsule card, mirroring harness's InputBar.
    While a turn runs, the send button becomes a stop button and typed input
    steers the open turn (it joins the log at the next step boundary); the
    session's stats strip renders in the dock above (StatsLine). */
export function Composer({ connected, busy, sessionId, onSend, onStop }: {
  connected: boolean
  /** True while the selected session has an open turn. */
  busy?: boolean
  /** The selected session — carries the per-session file-policy chip. */
  sessionId?: string | null
  onSend: (text: string) => Promise<void>
  onStop?: () => void
}) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the textarea up to its cap.
  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  async function submit() {
    const text = input.trim()
    if (!text) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await onSend(text).catch(() => {})
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <form
      className={css.root}
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className={css.card}>
        <textarea
          ref={textareaRef}
          className={css.input}
          value={input}
          onChange={event => {
            setInput(event.target.value)
            autoGrow()
          }}
          onKeyDown={onKeyDown}
          placeholder={connected ? (busy ? '回复中，输入将插入下一步…' : '输入消息…') : '连接中…'}
          rows={1}
          disabled={!connected}
        />
        <div className={css.actionRow}>
          {/* Bottom-left slot: the session's file-policy chip pinned to the
              far left (send sits far right). */}
          <span className={css.policySlot}>
            <PolicyChip sessionId={sessionId} />
          </span>
          {busy
            ? (
              <Tooltip label="停止" side="top">
                <Button
                  variant="outline"
                  size="md"
                  type="button"
                  className={css.stop}
                  icon={<IconStopFill16 />}
                  aria-label="停止"
                  onClick={() => onStop?.()}
                />
              </Tooltip>
            )
            : (
              <Tooltip label="发送" side="top">
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  className={css.send}
                  icon={<IconSendOutline16 />}
                  aria-label="发送"
                  disabled={!input.trim() || !connected}
                />
              </Tooltip>
            )}
        </div>
      </div>
    </form>
  )
}
