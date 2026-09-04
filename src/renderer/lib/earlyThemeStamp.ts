import {
  type DesignTheme,
  type ThemeMode,
  resolveAppliedThemeMode,
} from '../../shared/contracts';
import { applyThemePalette } from './themePalette';

export const THEME_MODE_STORAGE_KEY = 'atlas.theme-mode';
export const DESIGN_THEME_STORAGE_KEY = 'atlas.design-theme';
export const THEME_ID_STORAGE_KEY = 'atlas.theme-id';
export const APPEARANCE_FONTS_STORAGE_KEY = "atlas.appearance-fonts";

export function persistCachedFonts(fonts: Record<string, unknown>) {
  try {
    localStorage.setItem(APPEARANCE_FONTS_STORAGE_KEY, JSON.stringify(fonts));
  } catch {
    // Non-fatal
  }
}


export function persistCachedTheme(
  mode: ThemeMode,
  designTheme: DesignTheme,
  themeId?: string
) {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    localStorage.setItem(DESIGN_THEME_STORAGE_KEY, designTheme);
    if (themeId) {
      localStorage.setItem(THEME_ID_STORAGE_KEY, themeId);
    } else {
      localStorage.removeItem(THEME_ID_STORAGE_KEY);
    }
  } catch {
    // Non-fatal if localStorage is unavailable
  }
}

/**
 * Pre-render stamp from the last-known theme settings.
 *
 * Runs once in main.tsx before React mounts. Without this, the page renders
 * unthemed or defaults to dark while IPC resolves settings, creating a visible
 * flash for light mode or alternative themes on every launch.
 */
export function stampCachedTheme() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  let mode: ThemeMode | null = null;
  let designTheme: DesignTheme | null = null;
  let themeId: string | null = null;
  try {
    mode = localStorage.getItem(THEME_MODE_STORAGE_KEY) as ThemeMode | null;
    designTheme = localStorage.getItem(DESIGN_THEME_STORAGE_KEY) as DesignTheme | null;
    themeId = localStorage.getItem(THEME_ID_STORAGE_KEY);
  } catch {
    return;
  }

  if (!mode && !designTheme && !themeId) return;

  const effectiveMode = mode ?? 'system';
  const effectiveDesignTheme = designTheme ?? 'default';
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true;
  const resolved = resolveAppliedThemeMode(effectiveMode, effectiveDesignTheme, prefersDark);

  const root = document.documentElement;
  const isDark = resolved === 'dark';
  root.classList?.toggle('dark', isDark);
  root.dataset.theme = resolved;
  root.dataset.designTheme = effectiveDesignTheme;
  root.style.colorScheme = resolved;

  if (themeId) {
    applyThemePalette(themeId, resolved);
  }

  try {
    const rawFonts = localStorage.getItem(APPEARANCE_FONTS_STORAGE_KEY);
    if (rawFonts) {
      const parsed = JSON.parse(rawFonts);
      if (typeof parsed.panelAnimationDurationMs === "number") {
        root.style.setProperty("--panel-animation-duration", `${parsed.panelAnimationDurationMs}ms`);
      }
      if (typeof parsed.fontSizeInterface === "number") {
        root.style.setProperty("--ui-font-size", `${parsed.fontSizeInterface}px`);
        root.style.setProperty("--font-size-interface", `${parsed.fontSizeInterface}px`);
      }
      if (typeof parsed.fontSizeCode === "number") {
        root.style.setProperty("--code-font-size", `${parsed.fontSizeCode}px`);
        root.style.setProperty("--font-size-code", `${parsed.fontSizeCode}px`);
      }
      if (parsed.fontSmoothing === false) {
        root.style.removeProperty("-webkit-font-smoothing");
      } else {
        root.style.setProperty("-webkit-font-smoothing", "antialiased");
      }
    }
  } catch {
    // Non-fatal
  }
}
