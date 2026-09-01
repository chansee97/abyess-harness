/**
 * Sync code highlighter on shiki's JS regex engine (no oniguruma WASM).
 * Unknown languages fall back to plain text by returning null.
 */
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import langTsx from '@shikijs/langs/tsx'
import langJs from '@shikijs/langs/javascript'
import langBash from '@shikijs/langs/bash'
import langJson from '@shikijs/langs/json'
import langPython from '@shikijs/langs/python'
import langDiff from '@shikijs/langs/diff'
import langHtml from '@shikijs/langs/html'
import langCss from '@shikijs/langs/css'

/** Fence infostring aliases → loaded grammar ids. */
const LANG_ALIASES: Record<string, string> = {
  js: 'tsx', jsx: 'tsx', cjs: 'tsx', mjs: 'tsx', ts: 'tsx',
  sh: 'bash', shell: 'bash', py: 'python', jsonc: 'json',
  md: 'markdown', yaml: 'yaml', yml: 'yaml',
}

const highlighter = createHighlighterCoreSync({
  themes: [createCssVariablesTheme({ variablePrefix: '--shiki-' })],
  langs: [langTsx, langJs, langBash, langJson, langPython, langDiff, langHtml, langCss],
  engine: createJavaScriptRegexEngine(),
})

/** Highlight `code` in `language`; null when the language is unknown or absent. */
export function highlightToHtml(code: string, language?: string): string | null {
  if (!language) return null
  const lang = LANG_ALIASES[language] ?? language
  if (!highlighter.getLoadedLanguages().includes(lang)) return null
  return highlighter.codeToHtml(code, { lang, theme: 'css-variables' })
}
