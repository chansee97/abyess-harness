/**
 * Test harness: a real Cordis context with the loop's real collaborators
 * (session, system-prompt, tools, llm) and a scripted mock adapter.
 */

import { Context } from '@abyss-harness/cordis'
import { apply as applySession } from '@abyss-harness/session'
import { apply as applySystemPrompt } from '@abyss-harness/system-prompt'
import { apply as applyTools, type ToolDefinition } from '@abyss-harness/tools'
import { apply as applyLlm } from '@abyss-harness/llm'
import { apply as applyAgentLoop, inject as agentLoopInject, type Config as AgentLoopConfig } from '../src/index.ts'
import { MockAdapter, type ScriptEntry } from './mock-adapter.ts'

export interface Harness {
  ctx: Context
  adapter: MockAdapter
  sessionId: string
}

/** Compose the minimal loop stack and one session, driven by the script. */
export async function harness(
  script: ScriptEntry[],
  config: Partial<AgentLoopConfig> = {},
  tools: ToolDefinition[] = [],
): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(applySession)
  await ctx.plugin(applySystemPrompt)
  await ctx.plugin(applyTools)
  await ctx.plugin(applyLlm)
  for (const tool of tools) ctx.tools.register(tool)
  const adapter = new MockAdapter(script)
  ctx.llm.register('test', adapter)
  // Load the loop with its module-level inject list — a plain function export
  // loses it, and cordis gates cross-service property access on inject.
  await ctx.plugin({ name: 'agent-loop', inject: agentLoopInject, apply: applyAgentLoop }, { route: 'test', ...config })
  const sessionId = ctx.session.create()
  return { ctx, adapter, sessionId }
}

/** Snapshot of a session's log. */
export function eventsOf(ctx: Context, sessionId: string) {
  return [...ctx.session.events(sessionId)]
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Poll until the predicate holds; fails the test after a timeout. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await delay(10)
  }
}

/** Read an event's payload as any (the log is untyped at the edges). */
export function payloadOf(event: { payload: unknown }): any {
  return event.payload
}
