/**
 * Loop behavior: turn/step structure, tool round-trips, turn-end reasons,
 * parallel tool scheduling, steering, the per-session lock, and agent/status.
 */

import { expect, test } from 'vitest'
import { harness, eventsOf, waitFor, payloadOf, delay } from './harness.ts'
import { textResponse, toolCallResponse, toolCallsResponse, maxTokensResponse } from './mock-adapter.ts'
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

test('basic turn: user → assistant → complete', async () => {
  const { ctx, adapter, sessionId } = await harness([textResponse('hello')], {}, [echo])
  await ctx.agentLoop.run(sessionId, 'hi')
  const events = eventsOf(ctx, sessionId)
  expect(events.map(e => e.type)).toEqual(['user/message', 'turn/start', 'assistant/message', 'turn/end'])
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
  // Request shape: system prompt first, the user message after, tool specs offered.
  expect(adapter.requests.length).toBe(1)
  expect(adapter.requests[0].messages[0]?.role).toBe('system')
  expect(adapter.requests[0].messages[1]?.content).toBe('hi')
  expect(adapter.requests[0].tools?.some(tool => tool.name === 'echo')).toBe(true)
})

test('tool call round-trip: results feed the next request', async () => {
  const { ctx, adapter, sessionId } = await harness([
    toolCallResponse('call-1', 'echo', { text: 'ping' }),
    () => textResponse('done'),
  ], {}, [echo])
  await ctx.agentLoop.run(sessionId, 'use the tool')
  const events = eventsOf(ctx, sessionId)
  // Every requested call has a matching result, in model order.
  expect(events.filter(e => e.type === 'tool/result').map(e => payloadOf(e).callId)).toEqual(['call-1'])
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
  // The second request replays the assistant tool_calls message plus its tool result.
  expect(adapter.requests.length).toBe(2)
  const second = adapter.requests[1].messages
  expect(second.some(m => m.role === 'assistant' && m.toolCalls?.length === 1)).toBe(true)
  const toolMessage = second.find(m => m.role === 'tool')
  expect(toolMessage?.toolCallId).toBe('call-1')
  expect(toolMessage?.content).toBe('{"echoed":"ping"}')
})

test('step bound: a tool-only model ends the turn with max-steps', async () => {
  const { ctx, sessionId } = await harness([
    toolCallResponse('c1', 'echo', { text: 'a' }),
    toolCallResponse('c2', 'echo', { text: 'b' }),
  ], { maxSteps: 2 }, [echo])
  await ctx.agentLoop.run(sessionId, 'loop forever')
  expect(payloadOf(turnEnd(eventsOf(ctx, sessionId))).reason).toBe('max-steps')
})

test('max-tokens finish ends the turn with its own reason', async () => {
  const { ctx, sessionId } = await harness([maxTokensResponse('cut off mid-sentence')])
  await ctx.agentLoop.run(sessionId, 'hi')
  const events = eventsOf(ctx, sessionId)
  expect(payloadOf(turnEnd(events)).reason).toBe('max-tokens')
  const assistant = events.find(e => e.type === 'assistant/message')!
  expect(payloadOf(assistant).message.content).toBe('cut off mid-sentence')
})

test('an empty stream leaves no assistant message', async () => {
  const { ctx, sessionId } = await harness([[{ type: 'finish', reason: { kind: 'stop' } }]])
  await ctx.agentLoop.run(sessionId, 'hi')
  const events = eventsOf(ctx, sessionId)
  expect(events.some(e => e.type === 'assistant/message')).toBe(false)
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
})

test('parallel-safe tools run concurrently; results commit in model order', async () => {
  let active = 0
  let maxActive = 0
  const slowLookup: ToolDefinition = {
    name: 'slow_lookup',
    description: 'slow read-only lookup',
    concurrency: 'parallel',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await delay(40)
      active--
      return 'ok'
    },
  }
  const { ctx, sessionId } = await harness([
    toolCallsResponse([
      { id: 'c1', name: 'slow_lookup' },
      { id: 'c2', name: 'slow_lookup' },
    ]),
    () => textResponse('done'),
  ], {}, [slowLookup])
  await ctx.agentLoop.run(sessionId, 'look things up')
  expect(maxActive, 'the two parallel-safe calls must overlap').toBe(2)
  expect(
    eventsOf(ctx, sessionId).filter(e => e.type === 'tool/result').map(e => payloadOf(e).callId),
    'results commit in model order'
  ).toEqual(['c1', 'c2'])
  expect(payloadOf(turnEnd(eventsOf(ctx, sessionId))).reason).toBe('complete')
})

