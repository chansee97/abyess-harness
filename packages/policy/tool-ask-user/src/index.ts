/**
 * ask_user_question tool: lets the model ask the human one or more questions
 * mid-turn through the same approval channel the browser already renders (the
 * approval service's `ask` interaction). Each question may carry an option
 * menu (single- or multi-select) or be free-text; the browser renders the
 * matching form, dsh's ask_user_question in miniature. Without the approval
 * provider mounted, the tool answers "unavailable" instead of blocking.
 *
 * The structured answer batch returns to the model as the tool result; a
 * dismissed question returns a clear non-answer so the model can decide to
 * proceed or stop.
 */

import type { Context } from '@abyss-harness/cordis'
import type { ToolExecution } from '@abyss-harness/tools'
import type { AskQuestion } from '@abyss-harness/approval'

export const name = 'tool-ask-user'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register({
    name: 'ask_user_question',
    description: 'Ask the human one or more questions and use their answers. Use when information is missing or a choice is needed and only the human has it. Each question may offer options (single- or multi-select) or be free-text; put the recommended option first and append "(Recommended)" to its label.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Questions to ask the human before continuing.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable id for this question; echoed in the answer.' },
              question: { type: 'string', description: 'The specific question to ask the human.' },
              header: { type: 'string', description: 'Optional short heading, such as "Confirm" or "Choose Mode".' },
              options: {
                type: 'array',
                description: 'Optional choices to show the human. If you recommend one, put it first and append "(Recommended)" to that label.',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Short user-facing option label.' },
                    description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
                  },
                  required: ['label'],
                },
              },
              multi_select: { type: 'boolean', description: 'Whether the human may select more than one option. Defaults to false.' },
            },
            required: ['id', 'question'],
          },
        },
      },
      required: ['questions'],
    },
    async execute(args, exec) {
      const approval = ctx.get('approval')
      if (!approval) {
        return 'ask_user_question unavailable: no approval service mounted'
      }
      const questions: AskQuestion[] = (Array.isArray(args.questions) ? args.questions : [])
        .map((item: any, index: number) => ({
          id: String(item.id ?? `q${index}`),
          question: String(item.question ?? ''),
          ...(typeof item.header === 'string' && item.header !== '' ? { header: item.header } : {}),
          ...(Array.isArray(item.options) && item.options.length > 0
            ? {
                options: item.options.map((option: any) => ({
                  label: String(option.label ?? ''),
                  ...(typeof option.description === 'string' && option.description !== ''
                    ? { description: option.description }
                    : {}),
                })),
              }
            : {}),
          ...(item.multi_select === true ? { multiSelect: true } : {}),
        }))
        .filter((question: AskQuestion) => question.question !== '')
      if (questions.length === 0) {
        return 'ask_user_question error: no valid questions provided'
      }
      const call: ToolExecution = {
        call: exec.call,
        caller: 'tool-ask-user',
        signal: exec.signal,
        sessionId: exec.sessionId,
      }
      const answers = await approval.ask(call, questions)
      if (answers === null) {
        return 'the user did not answer (dismissed or the turn was stopped)'
      }
      return JSON.stringify({ answers })
    },
  })
}
