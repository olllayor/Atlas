/**
 * The right panel's surfaces, per conversation, persisted across restarts.
 *
 * All of the reasoning lives in `components/workbench/rightPanelModel.ts`; this
 * is the zustand shell around it plus localStorage. Storage failures are never
 * fatal: a panel that refuses to open because a quota was exceeded would be a
 * worse bug than one that forgets last session's tabs.
 */

import { create } from 'zustand';

import {
  EMPTY_PANEL_STATE,
  RIGHT_PANEL_STORAGE_KEY,
  type ConversationPanelState,
  type RightPanelKind,
  type RightPanelSurface,
  type SurfaceId,
  activateSurface,
  closeAllSurfaces,
  closeOtherSurfaces,
  closeSurface,
  closeSurfacesToRight,
  hidePanel,
  makeSurface,
  migratePersistedRightPanelState,
  openSurface,
  reconcileSurfaces,
  serializeRightPanelState,
  showPanel,
  togglePanel,
  updateConversation,
} from '../components/workbench/rightPanelModel';

type RightPanelStore = {
  byConversationId: Record<string, ConversationPanelState>;
  openSurface: (conversationId: string, kind: RightPanelKind, resourceId?: string) => void;
  activateSurface: (conversationId: string, id: SurfaceId) => void;
  closeSurface: (conversationId: string, id: SurfaceId) => void;
  closeOtherSurfaces: (conversationId: string, id: SurfaceId) => void;
  closeSurfacesToRight: (conversationId: string, id: SurfaceId) => void;
  closeAllSurfaces: (conversationId: string) => void;
  showPanel: (conversationId: string) => void;
  hidePanel: (conversationId: string) => void;
  togglePanel: (conversationId: string) => void;
  /** Drops tabs whose resource is gone. Called by the surfaces that can lose one. */
  reconcileSurfaces: (
    conversationId: string,
    isAlive: (surface: RightPanelSurface) => boolean
  ) => void;
  /** The conversation was deleted; its panel goes with it. */
  forgetConversation: (conversationId: string) => void;
};

function loadPersisted(): Record<string, ConversationPanelState> {
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
    if (!raw) return {};
    return migratePersistedRightPanelState(JSON.parse(raw)).byConversationId;
  } catch {
    return {};
  }
}

export const useRightPanelStore = create<RightPanelStore>()((set) => {
  const update = (
    conversationId: string,
    reducer: (current: ConversationPanelState) => ConversationPanelState
  ) =>
    set((state) => {
      const byConversationId = updateConversation(state.byConversationId, conversationId, reducer);
      return byConversationId === state.byConversationId ? state : { byConversationId };
    });

  return {
    byConversationId: loadPersisted(),
    openSurface: (conversationId, kind, resourceId) =>
      update(conversationId, (current) => openSurface(current, makeSurface(kind, resourceId))),
    activateSurface: (conversationId, id) =>
      update(conversationId, (current) => activateSurface(current, id)),
    closeSurface: (conversationId, id) =>
      update(conversationId, (current) => closeSurface(current, id)),
    closeOtherSurfaces: (conversationId, id) =>
      update(conversationId, (current) => closeOtherSurfaces(current, id)),
    closeSurfacesToRight: (conversationId, id) =>
      update(conversationId, (current) => closeSurfacesToRight(current, id)),
    closeAllSurfaces: (conversationId) => update(conversationId, closeAllSurfaces),
    showPanel: (conversationId) => update(conversationId, showPanel),
    hidePanel: (conversationId) => update(conversationId, hidePanel),
    togglePanel: (conversationId) => update(conversationId, togglePanel),
    reconcileSurfaces: (conversationId, isAlive) =>
      update(conversationId, (current) => reconcileSurfaces(current, isAlive)),
    forgetConversation: (conversationId) =>
      set((state) => {
        if (!(conversationId in state.byConversationId)) return state;
        const { [conversationId]: _removed, ...rest } = state.byConversationId;
        return { byConversationId: rest };
      }),
  };
});

useRightPanelStore.subscribe((state, previous) => {
  if (state.byConversationId === previous.byConversationId) return;
  try {
    window.localStorage.setItem(
      RIGHT_PANEL_STORAGE_KEY,
      serializeRightPanelState({ byConversationId: state.byConversationId })
    );
  } catch {
    // Non-fatal: the panel keeps working, it just forgets on restart.
  }
});

/**
 * One conversation's panel. Returns a shared frozen empty state rather than a
 * fresh object, so a conversation with no panel yet does not re-render its
 * subscribers on every store change.
 */
export function useConversationPanel(conversationId: string | undefined): ConversationPanelState {
  return useRightPanelStore((state) =>
    conversationId ? (state.byConversationId[conversationId] ?? EMPTY_PANEL_STATE) : EMPTY_PANEL_STATE
  );
}