test('exclusive tools stay barriers: no overlap with each other', async () => {
  let active = 0
  let maxActive = 0
  const exclusive: ToolDefinition = {
    name: 'mutating_tool',
    description: 'mutates shared state',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await delay(40)
      active--
      return 'ok'
    },
  }
  const { ctx, sessionId } = await harness([
    toolCallsResponse([
      { id: 'c1', name: 'mutating_tool' },
      { id: 'c2', name: 'mutating_tool' },
    ]),
    () => textResponse('done'),
  ], {}, [exclusive])
  await ctx.agentLoop.run(sessionId, 'mutate twice')
  expect(maxActive, 'exclusive calls must never overlap').toBe(1)
})

test('steer: queued text joins the log at the next step boundary', async () => {
  let toolStarted = false
  const slowTool: ToolDefinition = {
    name: 'slow_tool',
    description: 'takes a while',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      toolStarted = true
      await delay(50)
      return 'ok'
    },
  }
  const { ctx, adapter, sessionId } = await harness([
    toolCallResponse('c1', 'slow_tool'),
    () => textResponse('done'),
  ], {}, [slowTool])
  const turn = ctx.agentLoop.run(sessionId, 'start')
  await waitFor(() => toolStarted)
  expect(ctx.agentLoop.steer(sessionId, 'steered!')).toBe(true)
  await turn
  // The steered text landed as a user message in the log…
  expect(eventsOf(ctx, sessionId).some(e =>
    e.type === 'user/message' && payloadOf(e).message.content === 'steered!')).toBe(true)
  // …and the next request saw it.
  expect(adapter.requests[1].messages.some(m => m.role === 'user' && m.content === 'steered!')).toBe(true)
})

test('steer rejects when no turn is open', async () => {
  const { ctx, sessionId } = await harness([textResponse('hi')])
  expect(ctx.agentLoop.steer(sessionId, 'x')).toBe(false)
})

test('steering arriving mid-text-step keeps the turn open and is answered', async () => {
  let steeredDuringStep = false
  let secondRequestSawSteer = false
  const { ctx, sessionId } = await harness([
    // Simulate steering queued while the first step's stream is being consumed.
    () => {
      steeredDuringStep = ctx.agentLoop.steer(sessionId, 'and one more thing')
      return textResponse('first answer')
    },
    options => {
      secondRequestSawSteer = options.messages.some(m => m.role === 'user' && m.content === 'and one more thing')
      return textResponse('second answer')
    },
  ])
  await ctx.agentLoop.run(sessionId, 'hi')
  expect(steeredDuringStep).toBe(true)
  expect(secondRequestSawSteer, 'the follow-up step must see the steered input').toBe(true)
  // Both answers landed inside ONE turn, not two.
  const events = eventsOf(ctx, sessionId)
  expect(events.filter(e => e.type === 'turn/start').length).toBe(1)
  expect(events.filter(e => e.type === 'turn/end').length).toBe(1)
  expect(payloadOf(turnEnd(events)).reason).toBe('complete')
  expect(events.filter(e => e.type === 'assistant/message').length).toBe(2)
})

test('run() on a busy session is rejected without consuming the input', async () => {
  const { ctx, sessionId } = await harness(['hang'])
  const first = ctx.agentLoop.run(sessionId, 'first')
  await waitFor(() => ctx.agentLoop.isBusy(sessionId))
  await ctx.agentLoop.run(sessionId, 'second')
  const events = eventsOf(ctx, sessionId)
  expect(events.filter(e => e.type === 'user/message').length).toBe(1)
  expect(events.some(e => e.type === 'turn/error' && payloadOf(e).message.includes('busy'))).toBe(true)
  ctx.agentLoop.stop(sessionId)
  await first
})

test('agent/status frames bracket the turn', async () => {
  const { ctx, sessionId } = await harness([textResponse('hi')])
  const statuses: string[] = []
  ctx.on('agent/status', status => {
    if (status.sessionId === sessionId) statuses.push(status.status)
  })
  await ctx.agentLoop.run(sessionId, 'hi')
  expect(statuses).toEqual(['running', 'idle'])
})
