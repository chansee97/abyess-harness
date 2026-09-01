/**
 * LLM service: an adapter registry whose streaming call API is interceptable
 * through the `llm/stream` waterfall — the same seam shape as dsh's
 * `ctx.llm` (packages/llm/llm). Adapters are registered by route name; the
 * route travels on each request, so swapping a provider is a config change.
 *
 * @module llm
 */

import { Service, type Context } from '@abyss-harness/cordis'
import type { GenerateOptions, StreamChunk } from '@abyss-harness/session/types'

/** A provider backend: turn options into a chunk stream. */
export interface LlmAdapter {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

declare module '@abyss-harness/cordis' {
  interface Context {
    llm: LlmRuntime
  }

  interface Events {
    /**
     * Wrap or replace one model call's chunk stream. `next()` delegates to
     * the rest of the chain (ultimately the selected adapter); returning
     * without calling `next()` replaces the stream entirely.
     *
     * @mode waterfall
     */
    'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
  }
}

export class LlmRuntime extends Service {
  private adapters = new Map<string, LlmAdapter>()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /**
   * Register an adapter for a route. The registration is an effect owned by
   * the calling plugin: unloading it unregisters the adapter.
   */
  register(route: string, adapter: LlmAdapter): () => void {
    if (this.adapters.has(route)) {
      throw new Error(`llm: route "${route}" is already registered`)
    }
    this.adapters.set(route, adapter)
    return () => this.adapters.delete(route)
  }

  resolve(route: string): LlmAdapter | undefined {
    return this.adapters.get(route)
  }

  /** Stream one model call through the `llm/stream` waterfall. */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const dispatch = (): AsyncIterable<StreamChunk> => {
      const adapter = this.adapters.get(options.route)
      if (!adapter) throw new Error(`llm: no adapter registered for route "${options.route}"`)
      return adapter.stream(options)
    }
    return this.ctx.waterfall(this, 'llm/stream', options, dispatch)
  }
}

export const name = 'llm'

export function apply(ctx: Context) {
  ctx.plugin(LlmRuntime)
}
