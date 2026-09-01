import { useEffect, useState } from 'react'
import {
  Button, IconChevronDownOutline14, IconCloseOutline16, IconFollowsystemOutline16, IconDarkOutline16,
  IconLightOutline16, IconPersonalizationOutline16, IconSettingsOutline16, Menu, Modal, SandboxModeSelect,
} from '@abyss-harness/client-ui-primitives'
import type { MenuItem } from '@abyss-harness/client-ui-primitives'
import { fetchSandboxPolicy, setDefaultSandboxMode, type SandboxPolicy } from '@abyss-harness/client-connection'
import { useThemeMode, type ThemeMode } from '@abyss-harness/client-ui-theme'
import css from './SettingsDialog.module.css'

const APPEARANCE_OPTIONS: { value: ThemeMode; label: string; Icon: typeof IconLightOutline16 }[] = [
  { value: 'light', label: '浅色', Icon: IconLightOutline16 },
  { value: 'dark', label: '暗色', Icon: IconDarkOutline16 },
  { value: 'system', label: '跟随系统', Icon: IconFollowsystemOutline16 },
]

/** Section registry: nav rail order and per-section content. */
const SECTIONS = [
  { id: 'general', label: '通用', Icon: IconSettingsOutline16 },
  { id: 'sandbox', label: '沙箱', Icon: IconPersonalizationOutline16 },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** Settings dialog: harness SettingsRoot's two-pane shell in miniature — a
 *  section nav rail plus a fixed-height content column, so switching sections
 *  never resizes the panel. The sandbox section owns the DEPLOYMENT default
 *  file policy; the current session's policy lives on the composer chip. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState<SectionId>('general')
  const [mode, setMode] = useThemeMode()
  const [menuOpen, setMenuOpen] = useState(false)
  const [sandbox, setSandbox] = useState<SandboxPolicy | null>(null)

  // Refetch while the dialog is open so the surface reflects the host config.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchSandboxPolicy()
      .then(policy => { if (!cancelled) setSandbox(policy) })
      .catch(() => { if (!cancelled) setSandbox(null) })
    return () => { cancelled = true }
  }, [open])

  const current = APPEARANCE_OPTIONS.find(option => option.value === mode) ?? APPEARANCE_OPTIONS[2]
  const CurrentIcon = current.Icon
  const items: MenuItem[] = APPEARANCE_OPTIONS.map(({ value, label, Icon }) => ({
    id: value,
    label,
    icon: <Icon />,
  }))

  async function switchDefaultMode(defaultMode: SandboxPolicy['mode']) {
    // Optimistic; the POST returns the resolved default as confirmation.
    setSandbox(previous => previous ? { ...previous, mode: defaultMode } : previous)
    try {
      setSandbox(await setDefaultSandboxMode(defaultMode))
    } catch {
      // Refetch the authoritative value on failure.
      fetchSandboxPolicy().then(setSandbox).catch(() => setSandbox(null))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="设置" closeLabel="关闭" headless className={css.panel}>
      <nav className={css.nav}>
        <div className={css.navTitle}>设置</div>
        <div className={css.navList}>
          {SECTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={active === id ? `${css.navCell} ${css.navCellActive}` : css.navCell}
              aria-current={active === id ? 'true' : undefined}
              onClick={() => setActive(id)}
            >
              <Icon className={css.navIcon} />
              <span className={css.navLabel}>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className={css.content}>
        <div className={css.header}>
          <h2 className={css.headerTitle}>{SECTIONS.find(section => section.id === active)?.label}</h2>
          <Button
            variant="ghost"
            size="sm"
            className={css.close}
            icon={<IconCloseOutline16 size={14} />}
            aria-label="关闭"
            onClick={onClose}
          />
        </div>
        <div className={css.options}>
          {active === 'general' && (
            <div className={css.section}>
              <div className={css.row}>
                <div className={css.rowText}>
                  <span className={css.rowTitle}>外观</span>
                  <span className={css.rowDesc}>界面配色主题。</span>
                </div>
                <Menu
                  open={menuOpen}
                  onClose={() => setMenuOpen(false)}
                  onSelect={(id) => { setMode(id as ThemeMode); setMenuOpen(false) }}
                  selectedId={mode}
                  items={items}
                  align="end"
                  portal
                  anchor={(
                    <Button
                      variant="ghost"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen(value => !value)}
                    >
                      <span className={css.rowValueIcon} aria-hidden="true"><CurrentIcon /></span>
                      <span>{current.label}</span>
                      <span className={css.rowValueChevron} aria-hidden="true"><IconChevronDownOutline14 /></span>
                    </Button>
                  )}
                />
              </div>
            </div>
          )}
          {active === 'sandbox' && (
            <div className={css.section}>
              <div className={css.row}>
                <div className={css.rowText}>
                  <span className={css.rowTitle}>默认文件策略</span>
                  <span className={css.rowDesc}>新对话默认使用；符合策略的操作自动放行，越界操作弹窗请求人工批准。当前对话可在输入框左下角切换。</span>
                </div>
                {sandbox
                  ? (
                      <SandboxModeSelect
                        value={sandbox.mode}
                        onSwitch={switchDefaultMode}
                        title="默认文件策略（新对话生效）"
                      />
                    )
                  : <span className={css.rowValue}>未挂载</span>}
              </div>
              {sandbox && (
                <div className={css.row}>
                  <div className={css.rowText}>
                    <span className={css.rowTitle}>工作区根目录</span>
                    <span className={css.rowDesc}>「工作区可写」模式下允许写入的边界。</span>
                  </div>
                  <span className={css.rowValue} title={sandbox.workspaceRoot}>{sandbox.workspaceRoot}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
