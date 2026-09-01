import { describe, expect, it } from 'vitest'
import { Context } from '@abyss-harness/cordis'
import {
  SANDBOX_UNAVAILABLE,
  SandboxProvider,
  SandboxUnavailableError,
  type SandboxPolicy,
} from '../src/index.ts'

class StubProvider extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy) {
    return { argv: [...argv], enforcement: 'partial' as const, denialSignatures: ['access denied'] }
  }
}

describe('sandbox vocabulary', () => {
  it('SandboxUnavailableError carries the fail-closed code and guidance', () => {
    const error = new SandboxUnavailableError('read-only')
    expect(error.code).toBe(SANDBOX_UNAVAILABLE)
    expect(error.name).toBe('SandboxUnavailableError')
    expect(error.message).toContain('"read-only"')
    expect(error.message).toContain('refusing to run the command unconfined')
  })

  it('appends runner-failure detail when provided', () => {
    const error = new SandboxUnavailableError('workspace-write', 'runner could not start')
    expect(error.message).toContain('Runner failure: runner could not start')
  })

  it('a concrete provider self-provides on ctx.sandbox', async () => {
    const ctx = new Context()
    await ctx.plugin(StubProvider)
    const provider = ctx.get('sandbox') as SandboxProvider
    expect(provider).toBeInstanceOf(StubProvider)
    const confined = provider.confine(['bash', '-c', 'echo hi'], {
      mode: 'read-only',
      workspaceRoot: process.cwd(),
    })
    expect(confined.argv).toEqual(['bash', '-c', 'echo hi'])
    expect(confined.enforcement).toBe('partial')
    expect(confined.denialSignatures).toEqual(['access denied'])
  })
})
