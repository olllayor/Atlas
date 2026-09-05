/**
 * How each terminal tab is split, persisted.
 *
 * Keyed by conversation and by the tab's root terminal, so `term-2` in one
 * conversation is not the same group as `term-2` in another. A tab that was
 * never split stores nothing: `singlePaneGroup` is the answer for a missing
 * entry, which keeps the common case out of storage entirely.
 *
 * Persisted because the shells are: a split tab that came back as one pane
 * after a restart would leave a shell running with no way to reach it.
 */

import { useMemo } from 'react';
import { create } from 'zustand';

import {
  type SplitDirection,
  type TerminalPaneGroup,
  activatePane,
  closePane,
  singlePaneGroup,
  splitPane,
} from '../components/workbench/terminalSplitModel';

const STORAGE_KEY = 'atlas.terminalSplits';

type TerminalSplitStore = {
  byGroupKey: Record<string, TerminalPaneGroup>;
  split: (groupKey: string, rootTerminalId: string, terminalId: string, direction: SplitDirection) => void;
  activate: (groupKey: string, rootTerminalId: string, terminalId: string) => void;
  /** Removes one pane. The group is dropped entirely when it was the last. */
  closePane: (groupKey: string, rootTerminalId: string, terminalId: string) => void;
  forget: (groupKey: string) => void;
};

export function terminalGroupKey(conversationId: string, rootTerminalId: string): string {
  return `${conversationId}:${rootTerminalId}`;
}

function loadPersisted(): Record<string, TerminalPaneGroup> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const restored: Record<string, TerminalPaneGroup> = {};
    for (const [groupKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const group = value as Partial<TerminalPaneGroup>;

      // Every id is used to address a PTY, so anything that is not a list of
      // strings is dropped rather than repaired into something plausible.
      const terminalIds = Array.isArray(group.terminalIds)
        ? [...new Set(group.terminalIds.filter((id): id is string => typeof id === 'string'))]
        : [];
      if (terminalIds.length === 0) continue;

      restored[groupKey] = {
        terminalIds,
        activeTerminalId:
          typeof group.activeTerminalId === 'string' &&
          terminalIds.includes(group.activeTerminalId)
            ? group.activeTerminalId
            : terminalIds[0],
        direction: group.direction === 'column' ? 'column' : 'row',
      };
    }
    return restored;
  } catch {
    return {};
  }
}

export const useTerminalSplitStore = create<TerminalSplitStore>()((set) => {
  const update = (
    groupKey: string,
    rootTerminalId: string,
    reducer: (current: TerminalPaneGroup) => TerminalPaneGroup | null
  ) =>
    set((state) => {
      const current = state.byGroupKey[groupKey] ?? singlePaneGroup(rootTerminalId);
      const next = reducer(current);

      if (next === current) return state;
      if (next === null) {
        const { [groupKey]: _removed, ...rest } = state.byGroupKey;
        return { byGroupKey: rest };
      }
      return { byGroupKey: { ...state.byGroupKey, [groupKey]: next } };
    });

  return {
    byGroupKey: loadPersisted(),
    split: (groupKey, rootTerminalId, terminalId, direction) =>
      update(groupKey, rootTerminalId, (group) => splitPane(group, terminalId, direction)),
    activate: (groupKey, rootTerminalId, terminalId) =>
      update(groupKey, rootTerminalId, (group) => activatePane(group, terminalId)),
    closePane: (groupKey, rootTerminalId, terminalId) =>
      update(groupKey, rootTerminalId, (group) => closePane(group, terminalId)),
    forget: (groupKey) =>
      set((state) => {
        if (!(groupKey in state.byGroupKey)) return state;
        const { [groupKey]: _removed, ...rest } = state.byGroupKey;
        return { byGroupKey: rest };
      }),
  };
});

useTerminalSplitStore.subscribe((state, previous) => {
  if (state.byGroupKey === previous.byGroupKey) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.byGroupKey));
  } catch {
    // Non-fatal: the tab still works, it just forgets its layout on restart.
  }
});

/** One tab's panes. An unsplit tab has no entry and answers with its own id. */
export function useTerminalPanes(groupKey: string, rootTerminalId: string): TerminalPaneGroup {
  const stored = useTerminalSplitStore((state) => state.byGroupKey[groupKey]);
  // Memoised so an unsplit tab does not hand its children a new object on
  // every render, which would defeat any memo below it.
  return useMemo(() => stored ?? singlePaneGroup(rootTerminalId), [stored, rootTerminalId]);
}
