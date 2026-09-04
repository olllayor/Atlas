/**
 * Typography and font preference utilities for Settings → Appearance.
 * Derived from modern desktop font enumeration and typography cascade.
 */

import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PANEL_ANIMATION_DURATION_MS,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "../../shared/contracts";

export const DEFAULT_SANS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export const DEFAULT_CODE_FONT_STACK =
  'ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

export const TYPOGRAPHY_ADVANCED_STORAGE_KEY = "atlas.typography.advanced";

function quoteFontFamilyName(name: string): string {
  const bare = name.trim();
  if (bare.length === 0) return "";
  if (/^(['"]).*\1$/.test(bare)) return bare;
  if (/^[a-zA-Z][a-zA-Z0-9 -]*$/.test(bare)) {
    return bare.includes(" ") ? `"${bare}"` : bare;
  }
  return `"${bare.replaceAll('"', "")}"`;
}

export function cssFontFamilies(input: string): string | null {
  const families = input
    .split(",")
    .map(quoteFontFamilyName)
    .filter((name) => name.length > 0);
  return families.length > 0 ? families.join(", ") : null;
}

let fontProbeContext: CanvasRenderingContext2D | null | undefined;

function probeWidth(font: string): number | null {
  if (fontProbeContext === undefined && typeof document !== "undefined") {
    fontProbeContext = document.createElement("canvas").getContext("2d");
  }
  if (!fontProbeContext) return null;
  fontProbeContext.font = `32px ${font}`;
  return fontProbeContext.measureText("AaBbCcDdEeFfGgHhIiJj0123456789").width;
}

export function isFontFamilyAvailable(family: string): boolean {
  if (typeof document === "undefined") return true;
  const families = cssFontFamilies(family);
  if (families === null) return false;
  if (/^(system-ui|sans-serif|serif|monospace|ui-monospace)$/i.test(families)) return true;
  try {
    for (const generic of ["monospace", "serif", "sans-serif"]) {
      const baseline = probeWidth(generic);
      const candidate = probeWidth(`${families}, ${generic}`);
      if (baseline === null || candidate === null) return false;
      if (candidate !== baseline) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const MONOSPACE_PROBE_VARIANTS = ["normal 400", "normal 700", "italic 400", "italic 700"] as const;
const MONOSPACE_PROBE_GLYPHS = ["i", "M", "W", "0", "@", "#", ".", " "] as const;
const MONOSPACE_ADVANCE_TOLERANCE = 0.01;

export function areFontAdvancesMonospace(advances: readonly number[]): boolean {
  const reference = advances[0];
  if (
    reference === undefined ||
    reference <= 0 ||
    advances.some((advance) => !Number.isFinite(advance) || advance <= 0)
  ) {
    return true;
  }
  return advances.every((advance) => Math.abs(advance - reference) < MONOSPACE_ADVANCE_TOLERANCE);
}

export function isMonospaceFamily(family: string): boolean {
  if (typeof document === "undefined") return true;
  const families = cssFontFamilies(family);
  if (families === null) return true;
  try {
    if (fontProbeContext === undefined) {
      fontProbeContext = document.createElement("canvas").getContext("2d");
    }
    if (fontProbeContext === null) return true;
    const context = fontProbeContext;
    for (const variant of MONOSPACE_PROBE_VARIANTS) {
      context.font = `${variant} 32px ${families}, monospace`;
      const advances = MONOSPACE_PROBE_GLYPHS.map((glyph) => context.measureText(glyph).width);
      if (!areFontAdvancesMonospace(advances)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

export interface AppearanceFontPreferences {
  readonly panelAnimationDurationMs?: number;
  readonly fontFamilySans?: string;
  readonly fontFamilyComposer?: string;
  readonly fontFamilyCode?: string;
  readonly fontFamilyTerminal?: string;
  readonly fontSizeInterface?: number;
  readonly fontSizePrompt?: number;
  readonly fontSizeCode?: number;
  readonly fontSizeTerminal?: number;
  readonly fontSmoothing?: boolean;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function applyAppearanceFontVariables(
  root: HTMLElement,
  preferences: AppearanceFontPreferences
): void {
  const duration = clampNumber(
    preferences.panelAnimationDurationMs ?? DEFAULT_PANEL_ANIMATION_DURATION_MS,
    MIN_PANEL_ANIMATION_DURATION_MS,
    MAX_PANEL_ANIMATION_DURATION_MS,
    DEFAULT_PANEL_ANIMATION_DURATION_MS
  );
  root.style.setProperty("--panel-animation-duration", `${duration}ms`);

  const families: ReadonlyArray<readonly [variable: string, custom: string | undefined, fallback: string]> = [
    ["--font-sans", preferences.fontFamilySans, DEFAULT_SANS_FONT_STACK],
    ["--font-ui-family", preferences.fontFamilySans, DEFAULT_SANS_FONT_STACK],
    ["--font-mono", preferences.fontFamilyCode, DEFAULT_CODE_FONT_STACK],
    ["--font-code-mono", preferences.fontFamilyCode, DEFAULT_CODE_FONT_STACK],
    ["--font-composer", preferences.fontFamilyComposer || preferences.fontFamilySans, "var(--font-sans)"],
    ["--font-terminal", preferences.fontFamilyTerminal || preferences.fontFamilyCode, "var(--font-mono)"],
  ];

  for (const [variable, custom, fallback] of families) {
    const list = custom ? cssFontFamilies(custom) : null;
    if (list === null) {
      root.style.removeProperty(variable);
    } else {
      root.style.setProperty(variable, `${list}, ${fallback}`);
    }
  }

  const interfaceSize = clampNumber(
    preferences.fontSizeInterface ?? DEFAULT_INTERFACE_FONT_SIZE,
    MIN_INTERFACE_FONT_SIZE,
    MAX_INTERFACE_FONT_SIZE,
    DEFAULT_INTERFACE_FONT_SIZE
  );
  root.style.setProperty("--ui-font-size", `${interfaceSize}px`);
  root.style.setProperty("--font-size-interface", `${interfaceSize}px`);

  const promptSize = clampNumber(
    preferences.fontSizePrompt ?? DEFAULT_PROMPT_FONT_SIZE,
    MIN_PROMPT_FONT_SIZE,
    MAX_PROMPT_FONT_SIZE,
    DEFAULT_PROMPT_FONT_SIZE
  );
  root.style.setProperty("--font-size-prompt", `${promptSize}px`);

  const codeSize = clampNumber(
    preferences.fontSizeCode ?? DEFAULT_CODE_FONT_SIZE,
    MIN_CODE_FONT_SIZE,
    MAX_CODE_FONT_SIZE,
    DEFAULT_CODE_FONT_SIZE
  );
  root.style.setProperty("--code-font-size", `${codeSize}px`);
  root.style.setProperty("--font-size-code", `${codeSize}px`);
  root.style.setProperty("--diffs-font-size", `${codeSize}px`);

  const terminalSize = clampNumber(
    preferences.fontSizeTerminal ?? DEFAULT_TERMINAL_FONT_SIZE,
    MIN_TERMINAL_FONT_SIZE,
    MAX_TERMINAL_FONT_SIZE,
    DEFAULT_TERMINAL_FONT_SIZE
  );
  root.style.setProperty("--font-size-terminal", `${terminalSize}px`);

  if (preferences.fontSmoothing !== false) {
    root.style.setProperty("-webkit-font-smoothing", "antialiased");
    root.style.setProperty("-moz-osx-font-smoothing", "grayscale");
  } else {
    root.style.removeProperty("-webkit-font-smoothing");
    root.style.removeProperty("-moz-osx-font-smoothing");
  }
}

export interface InstalledFontFamiliesResult {
  readonly families: readonly string[];
  readonly status: "granted" | "denied" | "unsupported";
}

let installedFamiliesCache: InstalledFontFamiliesResult | null = null;

export async function queryInstalledFontFamilies(): Promise<InstalledFontFamiliesResult> {
  if (installedFamiliesCache !== null) return installedFamiliesCache;
  const query = (
    typeof window !== "undefined"
      ? (window as Window & { queryLocalFonts?: () => Promise<ReadonlyArray<{ readonly family: string }>> }).queryLocalFonts
      : undefined
  );
  if (typeof query !== "function") {
    installedFamiliesCache = { families: [], status: "unsupported" };
    return installedFamiliesCache;
  }
  try {
    const fonts = await query.call(window);
    const families = [...new Set(fonts.map((font) => font.family))]
      .filter((family) => !family.startsWith("."))
      .sort((a, b) => a.localeCompare(b));
    if (families.length === 0) return { families: [], status: "denied" };
    installedFamiliesCache = { families, status: "granted" };
    return installedFamiliesCache;
  } catch {
    return { families: [], status: "denied" };
  }
}
