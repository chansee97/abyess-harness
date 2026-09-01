import { memo, useMemo } from 'react'
import { Button, IconCheckOutline16, IconCopyOutline16, Tooltip, useCopyFeedback } from '@abyss-harness/client-ui-primitives'
import { highlightToHtml } from './highlight.ts'
import css from './CodeBlock.module.css'

/** Fenced code block: shiki highlighting once settled, language label + copy button. */
export const CodeBlock = memo(function CodeBlock({ language, code, streaming }: {
  language?: string
  code: string
  streaming?: boolean
}) {
  const { copied, onCopy } = useCopyFeedback(code)
  const html = useMemo(() => {
    if (streaming) return null
    try { return highlightToHtml(code, language) } catch { return null }
  }, [code, language, streaming])

  return (
    <div className={css.block}>
      {!streaming && (
        <div className={css.header}>
          {language && <span className={css.lang}>{language}</span>}
          <Tooltip label={copied ? '已复制' : '复制'} side="top">
            <Button
              variant="ghost"
              size="sm"
              className={css.copy}
              icon={copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
              aria-label={copied ? '已复制' : '复制'}
              onClick={onCopy}
            />
          </Tooltip>
        </div>
      )}
      {html !== null
        ? <div className={css.highlighted} dangerouslySetInnerHTML={{ __html: html }} />
        : <pre className={css.plain}><code>{code}</code></pre>}
    </div>
  )
})
