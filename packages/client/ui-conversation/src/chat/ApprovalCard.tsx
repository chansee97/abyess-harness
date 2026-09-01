import { useState } from 'react'
import {
  Button,
  IconCheckOutline14,
  IconCloseOutline16,
  IconEditOutline16,
} from '@abyss-harness/client-ui-primitives'
import type { AskAnswerItem, AskQuestion, ApprovalRequest } from '@abyss-harness/client-connection'
import css from './ApprovalCard.module.css'

/** Recover the question batch from the request: structured field first,
    args JSON second (older log entries), legacy single free-text last. */
function questionsOf(request: ApprovalRequest): AskQuestion[] {
  if (request.questions && request.questions.length > 0) return request.questions
  try {
    const parsed = JSON.parse(request.argsText) as {
      questions?: any[]
      question?: unknown
    }
    if (Array.isArray(parsed.questions)) {
      return parsed.questions.map((item, index) => ({
        id: String(item.id ?? `q${index}`),
        question: String(item.question ?? ''),
        ...(typeof item.header === 'string' && item.header !== '' ? { header: item.header } : {}),
        ...(Array.isArray(item.options) && item.options.length > 0
          ? { options: item.options.map((option: any) => ({ label: String(option.label ?? '') })) }
          : {}),
        ...(item.multi_select === true || item.multiSelect === true ? { multiSelect: true } : {}),
      }))
    }
    if (typeof parsed.question === 'string') {
      return [{ id: 'q0', question: parsed.question }]
    }
  } catch {
    // fall through to the raw args
  }
  return [{ id: 'q0', question: request.argsText }]
}

/** Harness convention: the recommended option is first with a "(Recommended)"
    / "(推荐)" label suffix — strip it and show a badge instead. */
