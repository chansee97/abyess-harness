/**
 * Process-sandbox capability seam: wrap an exact subprocess argv under a
 * file-effect policy, or fail closed. Mirrors harness's packages/sandbox/
 * sandbox — this demo ships the vocabulary and the contract only; local
 * enforcement backends (harness's landlock/bwrap/seatbelt/Windows-ACL
 * providers) would register a concrete SandboxProvider on `ctx.sandbox`.
 * @module @abyss-harness/sandbox
 */

import { Service, type Context } from '@abyss-harness/cordis'

/**
 * File-effect policy for confined processes. `read-only` permits no durable
 * writes; `workspace-write` also permits the workspace root (and a
 * backend-defined temp area); `danger-full-access` bypasses confinement.
 * Network and process visibility are outside this vocabulary.
 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** A confining (non-`danger-full-access`) mode — the modes a policy can carry to {@link SandboxProvider.confine}. */
export type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>

/** Enforcement completeness for one host. `partial` means the backend cannot govern every promised file effect. */
export type SandboxEnforcement = 'full' | 'partial'

/**
 * The complete file-effect policy resolved for one capability call. The root
 * is carried even under modes that do not consume it so callers can resolve
 * policy once before choosing the enforcement path.
 */
export interface SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: SandboxMode
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string
}

/**
 * What one confined execution is allowed to touch — carried PER CALL, not
 * fixed on the provider: two consumers may confine under different policies
 * at the same instant, and an approved escalated retry is a new call with a
 * wider policy. Defaulting/resolution is an explicit step at the consumer
 * boundary; the provider treats the policy as fully specified.
 */
export interface SandboxPolicy extends SandboxExecutionPolicy {
  mode: ConfinedSandboxMode
}

/**
 * A {@link SandboxProvider.confine} result: the argv to spawn in place of the
 * caller's own, plus the enforcement completeness the selected backend
 * achieves, and the backend's denial dialect (case-insensitive stderr
 * substrings a file effect denied by THIS backend produces).
 */
export interface ConfinedArgv {
  /** The wrapped argv (runner, profile, separator, then the caller's argv). */
  argv: string[]
  enforcement: SandboxEnforcement
  denialSignatures: readonly string[]
}

/**
 * Error code for a requested confined mode when no backend is usable. The
 * provider fails closed; the code lets callers distinguish missing
 * confinement from command failure.
 */
export const SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE'

/**
 * Thrown when confinement is requested but no backend can enforce it.
 * Silent unconfined passthrough is forbidden — refusing is the contract.
 */
export class SandboxUnavailableError extends Error {
  readonly code = SANDBOX_UNAVAILABLE
  constructor(mode: ConfinedSandboxMode, detail?: string) {
    super(
      `sandbox mode "${mode}" is requested but no sandbox backend is usable on this host; `
      + 'refusing to run the command unconfined. Provide a SandboxProvider backend or '
      + 'switch the consumer to danger-full-access.'
      + (detail === undefined ? '' : ` Runner failure: ${detail}`),
    )
    this.name = 'SandboxUnavailableError'
  }
}

declare module '@abyss-harness/cordis' {
  interface Context {
    sandbox: SandboxProvider
  }
}

/**
 * Abstract process-sandbox service. {@link confine} must return enforcing
 * argv or fail closed at wrap time; silent unconfined passthrough is
 * forbidden. This package registers no provider — a host without a backend
 * keeps confined modes failing closed.
 */
export abstract class SandboxProvider extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sandbox')
  }

  /**
   * Wrap `argv` so it executes confined under `policy` on this host; the
   * caller spawns the returned argv in place of its own.
   *
   * @param argv - the exact argv the caller is about to spawn (program plus
   *   arguments), NOT a shell string — a shell-shaped consumer passes
   *   `['bash', '-c', command]`.
   * @param policy - the file-effect policy this execution runs under.
   */
  abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
}

export default SandboxProvider
