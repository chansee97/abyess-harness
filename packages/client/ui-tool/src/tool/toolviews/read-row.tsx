import type { ToolItem } from '../../index.ts'
import type { ReadModel } from '../models.ts'
import css from '../ToolCard.module.css'

/** Result-content cap shared by all bodies: beyond this the text just
    truncates — the transcript is a reading surface, not a file viewer. */
export const BODY_MAX_CHARS = 400

export function truncate(content: string): string {
  return content.length > BODY_MAX_CHARS ? content.slice(0, BODY_MAX_CHARS) + '…' : content
}

/** read body: the resolved path as a caption, then the file content. */
export function ReadRow({ model, item }: { model: ReadModel; item: ToolItem }) {
  return (
    <div className={css.viewBody}>
      <div className={css.caption}>{model.path}</div>
      {item.result && !item.result.denied && (
        <pre className={css.pre}>{truncate(item.result.content)}</pre>
      )}
    </div>
  )
}
