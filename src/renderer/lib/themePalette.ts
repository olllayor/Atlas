import {
  ATLAS_THEME,
  BUILT_IN_THEMES,
  STANDARD_THEME_CARDS,
  THEME_COLOR_ROLES,
  getThemeCardDefinition,
  getThemeColorsForAppearance,
  getThemeDefinition as getBaseThemeDefinition,
  type ThemeAppearance,
  type ThemeCardDefinition,
  type ThemeColorRole,
  type ThemeDefinition,
} from '../../shared/themePalettes';

/** CSS variable name mapped to each color role. */
export const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = {
  canvas: '--app-theme-canvas',
  chrome: '--app-theme-chrome',
  toolbar: '--app-theme-toolbar',
  toolbarForeground: '--app-theme-toolbar-foreground',
  toolbarBorder: '--app-theme-toolbar-border',
  toolbarControl: '--app-theme-toolbar-control',
  toolbarControlForeground: '--app-theme-toolbar-control-foreground',
  toolbarControlHover: '--app-theme-toolbar-control-hover',
  surface: '--app-theme-surface',
  surfaceRaised: '--app-theme-surface-raised',
  surfaceOverlay: '--app-theme-surface-overlay',
  text: '--app-theme-text',
  textMuted: '--app-theme-text-muted',
  border: '--app-theme-border',
  input: '--app-theme-input',
  focus: '--app-theme-focus',
  accent: '--app-theme-accent',
  accentForeground: '--app-theme-accent-foreground',
  secondary: '--app-theme-secondary',
  secondaryForeground: '--app-theme-secondary-foreground',
  muted: '--app-theme-muted',
  mutedForeground: '--app-theme-muted-foreground',
  placeholder: '--app-theme-placeholder',
  secondaryLabel: '--app-theme-secondary-label',
  iconMuted: '--app-theme-icon-muted',
  error: '--app-theme-error',
  errorForeground: '--app-theme-error-foreground',
  errorSurface: '--app-theme-error-surface',
  warning: '--app-theme-warning',
  warningForeground: '--app-theme-warning-foreground',
  warningSurface: '--app-theme-warning-surface',
  update: '--app-theme-update',
  updateForeground: '--app-theme-update-foreground',
  updateSurface: '--app-theme-update-surface',
  accentSurface: '--app-theme-accent-surface',
  accentSurfaceForeground: '--app-theme-accent-surface-foreground',
  messageSurface: '--app-theme-message-surface',
  messageForeground: '--app-theme-message-foreground',
  messageAction: '--app-theme-message-action',
  messageActionForeground: '--app-theme-message-action-foreground',
  messageActionHover: '--app-theme-message-action-hover',
  codeBackground: '--app-theme-code-background',
  codeForeground: '--app-theme-code-foreground',
  sidebar: '--app-theme-sidebar',
  sidebarForeground: '--app-theme-sidebar-foreground',
  sidebarMutedForeground: '--app-theme-sidebar-muted-foreground',
  sidebarControlSurface: '--app-theme-sidebar-control-surface',
  sidebarRowHover: '--app-theme-sidebar-row-hover',
  sidebarRowActive: '--app-theme-sidebar-row-active',
  sidebarRowSelected: '--app-theme-sidebar-row-selected',
  sidebarBorder: '--app-theme-sidebar-border',
  terminalBackground: '--app-theme-terminal-background',
  terminalForeground: '--app-theme-terminal-foreground',
  terminalCursor: '--app-theme-terminal-cursor',
  terminalSelection: '--app-theme-terminal-selection-background',
  terminalScrollbar: '--app-theme-terminal-scrollbar',
  terminalScrollbarHover: '--app-theme-terminal-scrollbar-hover',
};

export const CUSTOM_THEMES_STORAGE_KEY = 'atlas:custom-themes:v1';
const customThemesListeners = new Set<() => void>();

export function subscribeCustomThemes(callback: () => void): () => void {
  customThemesListeners.add(callback);
  return () => customThemesListeners.delete(callback);
}

function notifyCustomThemesChange(): void {
  for (const listener of customThemesListeners) {
    try {
      listener();
    } catch {
      // Non-fatal
    }
  }
}

export function getCustomThemes(): ThemeDefinition[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is ThemeDefinition => Boolean(item && item.id && item.colors));
    }
  } catch {
    // Ignore error
  }
  return [];
}

