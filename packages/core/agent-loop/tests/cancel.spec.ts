/**
 * Cancellation semantics: aborted turns stay replayable — the visible text
 * prefix is committed as an interrupted assistant message, and every
 * requested tool call has a matching tool result.
 */

import { expect, test } from 'vitest'
import { harness, eventsOf, waitFor, payloadOf } from './harness.ts'
import { textResponse, toolCallsResponse } from './mock-adapter.ts'
import type { ToolDefinition } from '@abyss-harness/tools'
import type { SessionEvent } from '@abyss-harness/session'

function turnEnd(events: SessionEvent[]): SessionEvent {
  const end = events.at(-1)!
  expect(end.type).toBe('turn/end')
  return end
}

test('abort mid-stream commits the visible prefix as an interrupted message', async () => {
  const { ctx, sessionId } = await harness(['hang'])
  const deltas: string[] = []
  ctx.on('assistant/stream', stream => {
    if (stream.sessionId === sessionId) deltas.push(stream.text)
  })
  const turn = ctx.agentLoop.run(sessionId, 'hello')
  await waitFor(() => deltas.length > 0)
  ctx.agentLoop.stop(sessionId)
  await turn
  const events = eventsOf(ctx, sessionId)
  const anchor = events.find(e => e.type === 'assistant/message')!
  const message = payloadOf(anchor).message
  expect(message.interrupted).toBe(true)
  expect(message.content, 'the prefix the user already saw is kept').toBe('partial ')
  expect(payloadOf(turnEnd(events)).reason).toBe('stopped')
})

test('abort mid-tools: every requested call has a result (replayable history)', async () => {
  const hangTool: ToolDefinition = {
    name: 'hang_tool',
    description: 'hangs until aborted',
    parameters: { type: 'object', properties: {} },
    execute: (args, exec) => new Promise((_resolve, reject) => {
      if (exec.signal.aborted) {
        reject(new Error('aborted'))
        return
      }
      exec.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  }
  const { ctx, sessionId } = await harness([
    toolCallsResponse([
      { id: 'c1', name: 'hang_tool' },
      { id: 'c2', name: 'hang_tool' },
    ]),
  ], {}, [hangTool])
  const turn = ctx.agentLoop.run(sessionId, 'go')
  await waitFor(() => eventsOf(ctx, sessionId).some(e => e.type === 'tool/call'))
  ctx.agentLoop.stop(sessionId)
  await turn
  const events = eventsOf(ctx, sessionId)
  const assistant = payloadOf(events.find(e => e.type === 'assistant/message')!)
  const requested = assistant.message.toolCalls.map((call: { id: string }) => call.id)
  expect(requested).toEqual(['c1', 'c2'])
  const results = events.filter(e => e.type === 'tool/result')
  // Every requested call got exactly one result, in model order.
  expect(results.map(e => payloadOf(e).callId)).toEqual(requested)
  // c1 was dispatched (its body failed on abort); c2 never dispatched and
  // carries the synthetic marker.
  expect(payloadOf(results[1]).content).toBe('Error: tool call aborted before dispatch')
  expect(payloadOf(turnEnd(events)).reason).toBe('stopped')
  // Replay safety: the derived history answers every call with a tool message.
  expect(ctx.session.deriveMessages(sessionId).filter(m => m.role === 'tool').length).toBe(2)
})

test('stop() on an idle session is a no-op reporting false', async () => {
  const { ctx, sessionId } = await harness([textResponse('hi')])
  expect(ctx.agentLoop.stop(sessionId)).toBe(false)
})
