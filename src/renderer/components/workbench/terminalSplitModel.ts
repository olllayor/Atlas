/**
 * Panes inside one terminal surface.
 *
 * A terminal tab is a group of shells rather than a single one, so `pnpm dev`
 * and `pnpm test` can be watched at once without giving up the tab strip to
 * two entries that mean the same thing. The tab still names itself after the
 * pane you are typing in.
 *
 * Kept beside the surface model rather than inside it: a surface is a pointer
 * at a resource, and teaching that generic shape about panes would make every
 * other kind carry a field it will never use. Same reasoning as the browser's
 * view state.
 *
 * Panes are capped, and splitting past the cap opens a new tab instead. Four
 * shells in a 400px column is already past the point where any of them is
 * readable; a fifth is a worse answer than a second tab.
 */

export const MAX_TERMINAL_PANES = 4;

/** Which way the panes are laid out. Named as the flex direction they become. */
export type SplitDirection = 'row' | 'column';

export type TerminalPaneGroup = {
  /** Spawn order, left to right or top to bottom. */
  terminalIds: string[];
  /** The pane that has focus, and whose name the tab carries. */
  activeTerminalId: string;
  direction: SplitDirection;
};

/** A tab that was never split: one pane, and nothing stored about it. */
export function singlePaneGroup(terminalId: string): TerminalPaneGroup {
  return { terminalIds: [terminalId], activeTerminalId: terminalId, direction: 'row' };
}

export function canSplit(group: TerminalPaneGroup): boolean {
  return group.terminalIds.length < MAX_TERMINAL_PANES;
}

/**
 * Adds a pane after the active one, so a split lands next to what the user
 * was looking at rather than at the end of the group.
 *
 * The first split decides the group's direction; later ones follow it. Mixing
 * directions inside one tab means a nested layout, which is a tree, a set of
 * ratios, and a lot of pointer maths for a pane that is 200px wide either way.
 */
export function splitPane(
  group: TerminalPaneGroup,
  terminalId: string,
  direction: SplitDirection
): TerminalPaneGroup {
  if (!canSplit(group) || group.terminalIds.includes(terminalId)) return group;

  const index = group.terminalIds.indexOf(group.activeTerminalId);
  const terminalIds = [...group.terminalIds];
  terminalIds.splice(index < 0 ? terminalIds.length : index + 1, 0, terminalId);

  return {
    terminalIds,
    activeTerminalId: terminalId,
    direction: group.terminalIds.length === 1 ? direction : group.direction,
  };
}

export function activatePane(group: TerminalPaneGroup, terminalId: string): TerminalPaneGroup {
  if (!group.terminalIds.includes(terminalId)) return group;
  if (group.activeTerminalId === terminalId) return group;
  return { ...group, activeTerminalId: terminalId };
}

/**
 * Removes a pane, handing focus to the one that slid into its place — the
 * same rule the tab strip follows when a tab closes.
 *
 * Returns null when the last pane goes: the caller closes the whole surface,
 * because a terminal tab with no shell in it is not a thing.
 */
export function closePane(group: TerminalPaneGroup, terminalId: string): TerminalPaneGroup | null {
  const index = group.terminalIds.indexOf(terminalId);
  if (index < 0) return group;

  const terminalIds = group.terminalIds.filter((id) => id !== terminalId);
  if (terminalIds.length === 0) return null;

  return {
    terminalIds,
    activeTerminalId:
      group.activeTerminalId === terminalId
        ? (terminalIds[Math.min(index, terminalIds.length - 1)] ?? terminalIds[0])
        : group.activeTerminalId,
    direction: group.direction,
  };
}
