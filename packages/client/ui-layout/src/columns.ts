/**
 * Two-column width solver for the AppFrame (sidebar | conversation),
 * mirroring harness's columns.ts concession chain. The sidebar never
 * concedes: its rendered width is always the drag preference (or the
 * collapsed rail), and the conversation column absorbs the remainder.
 * Inputs are plain width preferences (0 = closed); a closed sidebar
 * resolves to the fixed SIDEBAR_COLLAPSED control rail. The
 * SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides
 * the effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number }

// Contract-frozen geometry.
/** Conversation column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 56px icon column. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (a manual
 * toggle below it re-expands over the squeezed center via narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024

/**
 * Clamp a sidebar width into its contract range.
 * @param px - requested width.
 * @returns the clamped width.
 */
export function clampSidebar(px: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)))
}

/**
 * Solve the two column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preference) only, so recovery on
 * re-widening is automatic.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @returns resolved widths; a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampSidebar(sidebar)

  // Everything fits at preferred widths.
  if (s + CENTER_MIN <= viewport) return { sidebar: s, center: viewport - s }

  // Center absorbs the deficit (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s) }
}
