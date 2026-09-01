/** Design tokens and base reset. Importing the package applies all four. */
import './reset.css'
import './theme.css'
import './scrollbar.css'
import './shiki.css'
export { getInitialTheme, applyTheme, watchSystemTheme, useThemeMode } from './theme.ts'
export type { ThemeMode } from './theme.ts'
