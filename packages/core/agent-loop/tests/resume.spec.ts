/**
 * Resume semantics: driveTurn continues a turn whose boundary events say it
 * is still open (e.g. after a process restart with a replayed log).
 */

import { expect, test } from 'vitest'
import { harness, eventsOf, payloadOf } from './harness.ts'
import { textResponse } from './mock-adapter.ts'
import type { ToolDefinition } from '@abyss-harness/tools'
import type { SessionEvent } from '@abyss-harness/session'

const echo: ToolDefinition = {
  name: 'echo',
  description: 'returns its argument',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  execute: async args => ({ echoed: args.text }),
}

function turnEnd(events: SessionEvent[]): SessionEvent {
  const end = events.at(-1)!
  expect(end.type).toBe('turn/end')
  return end
}

test('driveTurn resumes an open turn from the log', async () => {
  const { ctx, adapter, sessionId } = await harness([textResponse('resumed')])
  // Simulate a crash mid-turn: user message + turn/start, no turn/end.
  ctx.session.append(sessionId, 'user/message', { message: { role: 'user', content: 'earlier' } })
  ctx.session.append(sessionId, 'turn/start', { seq: 1 })
  await ctx.agentLoop.driveTurn(sessionId)
  const events = eventsOf(ctx, sessionId)
  // The existing turn/start is reused, not duplicated.
  expect(events.filter(e => e.type === 'turn/start').length).toBe(1)
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
  // The resumed request replayed the earlier user message.
  expect(adapter.requests[0].messages.some(m => m.role === 'user' && m.content === 'earlier')).toBe(true)
})

test('a fresh run after a closed turn starts a new turn', async () => {
  const { ctx, sessionId } = await harness([
    textResponse('first'),
    textResponse('second'),
  ])
  await ctx.agentLoop.run(sessionId, 'one')
  await ctx.agentLoop.run(sessionId, 'two')
  const events = eventsOf(ctx, sessionId)
  expect(events.filter(e => e.type === 'turn/start').length).toBe(2)
  expect(events.filter(e => e.type === 'turn/end').length).toBe(2)
})

test('resume continues a turn left open mid-tool-round', async () => {
  // Step 0 answered with a tool call; the process died before the follow-up
  // request. A replayed log + driveTurn finishes the turn.
  const { ctx, sessionId } = await harness([() => textResponse('done')], {}, [echo])
  ctx.session.append(sessionId, 'user/message', { message: { role: 'user', content: 'run it' } })
  ctx.session.append(sessionId, 'turn/start', { seq: 1 })
  const call = { id: 'call-9', name: 'echo', argsText: '{"text":"x"}', arguments: { text: 'x' } }
  ctx.session.append(sessionId, 'assistant/message', {
    message: { role: 'assistant', content: null, toolCalls: [call] },
  })
  ctx.session.append(sessionId, 'tool/call', { call })
  ctx.session.append(sessionId, 'tool/result', { callId: 'call-9', content: '{"echoed":"x"}' })
  await ctx.agentLoop.driveTurn(sessionId)
  const events = eventsOf(ctx, sessionId)
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
  expect(events.some(e => e.type === 'assistant/message' && payloadOf(e).message.content === 'done')).toBe(true)
})