export function saveCustomTheme(theme: ThemeDefinition): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const current = getCustomThemes();
  const index = current.findIndex((t) => t.id === theme.id);
  const updated = index >= 0 ? [...current.slice(0, index), theme, ...current.slice(index + 1)] : [...current, theme];
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updated));
    notifyCustomThemesChange();
  } catch (err) {
    console.error('Failed to save custom theme:', err);
  }
}


export function removeCustomThemeCollection(collectionId: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const current = getCustomThemes();
  const updated = current.filter((t) => t.collection?.id !== collectionId);
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updated));
    notifyCustomThemesChange();
  } catch (err) {
    console.error("Failed to remove custom theme collection:", err);
  }
}

export function getVariantShortLabel(variantLabel: string, collectionLabel: string): string {
  const cleanVariant = variantLabel.trim();
  const cleanCollection = collectionLabel.trim();

  if (cleanVariant.toLowerCase() === cleanCollection.toLowerCase()) {
    const words = cleanVariant.split(/\s+/);
    return words[words.length - 1] || cleanVariant;
  }

  if (cleanVariant.toLowerCase().startsWith(cleanCollection.toLowerCase())) {
    const remainder = cleanVariant.slice(cleanCollection.length).trim();
    if (remainder) {
      return remainder.replace(/^[-_–—:]\s*/, "");
    }
  }

  const collWords = cleanCollection.toLowerCase().split(/\s+/);
  const variantWords = cleanVariant.split(/\s+/);
  const filtered = variantWords.filter((w) => !collWords.includes(w.toLowerCase()));
  if (filtered.length > 0) {
    return filtered.join(" ");
  }

  return cleanVariant;
}

export function removeCustomTheme(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const current = getCustomThemes();
  const updated = current.filter((t) => t.id !== id);
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updated));
    notifyCustomThemesChange();
  } catch (err) {
    console.error('Failed to remove custom theme:', err);
  }
}

export function downloadThemeFile(filename: string, content: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getThemeDefinition(id: string): ThemeDefinition | null {
  if (id === 'default' || id === 'atlas') return ATLAS_THEME;
  const base = getBaseThemeDefinition(id);
  if (base) return base;
  return getCustomThemes().find((t) => t.id === id) ?? null;
}

export function getAllThemeCards(): ReadonlyArray<ThemeCardDefinition> {
  const customCards = getCustomThemes().map(getThemeCardDefinition);
  return [...BUILT_IN_THEMES.map(getThemeCardDefinition), ...customCards];
}

export function resolveEffectiveTheme(
  themeId: string | null | undefined,
  appearance: ThemeAppearance,
  halves?: { light?: string | null; dark?: string | null } | null
): string {
  if (halves && halves[appearance]) {
    return halves[appearance]!;
  }
  return themeId && themeId.trim() ? themeId : 'default';
}

/**
 * Applies a theme palette to document.documentElement by stamping the 55
 * `--app-theme-*` CSS properties.
 */
export function applyThemePalette(
  themeId: string | null | undefined,
  appearance: ThemeAppearance
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root?.style || typeof root.style.setProperty !== 'function') return;

  const effectiveId = themeId && themeId.trim() ? themeId : 'default';
  const theme = getThemeDefinition(effectiveId) ?? ATLAS_THEME;

  const colors = getThemeColorsForAppearance(theme, appearance) ?? getThemeColorsForAppearance(ATLAS_THEME, appearance) ?? theme.colors;
  root.dataset.themeId = theme.id;

  for (const role of THEME_COLOR_ROLES) {
    const value = colors[role];
    if (value) {
      root.style.setProperty(APP_THEME_VARIABLES[role], value);
    }
  }
}

export function installCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  saveCustomTheme(theme);
  return theme;
}

export function updateCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  saveCustomTheme(theme);
  return theme;
}

export function getStoredCustomThemeCollection(collectionId: string): ThemeDefinition[] {
  return getCustomThemes().filter((t) => t.collection?.id === collectionId);
}

export function replaceCustomThemeCollection(
  collectionId: string,
  themes: readonly ThemeDefinition[],
  _options?: { expectedCollection?: readonly ThemeDefinition[] | null }
): readonly ThemeDefinition[] {
  if (typeof window === "undefined" || !window.localStorage) return themes;
  const current = getCustomThemes();
  const withoutOldCollection = current.filter((t) => t.collection?.id !== collectionId);
  const next = [...withoutOldCollection, ...themes];
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(next));
    notifyCustomThemesChange();
  } catch (err) {
    console.error("Failed to replace custom theme collection:", err);
  }
  return themes;
}
