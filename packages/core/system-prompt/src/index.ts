/**
 * System-prompt assembly: an ordered section registry. Plugins register
 * prompt sections as effects — unload the plugin and its section disappears
 * from the next assembled prompt.
 */

import { Service, type Context } from '@abyss-harness/cordis'
import type { ToolDefinition } from '@abyss-harness/tools'

export interface PromptSection {
  name: string
  /** Lower sorts earlier; ties break by registration order. */
  order: number
  text: string
}

declare module '@abyss-harness/cordis' {
  interface Context {
    systemPrompt: SystemPromptService
  }
}

export class SystemPromptService extends Service {
  private sections = new Map<string, PromptSection>()

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  /**
   * Register a prompt section in the calling plugin's scope. Duplicate names
   * replace; disposal removes.
   */
  section(section: PromptSection): () => void {
    if (!Number.isFinite(section.order)) {
      throw new TypeError(`prompt section "${section.name}" order must be a finite number`)
    }
    this.sections.set(section.name, section)
    return () => this.sections.delete(section.name)
  }

  /**
   * Assemble the final system prompt: ordered sections plus the tool schema
   * list contributed by the tool registry.
   */
  assemble(toolSchemas: ToolDefinition[]): string {
    const parts = [...this.sections.values()]
      .sort((a, b) => a.order - b.order)
      .map(section => section.text)
    if (toolSchemas.length) {
      const lines = toolSchemas.map(schema =>
        `- ${schema.name}: ${schema.description} | parameters: ${JSON.stringify(schema.parameters)}`,
      )
      parts.push('Available tools:\n' + lines.join('\n'))
    }
    return parts.join('\n\n')
  }
}

export const name = 'system-prompt'

export function apply(ctx: Context) {
  ctx.plugin(SystemPromptService)
}
