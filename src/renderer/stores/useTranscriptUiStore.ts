/**
 * Transcript disclosure state.
 *
 * The transcript is virtualized: rows outside the visible range are
 * unmounted (and, while `deferRichContent` is on, replaced by plain-text
 * stubs). Any `useState` living inside a tool/reasoning/changed-files cell
 * is therefore destroyed the moment the reader scrolls past it, so an
 * expanded cell silently re-collapses. Keeping the open/closed bit in a
 * module-level store makes it survive unmount → remount.
 *
 * Keys must be stable for the lifetime of the conversation:
 *   - tool cells   → `ToolCell.id` (the message-part / tool-call id)
 *   - reasoning    → the part id when available, else a hash of the text's
 *                    leading chunk (reasoning text only ever appends, so
 *                    the prefix is stable while streaming)
 *   - changed files→ a hash of the file-path set
 *
 * Only *explicit* user toggles are recorded. A missing entry means "use the
 * caller's default", which is what lets a cell auto-open on failure or
 * auto-collapse when reasoning ends while still letting a manual toggle win.
 */

import { create } from 'zustand';

/** Bound the map so a very long session cannot grow it without limit. */
const MAX_ENTRIES = 2000;

export type CellTiming = {
  /** Epoch ms when this cell was first observed streaming. */
  startedAt: number;
  /** Filled in once streaming ends; survives remounts. */
  durationMs: number | null;
};

type TranscriptUiState = {
  /** id → user's explicit open/closed choice. Absent = never toggled. */
  expanded: Record<string, boolean>;
  /**
   * cell id → measured working window. Used by the reasoning row and by the
   * turn's `Worked for …` header, which measure the same kind of thing: how
   * long something took while it was on screen.
   */
  timings: Record<string, CellTiming>;
  /**
   * Plans the tasks dock is currently drawing, by `PlanView.anchorId`.
   *
   * While a turn is live the dock and `PlanCell` hold the same checklist —
   * once pinned above the composer, once in a cell that scrolls away from it.
   * The transcript cannot work out on its own whether a dock exists to defer
   * to (a subagent takeover replaces the composer, dock and all), so instead
   * the dock declares the one plan it owns and the cell yields to the claim.
   * A set rather than a single id: the side chat runs a second dock.
   */
  dockPlans: Record<string, true>;
  setExpanded: (id: string, open: boolean) => void;
  toggleExpanded: (id: string, currentlyOpen: boolean) => void;
  /**
   * Record the moment a reasoning cell started streaming (idempotent).
   *
   * `inheritFrom` exists for the content-hashed fallback id: the id is
   * derived from the text's leading chunk, which is only final once enough
   * text has streamed in, so the first delta or two can produce a
   * short-lived id. Carrying its start time forward keeps the measured
   * duration honest instead of restarting the clock.
   */
  startTiming: (id: string, inheritFrom?: string) => void;
  /** Close out a cell's timing window (idempotent). */
  endTiming: (id: string) => void;
  /** The dock took over this plan; the matching `PlanCell` stands down. */
  claimDockPlan: (anchorId: string) => void;
  /** The dock let it go — on unmount, or when its turn settled. */
  releaseDockPlan: (anchorId: string) => void;
};

function trim<T>(map: Record<string, T>): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return map;
  const next: Record<string, T> = {};
  // Object key order is insertion order for string keys, so dropping the
  // head evicts the oldest cells — the ones scrolled furthest away.
  for (const key of keys.slice(keys.length - MAX_ENTRIES)) next[key] = map[key];
  return next;
}

export const useTranscriptUiStore = create<TranscriptUiState>((set) => ({
  expanded: {},
  timings: {},
  dockPlans: {},

  setExpanded: (id, open) =>
    set((state) => ({ expanded: trim({ ...state.expanded, [id]: open }) })),

  toggleExpanded: (id, currentlyOpen) =>
    set((state) => ({ expanded: trim({ ...state.expanded, [id]: !currentlyOpen }) })),

  startTiming: (id, inheritFrom) =>
    set((state) => {
      if (state.timings[id]) return state;
      const inherited = inheritFrom ? state.timings[inheritFrom]?.startedAt : undefined;
      return {
        timings: trim({
          ...state.timings,
          [id]: { startedAt: inherited ?? Date.now(), durationMs: null },
        }),
      };
    }),

  endTiming: (id) =>
    set((state) => {
      const existing = state.timings[id];
      if (!existing || existing.durationMs != null) return state;
      return {
        timings: trim({
          ...state.timings,
          [id]: { ...existing, durationMs: Date.now() - existing.startedAt },
        }),
      };
    }),

  claimDockPlan: (anchorId) =>
    set((state) =>
      state.dockPlans[anchorId] ? state : { dockPlans: { ...state.dockPlans, [anchorId]: true } }
    ),

  // Deleted rather than set false, so the map only ever holds live claims and
  // a long session cannot accumulate one entry per plan it has ever drawn.
  releaseDockPlan: (anchorId) =>
    set((state) => {
      if (!state.dockPlans[anchorId]) return state;
      const { [anchorId]: _released, ...rest } = state.dockPlans;
      return { dockPlans: rest };
    }),
}));

/**
 * Read a cell's disclosure state, falling back to `defaultOpen` until the
 * user makes a choice. The returned setter records an explicit choice, so
 * a manual toggle permanently outranks the default.
 */
export function useDisclosure(id: string, defaultOpen: boolean): [boolean, () => void] {
  const stored = useTranscriptUiStore((state) => state.expanded[id]);
  const toggle = useTranscriptUiStore((state) => state.toggleExpanded);
  const isOpen = stored ?? defaultOpen;
  return [isOpen, () => toggle(id, isOpen)];
}

/** FNV-1a — a stable id for cells the transcript gives us no id for. */
export function stableId(prefix: string, seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}:${seed.length}`;
}
