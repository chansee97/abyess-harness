import { useState } from 'react'
import type { SessionSummary } from '@abyss-harness/client-connection'
import { SessionRow } from './SessionRow.tsx'
import { RenameDialog } from './RenameDialog.tsx'
import { DeleteConfirmDialog } from './DeleteConfirmDialog.tsx'
import css from './SessionList.module.css'

/**
 * The conversation history: one row per session (newest first) with
 * hover-revealed rename/delete dialogs.
 */
export function SessionList({ sessions, activeId, onSelect, onRename, onDelete }: {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}) {
  const [renameFor, setRenameFor] = useState<SessionSummary | null>(null)
  const [deleteFor, setDeleteFor] = useState<SessionSummary | null>(null)

  // Blank drafts (a new chat with no message yet) are not real records: they
  // stay out of the history list and are reused in-memory until the first
  // message turns them into a persisted conversation.
  const visible = sessions.filter(session => !session.blank)

  return (
    <div className={css.list}>
      {visible.length === 0 && <div className={css.empty}>还没有对话</div>}
      {visible.map(session => (
        <SessionRow
          key={session.id}
          session={session}
          active={session.id === activeId}
          onSelect={onSelect}
          onRenameRequest={setRenameFor}
          onDeleteRequest={setDeleteFor}
        />
      ))}

      {renameFor !== null && (
        <RenameDialog
          session={renameFor}
          onCancel={() => setRenameFor(null)}
          onSave={title => {
            onRename(renameFor.id, title)
            setRenameFor(null)
          }}
        />
      )}

      {deleteFor !== null && (
        <DeleteConfirmDialog
          session={deleteFor}
          onCancel={() => setDeleteFor(null)}
          onConfirm={() => { onDelete(deleteFor.id); setDeleteFor(null) }}
        />
      )}
    </div>
  )
}
