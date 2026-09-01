import { describe, expect, it } from 'vitest'
import { Context } from '@abyss-harness/cordis'
import { apply as applySession } from '@abyss-harness/session'
import { apply as applySystemPrompt } from '@abyss-harness/system-prompt'
import { apply as applyTools } from '@abyss-harness/tools'
import { SandboxProvider, type SandboxPolicy } from '@abyss-harness/sandbox'
import { apply as applySandboxPolicy, inject as sandboxPolicyInject } from '@abyss-harness/sandbox-policy'
import { apply as applyToolBash, inject as toolBashInject } from '../src/index.ts'

async function bashCtx(policyConfig: Parameters<typeof applySandboxPolicy>[1], provider?: new (ctx: Context) => SandboxProvider) {
  const ctx = new Context()
  await ctx.plugin(applySession)
  await ctx.plugin(applySystemPrompt)
  await ctx.plugin(applyTools)
  await ctx.plugin({ name: 'sandbox-policy', inject: sandboxPolicyInject, apply: applySandboxPolicy }, policyConfig)
  if (provider) await ctx.plugin(provider)
  await ctx.plugin({ name: 'tool-bash', inject: toolBashInject, apply: applyToolBash })
  return ctx
}

function runBash(ctx: Context, command: string) {
  return ctx.tools.execute({ id: 'call-1', name: 'bash', argsText: '', arguments: { command } })
}

/** A passthrough provider: same argv, but declares a denial dialect. */
class PassthroughProvider extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy) {
    return { argv: [...argv], enforcement: 'partial' as const, denialSignatures: ['ACCESS DENIED'] }
  }
}

describe('tool-bash sandbox integration', () => {
  it('runs unconfined under danger-full-access', async () => {
    const ctx = await bashCtx({ mode: 'danger-full-access' })
    const result = await runBash(ctx, 'echo hello-sandbox')
    expect(result.ok).toBe(true)
    expect(result.content).toContain('hello-sandbox')
  })

  it('fails closed in a confined mode with no provider mounted', async () => {
    const ctx = await bashCtx({ mode: 'read-only' })
    const result = await runBash(ctx, 'echo should-not-run')
    expect(result.ok).toBe(false)
    expect(result.error).toBe(true)
    expect(result.content).toContain('no sandbox backend is usable')
    expect(result.content).toContain('read-only')
  })

  it('runs the provider-confined argv when a backend is mounted', async () => {
    const ctx = await bashCtx({ mode: 'workspace-write' }, PassthroughProvider)
    const result = await runBash(ctx, 'echo confined-run')
    expect(result.ok).toBe(true)
    expect(result.content).toContain('confined-run')
  })

  it('renders a backend file denial as a policy marker, not a plain failure', async () => {
    const ctx = await bashCtx({ mode: 'workspace-write' }, PassthroughProvider)
    const denied = process.platform === 'win32'
      ? 'echo ACCESS DENIED 1>&2 & exit /b 1'
      : 'echo ACCESS DENIED >&2; exit 1'
    const result = await runBash(ctx, denied)
    expect(result.ok).toBe(false)
    expect(result.content).toContain('[sandbox: file access denied under workspace-write mode]')
  })
})
