import { useSyncExternalStore } from 'react';

/**
 * Single source of truth for "should this thing animate?".
 *
 * App.tsx resolves the Appearance setting (`on` / `off` / `system`) against the
 * OS preference and stamps the answer on <html data-reduce-motion>. styles.css
 * keys its animation kill switch off that same attribute, so anything that
 * decides in JavaScript has to read the attribute too — reading
 * `matchMedia('(prefers-reduced-motion: reduce)')` directly honours the OS but
 * silently ignores the app setting, which is the whole point of having one.
 */

const REDUCE_MOTION_ATTRIBUTE = 'data-reduce-motion';
const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The decision, minus the DOM. `attribute` is the raw value of
 * <html data-reduce-motion>, `systemPrefersReduced` the OS media query.
 *
 * The attribute is written by an effect, so on the very first paint (and in any
 * host that never mounts App) it is absent — falling back to the media query
 * keeps the OS preference honoured during that window instead of briefly
 * animating at someone who asked the system for stillness.
 */
export function resolveReducedMotion(
  attribute: string | null | undefined,
  systemPrefersReduced: boolean,
): boolean {
  if (attribute === 'true') return true;
  if (attribute === 'false') return false;
  return systemPrefersReduced;
}

function systemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCE_MOTION_QUERY).matches;
}

/**
 * Imperative read, for code that runs outside React (view transitions, imperative
 * animation setup). Safe to call before the root attribute exists.
 */
export function isReducedMotion(): boolean {
  const attribute =
    typeof document === 'undefined'
      ? null
      : document.documentElement.getAttribute(REDUCE_MOTION_ATTRIBUTE);
  return resolveReducedMotion(attribute, systemPrefersReducedMotion());
}

/**
 * Fires `onChange` whenever the answer could have changed: the user toggling the
 * setting rewrites the root attribute, and the OS preference moves the media
 * query (which still matters while the attribute is unset).
 *
 * Module-level so it is referentially stable as a useSyncExternalStore subscriber.
 */
export function subscribeReducedMotion(onChange: () => void): () => void {
  const disposers: Array<() => void> = [];

  if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
    const root = document.documentElement;
    const observer = new MutationObserver(onChange);
    observer.observe(root, { attributes: true, attributeFilter: [REDUCE_MOTION_ATTRIBUTE] });
    disposers.push(() => observer.disconnect());
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia(REDUCE_MOTION_QUERY);
    mql.addEventListener?.('change', onChange);
    disposers.push(() => mql.removeEventListener?.('change', onChange));
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/**
 * React binding. Re-renders when the setting or the OS preference changes, so a
 * component that mounted while motion was allowed stops animating the moment
 * the user turns Reduce Motion on.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, isReducedMotion, () => false);
}
