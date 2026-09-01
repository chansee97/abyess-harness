import { Button, Modal } from '@abyss-harness/client-ui-primitives'
import type { SessionSummary } from '@abyss-harness/client-connection'
import css from './SessionList.module.css'

/** Delete confirmation modal for one session. */
export function DeleteConfirmDialog({ session, onCancel, onConfirm }: {
  session: SessionSummary
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open onClose={onCancel} title="删除对话" closeLabel="取消">
      <div className={css.deleteBody}>
        <p className={css.deleteText}>确定删除「{session.title}」吗？该对话的记录将被移除。</p>
        <div className={css.deleteActions}>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button variant="outline" className={css.dangerAction} onClick={onConfirm}>删除</Button>
        </div>
      </div>
    </Modal>
  )
}
