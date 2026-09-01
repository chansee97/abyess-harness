import type { ToolItem } from '../../index.ts'
import type { WriteModel } from '../models.ts'
import css from '../ToolCard.module.css'

/** write body: target path (+ byte note from the tool's result line). */
export function WriteRow({ model, item }: { model: WriteModel; item: ToolItem }) {
  return (
    <div className={css.viewBody}>
      <div className={css.caption}>
        {model.path}
        {model.byteNote && <span className={css.note}> · {model.byteNote}</span>}
      </div>
      {item.result && !item.result.denied && <pre className={css.pre}>{item.result.content}</pre>}
    </div>
  )
}
