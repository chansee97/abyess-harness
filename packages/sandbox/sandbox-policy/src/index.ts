/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's file-effect mode and workspace root. Mirrors harness's
 * packages/sandbox/sandbox-policy: a deployment-wide default plus a
 * per-session override folded from the session log (the `sandbox/mode`
 * event, last wins) — the same shape as harness's session-mode fold, minus
 * the runtime-context snapshot (this demo rewrites the prompt's policy line
 * at the pre-step seam instead).
 *
 * The resolved policy is described in the system prompt and re-resolved per
 * step, so a mode switch applies to the very next model request without
 * rewriting any other prompt section.
 *
 * @module @abyss-harness/sandbox-policy
 */

import { resolve as resolvePath } from 'node:path'
import { Service, type Context } from '@abyss-harness/cordis'
import type { SandboxExecutionPolicy, SandboxMode } from '@abyss-harness/sandbox'

export type { SandboxMode, SandboxExecutionPolicy } from '@abyss-harness/sandbox'

export const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

/** Plugin config: the deployment's sandbox default. All optional. */
export interface Config {
  /** File-sandbox mode sessions start from. Default `read-only` — the fail-safe. */
  mode?: SandboxMode
  /** Fallback root for the `workspace-write` boundary. Default `process.cwd()`. */
  workspaceRoot?: string
}

/** Render the policy without claiming which capabilities are mounted. */
export function renderPolicyContext(policy: SandboxExecutionPolicy): string {
  switch (policy.mode) {
    case 'read-only':
      return 'Current file policy: read-only. Operations enforced by the file sandbox cannot modify files in this mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial guidance it returns.'
    case 'workspace-write':
      return `Current file policy: workspace-write. Operations enforced by the file sandbox may modify files under the workspace: ${JSON.stringify(policy.workspaceRoot)}. Some platform temporary areas may also be writable.`
    case 'danger-full-access':
      return 'Current file policy: danger-full-access. The file sandbox does not restrict file modifications by available operations.'
  }
}

declare module '@abyss-harness/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

export class SandboxPolicyService extends Service {
  private readonly config: Config

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sandboxPolicy')
    this.config = config
  }

  /**
   * Resolve the file-effect policy for one capability call. The session's
   * last `sandbox/mode` event overrides the deployment default.
   */
  resolve(sessionId?: string): SandboxExecutionPolicy {
    let mode = this.config.mode ?? 'read-only'
    if (sessionId) {
      for (const event of this.ctx.session.events(sessionId)) {
        if (event.type !== 'sandbox/mode') continue
        const overridden = (event.payload as { mode: string }).mode
        if (SANDBOX_MODES.includes(overridden as SandboxMode)) mode = overridden as SandboxMode
      }
    }
    return { mode, workspaceRoot: resolvePath(this.config.workspaceRoot ?? process.cwd()) }
  }

  /**
   * Switch one session's file mode: appends a durable `sandbox/mode` event
   * (last-wins fold), so the override survives persistence replay.
   */
  setMode(sessionId: string, mode: SandboxMode): void {
    if (!SANDBOX_MODES.includes(mode)) throw new Error(`sandbox: unknown mode "${mode}"`)
    this.ctx.session.append(sessionId, 'sandbox/mode', { mode })
  }

  /**
   * Switch the DEPLOYMENT's default mode (the settings-surface write path).
   * In-memory: affects sessions created from now on; the cordis.yml config
   * is restored on restart. Existing sessions are untouched — per-session
   * overrides and sessions without an override keep their fold/default.
   */
  setDefaultMode(mode: SandboxMode): void {
    if (!SANDBOX_MODES.includes(mode)) throw new Error(`sandbox: unknown mode "${mode}"`)
    this.config.mode = mode
  }
}

export const name = 'sandbox-policy'
export const inject = ['systemPrompt', 'session']

export function apply(ctx: Context, config: Config) {
  // Service construction self-provides under 'sandboxPolicy'.
  const service = new SandboxPolicyService(ctx, config)
  // Deployment-default description, like any other prompt section; the
  // pre-step listener below keeps the line accurate per session.
  ctx.systemPrompt.section({
    name: 'sandbox-policy',
    order: -90,
    text: renderPolicyContext(service.resolve()),
  })
  // Per-step policy line: runs OUTERMOST on the pre-step waterfall (this
  // plugin activates before compaction, which injects sandboxPolicy), so the
  // rewrite applies to the post-compaction message list. Replacing the single
  // policy line keeps the rest of the prompt byte-stable.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const messages = decision.messages ?? payload.messages
    const [system, ...rest] = messages
    if (system?.role !== 'system' || typeof system.content !== 'string'
      || !system.content.includes('Current file policy:')) {
      return decision
    }
    const content = system.content.replace(
      /^Current file policy:.*$/m,
      renderPolicyContext(service.resolve(payload.sessionId)),
    )
    return { kind: 'enter', messages: [{ ...system, content }, ...rest] }
  })
}
