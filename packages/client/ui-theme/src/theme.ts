/**
 * Theme mode control: apply the resolved theme to <html data-theme> and
 * persist the user's selection. Three modes — dark, light, and system
 * (follow the OS `prefers-color-scheme`, live).
 */

import { useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'

/** Storage key shared with the index.html boot script (keep both in sync). */
export const THEME_STORAGE_KEY = 'abyss-harness-theme'
const KEY = THEME_STORAGE_KEY
const QUERY = '(prefers-color-scheme: dark)'

function systemResolved(): 'dark' | 'light' {
  return window.matchMedia(QUERY).matches ? 'dark' : 'light'
}

function resolvedOf(mode: ThemeMode): 'dark' | 'light' {
  return mode === 'system' ? systemResolved() : mode
}

/**
 * Write one resolved theme to the DOM. Kept identical to the inline boot
 * script in index.html — that script must run before the CSS loads so the
 * first painted frame is already in the right theme (no FOUC).
 */
function applyResolved(resolved: 'dark' | 'light'): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

/** The persisted selection; fresh installs default to following the system. */
export function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  } catch {
    return 'system'
  }
}

/** Apply one mode: write the resolved theme to the DOM and persist the choice. */
export function applyTheme(mode: ThemeMode): void {
  applyResolved(resolvedOf(mode))
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // persistence unavailable (private mode); the in-session switch still works
  }
}

/** Subscribe to OS scheme changes (only meaningful while following the system). */
export function watchSystemTheme(onChange: (resolved: 'dark' | 'light') => void): () => void {
  const mql = window.matchMedia(QUERY)
  const handler = (event: MediaQueryListEvent): void => onChange(event.matches ? 'dark' : 'light')
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}

/** Reactive theme mode for settings: applies, persists, and follows the system. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(getInitialTheme)

  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return
    return watchSystemTheme(() => applyTheme('system'))
  }, [mode])

  return [mode, setMode]
}
