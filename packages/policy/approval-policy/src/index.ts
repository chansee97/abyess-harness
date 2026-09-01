/**
 * Approval policy: intercepts `tools/pre-execute` for the gated tool list and
 * decides through the FILE POLICY first, the human second — the miniature of
 * dsh's sandbox/approval split:
 *
 *  - policy-compliant calls are allowed WITHOUT a human prompt, and the
 *    decision is logged as a durable `tool/policy` event (the chat stream
 *    renders it as a muted policy row — the "operation allowed" indication);
 *  - calls the policy rejects outright (writes under read-only, shell under
 *    a confined mode with no enforcement backend) are denied with the reason;
 *  - calls that EXCEED the policy (a write outside the workspace under
 *    workspace-write) escalate to the browser approval card — the human is
 *    the escalation target, exactly as an approved wider-mode retry in dsh.
 *    No sandbox policy mounted → every gated call escalates (the old behavior).
 *
 * This plugin never touches the agent loop and knows nothing about HTTP —
 * the transport lives in web-api.
 */

import { resolve as resolvePath, sep } from 'node:path'
import type { Context } from '@abyss-harness/cordis'
import { ApprovalService } from '@abyss-harness/approval'
import type { SandboxExecutionPolicy } from '@abyss-harness/sandbox'
import type { SandboxPolicyService } from '@abyss-harness/sandbox-policy'
import type { PreToolDecision, ToolExecution } from '@abyss-harness/tools'

export const name = 'approval-policy'
export const inject = ['tools', 'session']

export interface Config {
  requireApproval: string[]
}

/** Path-bearing file tools: their `path` argument is checked against the workspace root. */
const PATH_TOOLS = new Set(['write', 'edit'])

/** The absolute path a call would touch, when statically knowable. */
function touchedPath(exec: ToolExecution): string | undefined {
  if (!PATH_TOOLS.has(exec.call.name)) return undefined
  const path = exec.call.arguments.path
  return typeof path === 'string' ? resolvePath(path) : undefined
}

/** True when `abs` sits at or under `root`. */
function underWorkspace(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Judge one gated call against the resolved policy. */
function judge(policy: SandboxExecutionPolicy, exec: ToolExecution, hasBackend: boolean): { decision: 'allow' | 'escalate' | 'deny'; reason?: string } {
  const abs = touchedPath(exec)
  switch (policy.mode) {
    case 'danger-full-access':
      return { decision: 'allow', reason: 'danger-full-access permits all file effects' }
    case 'read-only':
      // A write is always out of policy; a shell command can only run when a
      // backend is mounted to confine it (fail closed otherwise).
      if (abs !== undefined) return { decision: 'deny', reason: 'read-only file policy' }
      return hasBackend
        ? { decision: 'allow', reason: 'read-only policy with a confining backend' }
        : { decision: 'deny', reason: 'read-only policy and no sandbox backend to confine the command' }
    case 'workspace-write':
      if (abs === undefined) {
        // Shell (or an unknown path-bearing tool): statically unverifiable —
        // the backend confines when mounted, the human decides otherwise.
        return hasBackend
          ? { decision: 'allow', reason: 'confining backend enforces the workspace boundary' }
          : { decision: 'escalate' }
      }
      return underWorkspace(abs, policy.workspaceRoot)
        ? { decision: 'allow', reason: 'path is inside the workspace' }
        : { decision: 'escalate' }
  }
}

export function apply(ctx: Context, config: Config) {
  // Provide the service from THIS plugin (the seam definition lives in
  // approval-service.ts); consumers use ctx.get('approval') so the capability
  // stays optional to them.
  ctx.plugin(ApprovalService)
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!config.requireApproval.includes(exec.call.name)) {
      return next() // observe-and-delegate: ungated tools pass through
    }
    // This plugin owns the decision for its listed tools. The service is
    // guaranteed present: this same apply() mounted it as a child fiber,
    // which activates before this listener can fire.
    const approval = ctx.get('approval')!

    const policyService = ctx.get('sandboxPolicy', false) as SandboxPolicyService | undefined
    if (!policyService || !exec.sessionId) {
      // No policy to judge by: everything goes to the human.
      return escalate(approval, exec, next)
    }

    const policy = policyService.resolve(exec.sessionId)
    const hasBackend = !!ctx.get('sandbox', false)
    const { decision, reason } = judge(policy, exec, hasBackend)
    // Durable policy decision — the chat surface renders it as the
    // allow/deny/escalate indication, and replay keeps it.
    ctx.session.append(exec.sessionId, 'tool/policy', {
      tool: exec.call.name, mode: policy.mode, decision, reason,
    })

    if (decision === 'allow') return next()
    if (decision === 'deny') return { kind: 'deny', reason }
    return escalate(approval, exec, next)
  })
}

/** Hand the call to the human through the browser approval card. */
async function escalate(approval: ApprovalService, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
  const decision = await approval.request(exec)
  if (decision === 'allow') {
    return next()
  }
  return { kind: 'deny', reason: 'user declined' }
}
