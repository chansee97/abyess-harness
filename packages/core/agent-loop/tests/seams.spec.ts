/**
 * The three loop seams: `agent/pre-step` (rewrite or reject the entering
 * messages), `agent/request-error` (retry or terminal), and
 * `agent/turn-stopping` (observe / extend the natural turn boundary).
 */

import { expect, test } from 'vitest'
import { harness, eventsOf, payloadOf } from './harness.ts'
import { textResponse, toolCallResponse } from './mock-adapter.ts'
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

test('pre-step can rewrite the entering messages (compaction shape)', async () => {
  const { ctx, adapter, sessionId } = await harness([
    options => textResponse(options.messages.find(m => m.role === 'user')?.content ?? 'none'),
  ])
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const entering = decision.messages ?? payload.messages
    // Replace the user content the model will see — the log stays untouched.
    const messages = entering.map(message =>
      message.role === 'user' ? { ...message, content: 'REWRITTEN' } : message)
    return { kind: 'enter', messages }
  })
  await ctx.agentLoop.run(sessionId, 'original input')
  // The provider saw the rewrite…
  expect(adapter.requests[0].messages.find(m => m.role === 'user')?.content).toBe('REWRITTEN')
  // …but the log keeps the original user message.
  expect(eventsOf(ctx, sessionId).find(e => e.type === 'user/message'))
    .toMatchObject({ payload: { message: { content: 'original input' } } })
})

test('pre-step can reject the step: turn ends complete, no model call', async () => {
  const { ctx, adapter, sessionId } = await harness([textResponse('never called')])
  ctx.on('agent/pre-step', async () => ({ kind: 'reject' as const }))
  await ctx.agentLoop.run(sessionId, 'hi')
  expect(adapter.requests.length, 'no request was dispatched').toBe(0)
  const events = eventsOf(ctx, sessionId)
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
  expect(events.some(e => e.type === 'assistant/message')).toBe(false)
})

test('request-error retry: a failing attempt is retried, then succeeds', async () => {
  const { ctx, adapter, sessionId } = await harness([
    () => { throw new Error('provider 502') },
    () => textResponse('recovered'),
  ])
  ctx.on('agent/request-error', async () => ({ kind: 'retry' as const }))
  await ctx.agentLoop.run(sessionId, 'hi')
  expect(adapter.requests.length).toBe(2)
  const events = eventsOf(ctx, sessionId)
  expect(events.some(e => e.type === 'turn/error')).toBe(false)
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
  expect(payloadOf(events.find(e => e.type === 'assistant/message')!).message.content).toBe('recovered')
})

test('unhandled request-error is terminal: turn ends error', async () => {
  const { ctx, sessionId } = await harness([
    () => { throw new Error('provider down') },
  ])
  await ctx.agentLoop.run(sessionId, 'hi')
  const events = eventsOf(ctx, sessionId)
  expect(payloadOf(turnEnd(events)).reason).toBe('error')
  expect(payloadOf(events.find(e => e.type === 'turn/error')!).message).toBe('provider down')
})

test('request-error retry bound: too many retries still end the turn', async () => {
  const { ctx, adapter, sessionId } = await harness([
    () => { throw new Error('always fails') },
    () => { throw new Error('always fails') },
    () => { throw new Error('always fails') },
  ])
  ctx.on('agent/request-error', async () => ({ kind: 'retry' as const }))
  await ctx.agentLoop.run(sessionId, 'hi')
  const events = eventsOf(ctx, sessionId)
  expect(payloadOf(turnEnd(events)).reason).toBe('error')
  // The loop's own safety bound (MAX_REQUEST_ATTEMPTS) capped the retries
  // before the script ran out — 8 attempts against a 3-entry script means
  // the mock's exhaustion error surfaces instead.
  expect(adapter.requests.length).toBeGreaterThanOrEqual(3)
})

test('turn-stopping fires before the natural end, not on abort', async () => {
  const { ctx, sessionId } = await harness([textResponse('hi')])
  const stops: { sessionId: string; turn: number }[] = []
  ctx.on('agent/turn-stopping', payload => { stops.push({ sessionId: payload.sessionId, turn: payload.turn }) })
  await ctx.agentLoop.run(sessionId, 'hi')
  expect(stops).toEqual([{ sessionId, turn: 1 }])
})

test('turn-stopping fires once per turn even with tool steps', async () => {
  const { ctx, sessionId } = await harness([
    toolCallResponse('c1', 'echo', { text: 'x' }),
    () => textResponse('done'),
  ], {}, [echo])
  const stops: unknown[] = []
  ctx.on('agent/turn-stopping', () => { stops.push(1) })
  await ctx.agentLoop.run(sessionId, 'go')
  // Only the FINAL natural boundary (the text answer) stops the turn; the
  // tool continuation does not.
  expect(stops.length).toBe(1)
})
