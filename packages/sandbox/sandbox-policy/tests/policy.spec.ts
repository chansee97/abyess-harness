import { describe, expect, it } from 'vitest'
import { Context } from '@abyss-harness/cordis'
import { resolve } from 'node:path'
import { apply as applySession } from '@abyss-harness/session'
import { apply as applySystemPrompt } from '@abyss-harness/system-prompt'
import { apply as applySandboxPolicy, inject as sandboxPolicyInject, SandboxPolicyService } from '../src/index.ts'

async function policyCtx(config: Parameters<typeof applySandboxPolicy>[1]) {
  const ctx = new Context()
  await ctx.plugin(applySession)
  await ctx.plugin(applySystemPrompt)
  await ctx.plugin({ name: 'sandbox-policy', inject: sandboxPolicyInject, apply: applySandboxPolicy }, config)
  return ctx
}

describe('sandbox-policy', () => {
  it('defaults to the fail-safe read-only mode and process cwd', async () => {
    const ctx = await policyCtx({})
    const policy = ctx.sandboxPolicy.resolve()
    expect(policy.mode).toBe('read-only')
    expect(policy.workspaceRoot).toBe(resolve(process.cwd()))
  })

  it('resolves the configured mode and workspace root', async () => {
    const ctx = await policyCtx({ mode: 'workspace-write', workspaceRoot: 'some/rel/root' })
    const policy = ctx.sandboxPolicy.resolve()
    expect(policy.mode).toBe('workspace-write')
    expect(policy.workspaceRoot).toBe(resolve('some/rel/root'))
  })

  it('a per-session sandbox/mode override wins over the deployment default', async () => {
    const ctx = await policyCtx({ mode: 'danger-full-access' })
    const sessionId = ctx.session.create()
    expect(ctx.sandboxPolicy.resolve(sessionId).mode).toBe('danger-full-access')
    ctx.sandboxPolicy.setMode(sessionId, 'read-only')
    expect(ctx.sandboxPolicy.resolve(sessionId).mode).toBe('read-only')
    // Other sessions keep the deployment default.
    expect(ctx.sandboxPolicy.resolve(ctx.session.create()).mode).toBe('danger-full-access')
    // The override is a durable log event.
    expect([...ctx.session.events(sessionId)].some(event => event.type === 'sandbox/mode')).toBe(true)
  })

  it('setMode rejects unknown modes', async () => {
    const ctx = await policyCtx({})
    const sessionId = ctx.session.create()
    expect(() => ctx.sandboxPolicy.setMode(sessionId, 'sudo' as never)).toThrow(/unknown mode/)
  })

  it('setDefaultMode changes the deployment default for NEW sessions only', async () => {
    const ctx = await policyCtx({ mode: 'read-only' })
    const oldSession = ctx.session.create()
    ctx.sandboxPolicy.setDefaultMode('danger-full-access')
    // New sessions pick up the new default…
    expect(ctx.sandboxPolicy.resolve(ctx.session.create()).mode).toBe('danger-full-access')
    // …and the untouched old session keeps its fold (no override → its
    // resolution follows the deployment default at call time, which the
    // pre-step rewrite reflects; the durable per-session log is unchanged).
    expect([...ctx.session.events(oldSession)].every(event => event.type !== 'sandbox/mode')).toBe(true)
    expect(() => ctx.sandboxPolicy.setDefaultMode('sudo' as never)).toThrow(/unknown mode/)
  })

  it('rewrites the prompt policy line per session at the pre-step seam', async () => {
    const ctx = await policyCtx({ mode: 'workspace-write' })
    const sessionId = ctx.session.create()
    ctx.sandboxPolicy.setMode(sessionId, 'read-only')
    const decision = await ctx.waterfall(
      'agent/pre-step',
      {
        sessionId,
        turn: 0,
        step: 0,
        messages: [{ role: 'system' as const, content: 'intro\nCurrent file policy: workspace-write.\ntools' }],
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter' as const }),
    )
    expect(decision.kind).toBe('enter')
    const system = decision.kind === 'enter' ? decision.messages?.[0] : undefined
    expect(system?.content).toContain('read-only. Operations enforced')
    expect(system?.content).not.toContain('workspace-write.')
    // The rest of the prompt stays byte-stable: intro and tools lines intact.
    expect(system?.content?.startsWith('intro\n')).toBe(true)
    expect(system?.content?.endsWith('\ntools')).toBe(true)
  })

  it('describes the resolved policy as a system prompt section', async () => {
    const ctx = await policyCtx({ mode: 'workspace-write', workspaceRoot: process.cwd() })
    const prompt = ctx.systemPrompt.assemble([])
    expect(prompt).toContain('Current file policy: workspace-write')
    expect(prompt).toContain(JSON.stringify(resolve(process.cwd())))
  })

  it('describes danger-full-access as unrestricted', async () => {
    const ctx = await policyCtx({ mode: 'danger-full-access' })
    expect(ctx.systemPrompt.assemble([])).toContain('does not restrict file modifications')
  })

  it('the service is a SandboxPolicyService instance', async () => {
    const ctx = await policyCtx({})
    expect(ctx.sandboxPolicy).toBeInstanceOf(SandboxPolicyService)
  })
})
