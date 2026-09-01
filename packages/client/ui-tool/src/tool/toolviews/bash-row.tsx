import type { ToolItem } from '../../index.ts'
import type { BashModel } from '../models.ts'
import { truncate } from './read-row.tsx'
import css from '../ToolCard.module.css'

/** bash body: the command line in shell style, then stdout/stderr output.
    A denied request has no run to show, only the command echo. */
export function BashRow({ model, item }: { model: BashModel; item: ToolItem }) {
  return (
    <div className={css.viewBody}>
      <pre className={css.command}>$ {model.command}</pre>
      {item.result && !item.result.denied && (
        <pre className={css.pre}>{truncate(item.result.content)}</pre>
      )}
    </div>
  )
}
