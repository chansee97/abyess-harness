import { DisclosureRow, IconDataOutline16 } from '@abyss-harness/client-ui-primitives'
import clsx from 'clsx'
import type { ToolItem } from '../index.ts'
import { bashCardModel, readCardModel, writeCardModel } from './models.ts'
import { ReadRow } from './toolviews/read-row.tsx'
import { WriteRow } from './toolviews/write-row.tsx'
import { BashRow } from './toolviews/bash-row.tsx'
import css from './ToolCard.module.css'

/** Per-tool body dispatch; a tool with no dedicated view falls back to the
    generic args/result dump. Models return null on malformed records. */
function renderBody(item: ToolItem) {
  const read = readCardModel(item)
  if (read) return <ReadRow model={read} item={item} />
  const write = writeCardModel(item)
  if (write) return <WriteRow model={write} item={item} />
  const bash = bashCardModel(item)
  if (bash) return <BashRow model={bash} item={item} />
  return null
}

/**
 * A tool-call row, shaped like the Think block: no card chrome and no status
 * head — the disclosure row carries everything (title, collapsed args
 * preview, expanded body). Running rides the same summary sweep as Think;
 * a denied call tints the title danger.
 */
export function ToolCard({ item }: { item: ToolItem }) {
  const result = item.result
  const running = !result
  const denied = !!result?.denied
  const title = item.name.charAt(0).toUpperCase() + item.name.slice(1)
  const truncated = result && !denied
    ? result.content.length > 400 ? result.content.slice(0, 400) + '…' : result.content
    : result?.content
  const argsPreview = item.argsText.replace(/\s+/g, ' ').slice(0, 120)
  const body = renderBody(item)

  return (
    <div className={css.root}>
      <DisclosureRow
        icon={<IconDataOutline16 size={14} className={css.leadingIcon} />}
        title={<span className={clsx(denied && css.titleDenied)}>{title}</span>}
        summaryClassName={running ? css.sweep : undefined}
        collapsedContent={argsPreview !== '' ? <span className={css.preview}>{argsPreview}</span> : undefined}
      >
        {body ?? (
          <>
            <pre className={css.pre}>{item.argsText}</pre>
            {result && <pre className={clsx(css.pre, denied && css.preDenied)}>{truncated}</pre>}
          </>
        )}
      </DisclosureRow>
    </div>
  )
}