function parseRecommended(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** One question's in-progress answer. */
interface Draft { selected: string[]; custom: string; skipped: boolean }

const blankDraft = (): Draft => ({ selected: [], custom: '', skipped: false })

/** Guard against Chinese IME composition (Enter while composing = candidate
    confirmation, not submit). */
function isComposing(event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || (event.nativeEvent as unknown as { keyCode: number }).keyCode === 229
}

/** An approval request card: a tool gate (allow/deny), or the model's
    questions to the human — option menus (single/multi select), a free-text
    "other" row, and per-question skip, mirroring dsh's QuestionComposer. */
export function ApprovalCard({ request, onDecide }: {
  request: ApprovalRequest
  onDecide: (id: string, decision: 'allow' | 'deny', answers?: AskAnswerItem[]) => void
}) {
  const questions = questionsOf(request)
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(blankDraft))
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (request.kind !== 'question') {
    return (
      <div className={css.approval}>
        <div className={css.title}>需要审批</div>
        <pre className={css.args}>{request.tool}({request.argsText})</pre>
        <div className={css.actions}>
          <Button variant="primary" icon={<IconCheckOutline14 />} onClick={() => onDecide(request.id, 'allow')}>
            允许
          </Button>
          <Button variant="outline" className={css.deny} icon={<IconCloseOutline16 />} onClick={() => onDecide(request.id, 'deny')}>
            拒绝
          </Button>
        </div>
      </div>
    )
  }

  const question = questions[index] as AskQuestion
  const draft = drafts[index] as Draft
  const multi = question.multiSelect === true
  const hasOptions = (question.options?.length ?? 0) > 0
  const last = index === questions.length - 1

  const update = (next: Draft) => {
    setDrafts(current => current.map((item, i) => (i === index ? next : item)))
  }

  const choose = (label: string) => {
    if (busy) return
    update(
      multi
        ? {
            ...draft,
            selected: draft.selected.includes(label)
              ? draft.selected.filter(item => item !== label)
              : [...draft.selected, label],
            skipped: false,
          }
        : { selected: [label], custom: '', skipped: false },
    )
    setError(null)
    // Single-select answers immediately: walk to the next question.
    if (!multi && !last) setIndex(index + 1)
  }

  const writeCustom = (value: string) => {
    update({
      ...draft,
      // Single-select: free text replaces the chosen option (mutually exclusive).
      selected: multi ? draft.selected : [],
      custom: value,
      skipped: false,
    })
    setError(null)
  }

  const answered = (item: Draft): boolean => item.selected.length > 0 || item.custom.trim() !== ''
  const completed = (item: Draft): boolean => answered(item) || item.skipped

  const submit = () => {
    if (busy) return
    const missing = drafts.findIndex(item => !completed(item))
    if (missing >= 0) {
      setIndex(missing)
      setError('请先完成这道问题。')
      return
    }
    setBusy(true)
    const answers: AskAnswerItem[] = questions.map((item, i) => {
      const value = drafts[i] as Draft
      if (value.skipped) return { id: item.id, selected: [] }
      const custom = value.custom.trim()
      return {
        id: item.id,
        // Single-select with custom text: the text IS the answer.
        selected: item.multiSelect !== true && custom !== '' ? [] : value.selected,
        ...(custom === '' ? {} : { custom }),
      }
    })
    onDecide(request.id, 'allow', answers)
  }

  const skipQuestion = () => {
    if (busy) return
    update({ ...draft, selected: [], custom: '', skipped: true })
    setError(null)
    if (!last) setIndex(index + 1)
  }

  const onCustomKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    const firstIncomplete = drafts.findIndex(item => !completed(item))
    if (firstIncomplete < 0) submit()
    else if (firstIncomplete !== index) setIndex(firstIncomplete)
  }

  return (
    <div className={css.approval}>
      <div className={css.header}>
        <div className={css.title}>
          模型提问{questions.length > 1 ? <span className={css.pager}>{index + 1} / {questions.length}</span> : null}
        </div>
        {question.header && <span className={css.chip}>{question.header}</span>}
      </div>
      <pre className={css.args}>{question.question}</pre>

      <div className={css.options} role={multi ? 'group' : 'radiogroup'}>
        {(question.options ?? []).map((option, optionIndex) => {
          const selected = draft.selected.includes(option.label)
          const display = parseRecommended(option.label)
          return (
            <button
              type="button"
              key={`${option.label}-${optionIndex}`}
              className={`${css.option} ${selected && !multi ? css.optionSelected : ''}`}
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={selected}
              disabled={busy}
              onClick={() => choose(option.label)}
            >
              {multi ? (
                <span className={`${css.checkbox} ${selected ? css.checkboxChecked : ''}`} aria-hidden="true">
                  {selected && <IconCheckOutline14 size={12} />}
                </span>
              ) : (
                <span className={css.number} aria-hidden="true">{optionIndex + 1}</span>
              )}
              <span className={css.optionCopy}>
                <span className={css.optionLine}>
                  <span className={css.optionLabel}>{display.label}</span>
                  {display.recommended && <span className={css.badge}>推荐</span>}
                </span>
                {option.description && <span className={css.description}>{option.description}</span>}
              </span>
            </button>
          )
        })}

        {hasOptions ? (
          <div className={`${css.customRow} ${draft.custom !== '' ? css.customRowActive : ''}`}>
            {multi ? (
              <span className={`${css.checkbox} ${draft.custom !== '' ? css.checkboxChecked : ''}`} aria-hidden="true" />
            ) : (
              <span className={css.number}><IconEditOutline16 size={12} /></span>
            )}
            <input
              className={css.customInput}
              value={draft.custom}
              disabled={busy}
              placeholder="输入你的答案…"
              onChange={event => writeCustom(event.target.value)}
              onKeyDown={onCustomKeyDown}
            />
          </div>
        ) : (
          <textarea
            className={css.answer}
            value={draft.custom}
            disabled={busy}
            placeholder="输入你的答案…"
            rows={2}
            onChange={event => writeCustom(event.target.value)}
            onKeyDown={onCustomKeyDown}
          />
        )}
      </div>

      {error && <div className={css.error} role="alert">{error}</div>}

      <div className={css.actions}>
        {index > 0 && (
          <Button variant="outline" onClick={() => setIndex(index - 1)}>
            上一题
          </Button>
        )}
        {questions.length > 1 && !draft.skipped && (
          <Button variant="outline" onClick={skipQuestion}>
            跳过本题
          </Button>
        )}
        <Button variant="outline" className={css.deny} icon={<IconCloseOutline16 />} onClick={() => onDecide(request.id, 'deny')}>
          放弃
        </Button>
        <Button variant="primary" icon={<IconCheckOutline14 />} onClick={submit}>
          提交
        </Button>
      </div>
    </div>
  )
}
