import { memo, isValidElement, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'
import 'katex/dist/katex.min.css'
import { CodeBlock } from './CodeBlock.tsx'
import css from './AssistantMarkdown.module.css'

const remarkPlugins: PluggableList = [remarkGfm, remarkMath]
const rehypePlugins: PluggableList = [[rehypeKatex, { throwOnError: false }]]

/** Image with lazy loading and an alt-text fallback on load failure. */
function Image({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className={css.imageAlt}>{alt || '图片加载失败'}</span>
  return (
    <img
      className={css.image}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/** Render assistant text as markdown: GFM + math (when settled) + shiki code blocks. */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text, streaming }: {
  text: string
  streaming?: boolean
}) {
  return (
    <div className={css.root}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={streaming ? [] : rehypePlugins}
        components={{
          code: ({ className, children }) => <code className={css.inlineCode}>{children}</code>,
          pre: ({ node, children }) => {
            const child = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: unknown }>) : null
            // The rendered child is our own <code> override (inlineCode class),
            // so the language-* marker must come from the raw hast node.
            let classList = ''
            for (const c of node?.children ?? []) {
              if (c.type === 'element' && c.tagName === 'code') {
                const cn = c.properties.className
                classList += Array.isArray(cn) ? cn.map(String).join(' ') : String(cn ?? '')
              }
            }
            const lang = /language-([\w-]+)/.exec(classList)?.[1]
            const code = String(child?.props.children ?? '')
            return <CodeBlock language={lang} code={code} streaming={streaming} />
          },
          ul: ({ children }) => <ul className={css.list}>{children}</ul>,
          ol: ({ children }) => <ol className={css.list}>{children}</ol>,
          li: ({ children }) => <li className={css.listItem}>{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          img: ({ src, alt }) => <Image src={src} alt={alt} />,
          table: ({ children }) => <table className={css.table}>{children}</table>,
          th: ({ children }) => <th className={css.th}>{children}</th>,
          td: ({ children }) => <td className={css.td}>{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
