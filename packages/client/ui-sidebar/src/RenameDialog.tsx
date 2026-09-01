import { useState } from 'react'
import { Button, Modal } from '@abyss-harness/client-ui-primitives'
import type { SessionSummary } from '@abyss-harness/client-connection'
import css from './SessionList.module.css'

/** Rename modal for one session; commits a non-empty trimmed title. */
export function RenameDialog({ session, onCancel, onSave }: {
  session: SessionSummary
  onCancel: () => void
  onSave: (title: string) => void
}) {
  const [title, setTitle] = useState(session.title)
  const commit = () => {
    const clean = title.trim()
    if (clean) onSave(clean)
  }
  return (
    <Modal open onClose={onCancel} title="重命名对话" closeLabel="关闭">
      <div className={css.renameBody}>
        <input
          autoFocus
          className={css.renameInput}
          value={title}
          onChange={event => setTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        <div className={css.renameActions}>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={commit}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
