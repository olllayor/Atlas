/**
 * Opening a surface by kind, from anywhere in the app.
 *
 * The picker's cards and the app-level launchers (bare-letter shortcuts,
 * command palette, keybindings) all land here, so a kind opens the same way
 * no matter which door was used. Singleton kinds open by kind alone;
 * multi-instance kinds allocate their next id against the tabs already open —
 * a terminal letter is a *new* shell, a browser letter a *new* view.
 *
 * Reads stores through `getState()` at call time: the global shortcut handler
 * must not subscribe the whole window to per-token state just to answer an
 * occasional keypress.
 */

import { PRIMARY_TERMINAL_ID, nextTerminalId } from '../../../shared/terminalIds';
import { DEFAULT_WORKSPACE_MODE } from '../../../shared/workspaceModes';
import type { KeybindingCommand } from '../../../shared/contracts';
import { foldAgents } from '../../lib/agentFold';
import { useAppStore } from '../../stores/useAppStore';
import { useRightPanelStore } from '../../stores/useRightPanelStore';
import { terminalGroupKey, useTerminalSplitStore } from '../../stores/useTerminalSplitStore';
import {
  nextOrdinalResourceId,
  surfaceResourceId,
  type RightPanelKind,
} from './rightPanelModel';
import { SURFACE_DEFINITIONS, type SurfaceContext } from './surfaceRegistry';

/** Palette/shortcut commands that open one surface. Diff is covered by the existing `workbench.review.open`. */
export const SURFACE_OPEN_COMMANDS: Record<
  Extract<
    KeybindingCommand,
    | 'workbench.surface.open.git'
    | 'workbench.surface.open.tasks'
    | 'workbench.surface.open.terminal'
    | 'workbench.surface.open.browser'
    | 'workbench.surface.open.files'
    | 'workbench.surface.open.pullRequests'
    | 'workbench.surface.open.agents'
  >,
  RightPanelKind
> = {
  'workbench.surface.open.git': 'git',
  'workbench.surface.open.tasks': 'tasks',
  'workbench.surface.open.terminal': 'terminal',
  'workbench.surface.open.browser': 'browser',
  'workbench.surface.open.files': 'files',
  'workbench.surface.open.pullRequests': 'pullRequests',
  'workbench.surface.open.agents': 'agents',
};

export function surfaceKindForOpenCommand(command: KeybindingCommand): RightPanelKind | null {
  return (SURFACE_OPEN_COMMANDS as Partial<Record<KeybindingCommand, RightPanelKind>>)[command] ?? null;
}

/**
 * The registry's availability answered for one conversation, from live store
 * state. Null when there is no conversation to key surfaces by.
 */
export function resolveSurfaceContext(conversationId: string | undefined): SurfaceContext | null {
  if (!conversationId) return null;
  const state = useAppStore.getState();
  const summary = state.conversations.find((conversation) => conversation.id === conversationId) ?? null;
  const project = summary?.projectId
    ? (state.projects.find((entry) => entry.id === summary.projectId) ?? null)
    : null;
  const agents = foldAgents(state.activitiesByConversation[conversationId] ?? []);

  return {
    conversationId,
    mode: summary?.workspaceMode ?? DEFAULT_WORKSPACE_MODE,
    hasProject: Boolean(project?.exists),
    agentCount: agents.agents.length,
    liveAgentCount: agents.activeAgents.length,
  };
}

/** The `{ available, shortcut }` rows the letter matcher runs on. */
export function openableSurfaceActions(context: SurfaceContext) {
  return SURFACE_DEFINITIONS.filter((definition) => definition.launcher).map((definition) => ({
    kind: definition.kind,
    shortcut: definition.shortcut,
    available: definition.availability(context).available,
  }));
}

/**
 * Every shell id this conversation is already using: the dock's primary, every
 * open terminal tab's root, and every split pane — including panes whose shell
 * has not been spawned yet. Callers holding ids from elsewhere (the panel's
 * live terminal list) pass them as extras.
 */
export function takenTerminalIds(
  conversationId: string,
  extraTerminalIds: readonly string[] = []
): string[] {
  const panel = useRightPanelStore.getState().byConversationId[conversationId];
  const paneGroups = useTerminalSplitStore.getState().byGroupKey;
  const taken = new Set<string>([PRIMARY_TERMINAL_ID, ...extraTerminalIds]);

  for (const surface of panel?.surfaces ?? []) {
    if (surface.kind !== 'terminal') continue;
    const rootId = surfaceResourceId(surface);
    if (!rootId) continue;
    taken.add(rootId);
    for (const paneId of paneGroups[terminalGroupKey(conversationId, rootId)]?.terminalIds ?? []) {
      taken.add(paneId);
    }
  }

  return [...taken];
}

/** Open one surface the way the picker would: singletons by kind, terminal and browser as new instances. */
export function openSurfaceKind(
  conversationId: string,
  kind: RightPanelKind,
  options?: { extraTerminalIds?: readonly string[] }
): void {
  const store = useRightPanelStore.getState();

  if (kind === 'browser') {
    const panel = store.byConversationId[conversationId];
    const open = (panel?.surfaces ?? [])
      .filter((surface) => surface.kind === 'browser')
      .map((surface) => surfaceResourceId(surface) ?? '');
    store.openSurface(conversationId, 'browser', nextOrdinalResourceId('view', open));
    return;
  }

  if (kind === 'terminal') {
    store.openSurface(
      conversationId,
      'terminal',
      nextTerminalId(takenTerminalIds(conversationId, options?.extraTerminalIds))
    );
    return;
  }

  store.openSurface(conversationId, kind);
}
