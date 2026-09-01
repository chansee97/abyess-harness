/**
 * Tool registry and guarded execution pipeline — the demo's most important
 * seam. Mirrors dsh's three-stage waterfall (`tools/pre-execute` →
 * `tools/execute` → `tools/post-execute`) so policies can allow/deny before
 * dispatch, wrap execution (timeout, metrics), and rewrite or block results.
 */

import { Service, type Context } from '@abyss-harness/cordis'
import type { ToolCall } from '@abyss-harness/session/types'

/** JSON Schema (subset) describing one tool's parameters. */
export interface ToolParameters {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

/** Execution context handed to the tool body. */
export interface ToolRunContext {
  call: ToolCall
  signal: AbortSignal
  /** Session the call belongs to, when the loop knows it (e.g. ask-user routing). */
  sessionId?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: ToolParameters
  /**
   * Scheduling class: `parallel`-safe calls (read-only lookups) may run
   * concurrently with other parallel calls in a bounded pool; `exclusive`
   * calls (writes, shell, anything comparing or mutating shared state) run
   * alone as a barrier. Default `exclusive` — the safe default.
   */
  concurrency?: 'exclusive' | 'parallel'
  /** Run one accepted call; returns the canonical result value. */
  execute(args: Record<string, unknown>, exec: ToolRunContext): Promise<unknown>
}

export interface ToolExecution {
  call: ToolCall
  caller: string
  signal: AbortSignal
  /** Session the call belongs to, when the loop knows it (approval routing). */
  sessionId?: string
}

export type PreToolDecision = { kind: 'allow' } | { kind: 'deny'; reason?: string }

export interface ToolResult {
  callId: string
  ok: boolean
  /** JSON-serialized canonical value, or the error/policy message. */
  content: string
  denied?: boolean
  error?: boolean
}

declare module '@abyss-harness/cordis' {
  interface Context {
    tools: ToolRegistry
  }

  interface Events {
    /**
     * Allow, deny, or ask before dispatch. `next()` delegates to allow;
     * returning without calling it short-circuits the pipeline with a denial.
     *
     * @mode waterfall
     */
    'tools/pre-execute'(this: ToolRegistry, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
    /**
     * Around-dispatch waterfall for timeout, retry, or metrics wrappers.
     * `next()` runs the actual tool body.
     *
     * @mode waterfall
     */
    'tools/execute'(this: ToolRegistry, exec: ToolExecution, next: () => Promise<unknown>): Promise<unknown>
    /**
     * Accept, replace, enrich, or block a normalized result.
     *
     * @mode waterfall
     */
    'tools/post-execute'(this: ToolRegistry, exec: ToolExecution, result: Readonly<ToolResult>, next: () => Promise<ToolResult>): Promise<ToolResult>
    /**
     * Observe the final outcome of every tool call in the app.
     *
     * @mode emit
     */
    'tools/result'(exec: Readonly<ToolExecution>, result: Readonly<ToolResult>): void
  }
}

function validateArgs(args: unknown, parameters: ToolParameters): string | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return 'arguments must be an object'
  }
  for (const name of parameters.required ?? []) {
    if (!(name in args)) return `missing required argument "${name}"`
  }
  // Type-check declared properties: a wrong-typed argument is rejected before
  // the tool body sees it (model output is untrusted input).
  const typeOf = (value: unknown): string => {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value
  }
  for (const [name, spec] of Object.entries(parameters.properties)) {
    const declared = (spec as { type?: string }).type
    if (declared === undefined || !(name in args)) continue
    const actual = typeOf((args as Record<string, unknown>)[name])
    if (declared === 'integer' || declared === 'number') {
      if (actual !== 'number') return `argument "${name}" must be a number (got ${actual})`
    } else if (declared === 'array') {
      if (actual !== 'array') return `argument "${name}" must be an array (got ${actual})`
    } else if (actual !== declared) {
      return `argument "${name}" must be a ${declared} (got ${actual})`
    }
  }
  return undefined
}

export class ToolRegistry extends Service {
  private definitions = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /** Register a tool owned by the calling plugin's fiber. */
  register(definition: ToolDefinition): () => void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`tool "${definition.name}" is already registered`)
    }
    this.definitions.set(definition.name, definition)
    return () => this.definitions.delete(definition.name)
  }

  schemas(): ToolDefinition[] {
    return [...this.definitions.values()]
  }

  /** Whether a registered tool declared itself safe to run in parallel. */
  isParallelSafe(name: string): boolean {
    return this.definitions.get(name)?.concurrency === 'parallel'
  }

  /**
   * Run one tool call through the guarded pipeline:
   * pre-execute (policy) → execute (body) → post-execute (result policy).
   */
  async execute(call: ToolCall, options: { caller?: string; signal?: AbortSignal; sessionId?: string } = {}): Promise<ToolResult> {
    const exec: ToolExecution = {
      call,
      caller: options.caller ?? 'model',
      signal: options.signal ?? new AbortController().signal,
      sessionId: options.sessionId,
    }
    const definition = this.definitions.get(call.name)
    if (!definition) {
      const result: ToolResult = { callId: call.id, ok: false, error: true, content: `unknown tool "${call.name}"` }
      this.ctx.emit('tools/result', exec, result)
      return result
    }

    // Stage 1: pre-execute waterfall. The built-in behavior is "allow".
    const decision = await this.ctx.waterfall(
      this,
      'tools/pre-execute',
      exec,
      async (): Promise<PreToolDecision> => ({ kind: 'allow' }),
    )
    if (decision.kind === 'deny') {
      const denied: ToolResult = {
        callId: call.id,
        ok: false,
        denied: true,
        content: `denied by policy${decision.reason ? `: ${decision.reason}` : ''}`,
      }
      const finalDenied = await this.postExecute(exec, denied)
      this.ctx.emit('tools/result', exec, finalDenied)
      return finalDenied
    }

    // Stage 2: around-dispatch waterfall. The innermost next() runs the body.
    let outcome: ToolResult
    try {
      const validationError = validateArgs(call.arguments, definition.parameters)
      if (validationError) throw new Error(validationError)
      const value = await this.ctx.waterfall(this, 'tools/execute', exec, () =>
        definition.execute(call.arguments, { call, signal: exec.signal, sessionId: exec.sessionId }))
      outcome = { callId: call.id, ok: true, content: JSON.stringify(value) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome = { callId: call.id, ok: false, error: true, content: message }
    }

    // Stage 3: post-execute waterfall, then broadcast.
    const final = await this.postExecute(exec, outcome)
    this.ctx.emit('tools/result', exec, final)
    return final
  }

  private postExecute(exec: ToolExecution, result: ToolResult): Promise<ToolResult> {
    return this.ctx.waterfall(this, 'tools/post-execute', exec, result, async (): Promise<ToolResult> => result)
  }
}

export const name = 'tools'

export function apply(ctx: Context) {
  ctx.plugin(ToolRegistry)
}
