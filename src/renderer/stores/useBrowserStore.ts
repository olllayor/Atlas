/**
 * Where each browser surface is pointed, and what the page there calls itself.
 *
 * Kept outside the component and persisted, for the same reason the surface
 * list is: the guest is destroyed when the user switches to another tab, so
 * without this a browser tab would come back blank every time. It comes back
 * on the page it was on instead — reloaded, not restored, since a `<webview>`
 * cannot be suspended and resumed.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'atlas.browserViews';

export type BrowserViewState = {
  url: string | null;
  /** The page's own title, for the tab. Null until the page says. */
  title: string | null;
};

type BrowserStore = {
  byViewId: Record<string, BrowserViewState>;
  navigate: (viewId: string, url: string) => void;
  setTitle: (viewId: string, title: string) => void;
  forget: (viewId: string) => void;
};

const EMPTY_VIEW: BrowserViewState = Object.freeze({ url: null, title: null });

function loadPersisted(): Record<string, BrowserViewState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const restored: Record<string, BrowserViewState> = {};
    for (const [viewId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const { url, title } = value as Partial<BrowserViewState>;
      // A stored URL is loaded into a guest on the next mount, so anything
      // that is not a string is dropped rather than handed to `src`.
      restored[viewId] = {
        url: typeof url === 'string' ? url : null,
        title: typeof title === 'string' ? title : null,
      };
    }
    return restored;
  } catch {
    return {};
  }
}

export const useBrowserStore = create<BrowserStore>()((set) => ({
  byViewId: loadPersisted(),
  navigate: (viewId, url) =>
    set((state) => {
      const current = state.byViewId[viewId];
      if (current?.url === url) return state;
      // A new address means the old page's title no longer describes the tab.
      return { byViewId: { ...state.byViewId, [viewId]: { url, title: null } } };
    }),
  setTitle: (viewId, title) =>
    set((state) => {
      const current = state.byViewId[viewId] ?? EMPTY_VIEW;
      if (current.title === title) return state;
      return { byViewId: { ...state.byViewId, [viewId]: { ...current, title } } };
    }),
  forget: (viewId) =>
    set((state) => {
      if (!(viewId in state.byViewId)) return state;
      const { [viewId]: _removed, ...rest } = state.byViewId;
      return { byViewId: rest };
    }),
}));

useBrowserStore.subscribe((state, previous) => {
  if (state.byViewId === previous.byViewId) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.byViewId));
  } catch {
    // Non-fatal: the tab still works, it just forgets its page on restart.
  }
});

export function useBrowserView(viewId: string): BrowserViewState {
  return useBrowserStore((state) => state.byViewId[viewId] ?? EMPTY_VIEW);
}
