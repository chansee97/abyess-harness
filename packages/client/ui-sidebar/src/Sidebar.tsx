import { useState } from 'react'
import clsx from 'clsx'
import { Button, IconNewChatOutline16, IconPanelLeftOutline16, IconSettingsOutline16, Tooltip } from '@abyss-harness/client-ui-primitives'
import type { SessionSummary } from '@abyss-harness/client-connection'
import { SessionList } from './SessionList.tsx'
import { SettingsDialog } from './SettingsDialog.tsx'
import css from './Sidebar.module.css'

/**
 * Left rail: brand header with the collapse toggle at its far right, a new-chat
 * button, the scrollable conversation history, and settings pinned to the
 * bottom. All controls come off the shared Button atom as-is; the collapsed
 * state hides their labels and switches the two labeled rows to compact ghost
 * sm discs. `.disc` opts those two out of their column-flex stretch, so all
 * three rail icons (header toggle included) render one uniform 30px disc.
 */
export function Sidebar({ collapsed, onToggle, sessions, activeId, onSelect, onNewChat, onRename, onDelete }: {
  collapsed: boolean
  onToggle: () => void
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className={clsx(css.sidebar, collapsed && css.collapsed)}>
      <div className={css.header}>
        <span className={css.brandName}>
          <AbyssBrandMark className={css.brandIcon} />
          {!collapsed && <span className={css.brandText}>abyss-harness</span>}
        </span>
        <Tooltip
          label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          side="right">
          <Button
            variant="ghost"
            size="sm"
            icon={
              <IconPanelLeftOutline16
                className={collapsed ? css.toggleCollapsed : undefined}
              />
            }
            onClick={onToggle}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          />
        </Tooltip>
      </div>

      {/* Middle region grows to fill; settings stay pinned to the bottom. */}
      <div className={css.middle}>
        <Button
          variant={collapsed ? 'ghost' : 'outline'}
          size={collapsed ? 'sm' : 'md'}
          className={css.disc}
          icon={<IconNewChatOutline16 />}
          onClick={onNewChat}>
          {!collapsed && '新建对话'}
        </Button>
        {!collapsed && (
          <SessionList
            sessions={sessions}
            activeId={activeId}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        )}
      </div>

      <Button
        variant="ghost"
        size={collapsed ? 'sm' : 'md'}
        className={clsx(css.settings, css.disc)}
        icon={<IconSettingsOutline16 />}
        onClick={() => setSettingsOpen(true)}>
        {!collapsed && '设置'}
      </Button>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

/**
 * The brand mark — the abyss face from apps/web/public/icon.svg (the browser-tab
 * favicon), inlined here rather than added to the shared icon set. Two-tone fixed
 * fills so it reads identical to the favicon on any theme.
 */
function AbyssBrandMark({ className }: { className?: string }) {
  return (
    <svg width={16} height={16} className={className} viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M512 512m-409.6 0a409.6 409.6 0 1 0 819.2 0 409.6 409.6 0 1 0-819.2 0Z" fill="#B197FC" />
      <path
        d="M512 492.8A224 224 0 0 1 736 716.8a19.2 19.2 0 0 1-38.4 0 185.6 185.6 0 0 0-371.2 0 19.2 19.2 0 0 1-38.4 0A224 224 0 0 1 512 492.8zM391.68 358.4a33.28 33.28 0 1 1-0.0512 66.56A33.28 33.28 0 0 1 391.68 358.4z m240.64 0a33.28 33.28 0 0 1 0 66.56 33.28 33.28 0 0 0 0-66.56z"
        fill="#183153"
      />
    </svg>
  )
}
