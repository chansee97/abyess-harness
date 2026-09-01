/**
 * The tool-call presentation domain — the miniature of dsh-client-ui-tool.
 * One shell (ToolCard) owns the disclosure interaction, shaped like the
 * Think block; per-tool views render the body; pure models derive view
 * props (null → generic).
 */

/** One rendered tool-call record derived from the fold of session events. */
export interface ToolItem {
  callId: string
  name: string
  argsText: string
  result?: { content: string; denied?: boolean }
}

export { ToolCard } from './tool/ToolCard.tsx'
