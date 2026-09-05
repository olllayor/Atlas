import type { DesignTheme, ThemeColorOverride, ThemeMode } from '../../shared/contracts';

/*
 * Pure window-chrome resolvers (no Electron imports, so node tests can cover
 * them). Main has no CSS, so the native frame needs its own copy of each
 * design theme's --bg-base; a custom backgroundColor override wins over all.
 */
const DESIGN_THEME_BASE: Record<DesignTheme, { light: string; dark: string }> = {
  atlas: { light: '#fcfcfc', dark: '#09090b' },
  default: { light: '#ffffff', dark: '#07080b' },
  codex: { light: '#ffffff', dark: '#181818' },
  cursor: { light: '#f2f1ed', dark: '#26251e' },
  xai: { light: '#ffffff', dark: '#1f2228' },
};

export type WindowChromeState = {
  themeMode: ThemeMode;
  designTheme: DesignTheme;
  backgroundColor: ThemeColorOverride;
  foregroundColor: ThemeColorOverride;
  translucentSidebar: boolean;
};

export function resolveChromeMode(themeMode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  return systemDark ? 'dark' : 'light';
}

export function resolveChromeBackground(
  state: Pick<WindowChromeState, 'themeMode' | 'designTheme' | 'backgroundColor'>,
  systemDark = false
): string {
  if (state.backgroundColor) return state.backgroundColor;
  const mode = resolveChromeMode(state.themeMode, systemDark);
  return DESIGN_THEME_BASE[state.designTheme]?.[mode] ?? '#060709';
}

export function resolveChromeSymbolColor(state: WindowChromeState, systemDark = false): string {
  if (state.foregroundColor) return state.foregroundColor;
  return resolveChromeMode(state.themeMode, systemDark) === 'light' ? '#4b5563' : '#9aa3b2';
}

/** Dedupe key: identical states must not touch the native frame twice. */
export function chromeStateSignature(state: WindowChromeState, systemDark = false): string {
  return [
    state.themeMode,
    state.themeMode === 'system' ? (systemDark ? 'dark' : 'light') : '',
    state.designTheme,
    state.backgroundColor ?? '',
    state.foregroundColor ?? '',
    state.translucentSidebar ? 'vibrant' : 'opaque',
    process.platform,
  ].join('|');
}
