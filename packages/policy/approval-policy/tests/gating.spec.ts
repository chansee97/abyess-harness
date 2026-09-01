import { describe, expect, it } from 'vitest'
import { Context } from '@abyss-harness/cordis'
import { resolve } from 'node:path'
import { apply as applySession } from '@abyss-harness/session'
import { apply as applySystemPrompt } from '@abyss-harness/system-prompt'
import { apply as applyTools } from '@abyss-harness/tools'
import type { ApprovalRequest } from '@abyss-harness/approval'
import { apply as applySandboxPolicy, inject as sandboxPolicyInject } from '@abyss-harness/sandbox-policy'
import { apply as applyApprovalPolicy, inject as approvalPolicyInject } from '../src/index.ts'

async function gatedCtx(
  policyConfig: Parameters<typeof applySandboxPolicy>[1],
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(applySession)
  // sandbox-policy's inject requires systemPrompt — without it its fiber
  // never activates and the service stays unprovided.
  await ctx.plugin(applySystemPrompt)
  await ctx.plugin(applyTools)
  await ctx.plugin({ name: 'sandbox-policy', inject: sandboxPolicyInject, apply: applySandboxPolicy }, policyConfig)
  await ctx.plugin(
    { name: 'approval-policy', inject: approvalPolicyInject, apply: applyApprovalPolicy },
    { requireApproval: ['write', 'bash'] },
  )
  ctx.tools.register({
    name: 'write',
    description: 'write',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async execute(args) { return `wrote ${String(args.path)}` },
  })
  ctx.tools.register({
    name: 'bash',
    description: 'shell',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    async execute(args) { return `ran ${String(args.command)}` },
  })
  return ctx
}

function run(ctx: Context, sessionId: string | undefined, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute(
    { id: `call-${Math.random()}`, name, argsText: '', arguments: args },
    { sessionId },
  )
}

/** The most recent pending approval request id (approval/request emissions). */
function watchRequests(ctx: Context): () => ApprovalRequest | undefined {
  let last: ApprovalRequest | undefined
  ctx.on('approval/request', request => { last = request })
  return () => last
}

const insidePath = resolve('note.txt')

describe('approval-policy: file-policy-aware gating', () => {
  it('auto-allows a workspace-compliant write and logs the policy event', async () => {
    const ctx = await gatedCtx({ mode: 'workspace-write' })
    const sessionId = ctx.session.create()
    const nextRequest = watchRequests(ctx)
    const result = await run(ctx, sessionId, 'write', { path: insidePath, content: 'x' })
    expect(result.ok).toBe(true)
    expect(nextRequest()).toBeUndefined() // no human prompt
    const policyEvents = [...ctx.session.events(sessionId)].filter(event => event.type === 'tool/policy')
    expect(policyEvents).toHaveLength(1)
    expect(policyEvents[0]!.payload).toMatchObject({ tool: 'write', mode: 'workspace-write', decision: 'allow' })
  })

  it('escalates a write outside the workspace to the human card', async () => {
    const ctx = await gatedCtx({ mode: 'workspace-write' })
    const sessionId = ctx.session.create()
    const nextRequest = watchRequests(ctx)
    const outside = resolve(process.cwd(), '..', 'outside.txt')
    const pending = run(ctx, sessionId, 'write', { path: outside, content: 'x' })
    // Wait for the escalation, then approve it — the human is the escalation target.
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
    const request = nextRequest()
    expect(request?.tool).toBe('write')
    ctx.get('approval')!.settle(request!.id, 'allow')
    expect((await pending).ok).toBe(true)
  })

  it('a declined escalation denies the call', async () => {
    const ctx = await gatedCtx({ mode: 'workspace-write' })
    const sessionId = ctx.session.create()
    const nextRequest = watchRequests(ctx)
    const outside = resolve(process.cwd(), '..', 'outside.txt')
    const pending = run(ctx, sessionId, 'write', { path: outside, content: 'x' })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
    ctx.get('approval')!.settle(nextRequest()!.id, 'deny')
    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.denied).toBe(true)
    expect(result.content).toContain('user declined')
  })

  it('denies writes outright under read-only', async () => {
    const ctx = await gatedCtx({ mode: 'read-only' })
    const sessionId = ctx.session.create()
    const nextRequest = watchRequests(ctx)
    const result = await run(ctx, sessionId, 'write', { path: insidePath, content: 'x' })
    expect(result.ok).toBe(false)
    expect(result.denied).toBe(true)
    expect(result.content).toContain('read-only file policy')
    expect(nextRequest()).toBeUndefined()
  })

  it('auto-allows everything under danger-full-access', async () => {
    const ctx = await gatedCtx({ mode: 'danger-full-access' })
    const sessionId = ctx.session.create()
    const nextRequest = watchRequests(ctx)
    const bashResult = await run(ctx, sessionId, 'bash', { command: 'echo hi' })
    expect(bashResult.ok).toBe(true)
    expect(nextRequest()).toBeUndefined()
  })

  it('escalates shell commands under workspace-write with no confining backend', async () => {
    const ctx = await gatedCtx({ mode: 'workspace-write' })
    const sessionId = ctx.session.create()
    const nextRequest = watchRequests(ctx)
    const pending = run(ctx, sessionId, 'bash', { command: 'echo hi' })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
    expect(nextRequest()?.tool).toBe('bash')
    ctx.get('approval')!.settle(nextRequest()!.id, 'allow')
    expect((await pending).ok).toBe(true)
  })
})
