/**
 * The translucent-sidebar flag has to be on `<html>` before the first paint:
 * the sidebar's base rule is an opaque panel, so a flag that arrives after
 * mount renders one opaque frame and then flips to glass — a visible pop on
 * every launch with the setting on.
 *
 * The authoritative value lives in SQLite and reaches the renderer over IPC,
 * which is too late. This module mirrors it to localStorage (synchronous)
 * every time the App effect stamps it, and reads that mirror back here before
 * React renders. The mirror is only ever written on macOS — the App effect
 * gates on the platform — so a cached '1' is safe to trust without re-checking
 * anything but the platform itself.
 */

const STORAGE_KEY = 'atlas.translucent-sidebar';

export function stampTranslucentSidebar(enabled: boolean) {
  document.documentElement.dataset.translucentSidebar = enabled ? 'true' : 'false';
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // A blocked localStorage costs only the next launch's head start.
  }
}

/** Pre-render stamp from the last-known value. Runs once, before React mounts. */
export function stampCachedTranslucentSidebar(isMacPlatform: boolean) {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (cached !== '1' && cached !== '0') {
    return;
  }
  document.documentElement.dataset.translucentSidebar =
    isMacPlatform && cached === '1' ? 'true' : 'false';
}
