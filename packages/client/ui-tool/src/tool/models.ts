import type { ToolItem } from '../index.ts'

/** Parse the folded args JSON; a malformed record falls back to the generic view. */
function parseArgs(argsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsText)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** read: `path` from args. */
export interface ReadModel {
  kind: 'read'
  path: string
}

export function readCardModel(item: ToolItem): ReadModel | null {
  if (item.name !== 'read') return null
  const path = parseArgs(item.argsText).path
  return typeof path === 'string' ? { kind: 'read', path } : null
}

/** write: `path` from args; the byte note comes off the result line. */
export interface WriteModel {
  kind: 'write'
  path: string
  byteNote?: string
}

export function writeCardModel(item: ToolItem): WriteModel | null {
  if (item.name !== 'write') return null
  const path = parseArgs(item.argsText).path
  if (typeof path !== 'string') return null
  const bytes = item.result?.content.match(/^wrote (\d+) bytes/)
  return { kind: 'write', path, byteNote: bytes ? `${bytes[1]} bytes` : undefined }
}

/** bash: `command` from args. */
export interface BashModel {
  kind: 'bash'
  command: string
}

export function bashCardModel(item: ToolItem): BashModel | null {
  if (item.name !== 'bash') return null
  const command = parseArgs(item.argsText).command
  return typeof command === 'string' ? { kind: 'bash', command } : null
}
