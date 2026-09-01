import { useState } from 'react'
import { Button, IconEditOutline16, IconEllipsisOutline16, formatClock, IconTrashOutline16, Menu } from '@abyss-harness/client-ui-primitives'
import type { SessionSummary } from '@abyss-harness/client-connection'
import css from './SessionList.module.css'

/**
 * One history row: active row highlighted, hover-revealed actions menu for
 * rename/delete. The clock and the menu trigger occupy the same seat — pure
 * CSS swap on hover; `data-open` only keeps the trigger visible while the
 * menu is open.
 */
export function SessionRow({ session, active, onSelect, onRenameRequest, onDeleteRequest }: {
  session: SessionSummary
  active: boolean
  onSelect: (id: string) => void
  onRenameRequest: (session: SessionSummary) => void
  onDeleteRequest: (session: SessionSummary) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={active ? css.active : undefined}>
      <div className={css.row}>
        <Button variant="ghost" size="sm" className={css.rowMain} onClick={() => onSelect(session.id)}>
          <span className={css.rowTitle}>{session.title}</span>
        </Button>
        {/* 时间和操作按钮占同一个座位：悬停时纯 CSS 换位，data-open
            只负责菜单打开期间让触发按钮保持可见。 */}
        <span className={css.rowEnd} data-open={menuOpen || undefined}>
          <span className={css.rowTime}>{formatClock(session.updatedAt)}</span>
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onSelect={action => {
              setMenuOpen(false)
              if (action === 'rename') onRenameRequest(session)
              if (action === 'delete') onDeleteRequest(session)
            }}
            items={[
              { id: 'rename', label: '重命名', icon: <IconEditOutline16 /> },
              { id: 'delete', label: '删除', danger: true, icon: <IconTrashOutline16 /> },
            ]}
            align="end"
            portal
            anchor={(
              <Button
                variant="ghost"
                size="sm"
                className={css.rowMenu}
                icon={<IconEllipsisOutline16 className={css.rowMenuIcon} />}
                aria-label="会话操作"
                onClick={event => {
                  event.stopPropagation()
                  setMenuOpen(prev => !prev)
                }}
              />
            )}
          />
        </span>
      </div>
    </div>
  )
}
