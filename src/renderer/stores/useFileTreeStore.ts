/**
 * Which folders are open in the Files surface, per conversation.
 *
 * Module-level rather than component state: the panel unmounts every time the
 * user switches to another surface, and a tree that re-collapsed on the way
 * back would make the panel unusable for anything but the top level. Session
 * only — expansion is a reading position, not a preference worth restoring
 * weeks later.
 */

import { create } from 'zustand';

type FileTreeState = {
  expandedByConversationId: Record<string, string[]>;
  toggle: (conversationId: string, path: string) => void;
  collapseAll: (conversationId: string) => void;
};

export const useFileTreeStore = create<FileTreeState>()((set) => ({
  expandedByConversationId: {},
  toggle: (conversationId, path) =>
    set((state) => {
      const current = state.expandedByConversationId[conversationId] ?? [];
      const next = current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path];

      return {
        expandedByConversationId: { ...state.expandedByConversationId, [conversationId]: next },
      };
    }),
  collapseAll: (conversationId) =>
    set((state) => {
      if (!state.expandedByConversationId[conversationId]?.length) return state;
      return {
        expandedByConversationId: { ...state.expandedByConversationId, [conversationId]: [] },
      };
    }),
}));

const NO_EXPANDED: string[] = [];

export function useExpandedFolders(conversationId: string): string[] {
  return useFileTreeStore(
    (state) => state.expandedByConversationId[conversationId] ?? NO_EXPANDED
  );
}
