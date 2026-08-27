/**
 * Pure concession-chain column solver for Atlas's three-pane frame,
 * ported from dsh's `ui-layout/columns.ts`.
 *
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * the workbench toward its minimum, then auto-closing it (derived zero
 * width — width preferences are never rewritten, so widening the window
 * restores them). The sidebar never concedes: its rendered width is always
 * the drag preference, or the collapsed rail when collapsed. Center absorbs
 * any remaining deficit as the last resort.
 *
 * Pure on purpose: no hysteresis, breakpoints, or storage here. The output
 * is a function of (viewport, preferences) only, so recovery on re-widening
 * is automatic and the whole thing unit-tests without a DOM.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns {
  sidebar: number;
  center: number;
  details: number;
}

/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 208;
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 460;
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 284;
/** Collapsed-sidebar icon rail. Must stay in sync with the titlebar inset. */
export const SIDEBAR_RAIL = 56;
/** Workbench drag clamp floor. */
export const DETAILS_MIN = 300;
/** Workbench drag clamp ceiling. */
export const DETAILS_MAX = 720;
/** Workbench width before any user drag. */
export const DETAILS_DEFAULT = 420;
/**
 * Center column floor. Below this the transcript becomes unreadable, so the
 * chain closes the workbench first; only the final fallback may go lower.
 */
export const CENTER_MIN = 560;

/** Clamp a panel width into its contract range. */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * Solve the three column widths for one viewport frame.
 *
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = collapsed → rail).
 * @param details - workbench width preference in px (0 = closed).
 * @returns resolved widths; `details: 0` means visually closed (callers keep
 * the pane mounted at zero so its state survives), while a collapsed sidebar
 * keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  if (!Number.isFinite(viewport) || viewport <= 0) {
    // Degenerate frame: give center everything, park the panes.
    return { sidebar: 0, center: Math.max(0, viewport || 0), details: 0 };
  }

  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s =
    sidebar <= 0 ? SIDEBAR_RAIL : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const d0 = details <= 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX);

  // Step 1: everything fits at preferred widths.
  if (s + d0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: viewport - s - d0, details: d0 };
  }

  // Step 2: shrink the workbench toward its minimum.
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - CENTER_MIN);
  if (s + d1 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: CENTER_MIN, details: d1 };
  }

  // Step 3: auto-close the workbench (derived — preferences untouched);
  // center absorbs any remaining deficit (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0 };
}
