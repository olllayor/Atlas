/*
 * Browser chrome stamp (t3code method, adapted for vibrancy).
 *
 * The page paints its own surfaces, but pixels outside them — overscroll
 * bounce, the root canvas before first paint, PWA/mobile browser chrome via
 * theme-color — come from html/body and meta tags. This reads the *computed*
 * --bg-base after every theme stamp and points those at it, so the frame can
 * never disagree with the page about which color the app is.
 *
 * Vibrancy owns the background while active: painting an inline color would
 * seal the material shut. Translucent windows get the meta update only.
 */

const THEME_COLOR_META = 'theme-color';

function normalizeChromeColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? '';
  if (!trimmed || trimmed === 'transparent' || trimmed === 'rgba(0, 0, 0, 0)') {
    return null;
  }
  return value!.trim();
}

function ensureThemeColorMeta(): HTMLMetaElement | null {
  const existing = document.querySelectorAll<HTMLMetaElement>(`meta[name="${THEME_COLOR_META}"]`);
  if (existing.length > 0) return null;
  const element = document.createElement('meta');
  element.name = THEME_COLOR_META;
  document.head.append(element);
  return element;
}

export function syncBrowserChromeTheme(options: { translucent: boolean } = { translucent: false }) {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;

  // Computed, not authored: custom overrides and design themes resolve here.
  const tokenColor = normalizeChromeColor(getComputedStyle(root).getPropertyValue('--bg-base'));
  const bodyColor = normalizeChromeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = tokenColor ?? bodyColor;
  if (!backgroundColor) return;

  if (!options.translucent) {
    root.style.backgroundColor = backgroundColor;
    document.body.style.backgroundColor = backgroundColor;
  } else {
    // A stale inline paint from the opaque era would seal the vibrancy
    // material shut; the transparent CSS takes it from here.
    root.style.removeProperty('background-color');
    document.body.style.removeProperty('background-color');
  }
  // Every theme-color meta carries the resolved color, including any a later
  // layer adds (e.g. media-scoped ones).
  const metas = document.querySelectorAll<HTMLMetaElement>(`meta[name="${THEME_COLOR_META}"]`);
  if (metas.length === 0) {
    ensureThemeColorMeta()?.setAttribute('content', backgroundColor);
    return;
  }
  for (const element of metas) {
    element.setAttribute('content', backgroundColor);
  }
}
