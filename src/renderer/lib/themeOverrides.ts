import type { SettingsAppearanceSummary } from '../../shared/contracts';
import { CONTRAST_DEFAULT, normalizeThemeColor } from '../../shared/contracts';

/**
 * User color overrides ride on top of whichever design theme is active: the
 * theme CSS keeps its full token contract, and this module emits only the
 * inline custom properties needed to retint it. Derivations mirror how the
 * codex theme is authored — secondary text is an opacity of the foreground,
 * elevation is a foreground tint over the background, borders are hairlines
 * of the foreground — so a themed component cannot tell an override from an
 * authored value.
 */

export type ThemeOverrideInput = Pick<
  SettingsAppearanceSummary,
  'accentColor' | 'backgroundColor' | 'foregroundColor' | 'contrast'
>;

/** 50 → 1.0; the slider scales every derived opacity between 0.6× and 1.4×. */
export function contrastFactor(contrast: number): number {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(contrast) ? contrast : CONTRAST_DEFAULT));
  return 0.6 + (clamped / 100) * 0.8;
}

function relativeLuminance(hex: string): number {
  const channel = (raw: string) => {
    const value = parseInt(raw, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7))
  );
}

const pct = (base: number, factor: number) => `${Math.min(100, Math.round(base * factor * 10) / 10)}%`;

export function buildThemeOverrides(input: ThemeOverrideInput): Record<string, string> {
  const accent = normalizeThemeColor(input.accentColor);
  const background = normalizeThemeColor(input.backgroundColor);
  const foreground = normalizeThemeColor(input.foregroundColor);
  const factor = contrastFactor(input.contrast);

  const overrides: Record<string, string> = {};

  if (background) {
    const isLight = relativeLuminance(background) > 0.4;
    const towardFg = foreground ?? (isLight ? '#000000' : '#ffffff');
    overrides['--bg-base'] = background;
    // Dark themes push the sidebar toward black (codex ships it pure black);
    // a light background only gets a whisper of the same treatment.
    overrides['--bg-panel'] = `color-mix(in srgb, ${background} ${isLight ? 96 : 72}%, black)`;
    overrides['--bg-composer'] = `color-mix(in srgb, ${background} 90%, ${towardFg})`;
    overrides['--bg-overlay'] = `color-mix(in srgb, ${background} 86%, ${towardFg})`;
    overrides['--toast-bg'] = overrides['--bg-overlay'];
  }

  if (foreground) {
    overrides['--text-primary'] = foreground;
    overrides['--text-inverse'] = relativeLuminance(foreground) > 0.4 ? '#0d0d0d' : '#ffffff';
    overrides['--bg-button'] = foreground;
    overrides['--bg-button-hover'] = `color-mix(in oklab, ${foreground} 85%, ${overrides['--text-inverse']})`;
  }

  // The tint/opacity ladder re-derives whenever a color that feeds it changes
  // OR the user moved the contrast slider away from neutral.
  const fg = foreground ?? (background ? (relativeLuminance(background) > 0.4 ? '#000000' : '#ffffff') : null);
  if (fg) {
    applyForegroundLadder(overrides, fg, factor);
  } else if (factor !== 1) {
    // Contrast alone: scale the ladder around the theme's authored foreground.
    applyForegroundLadder(overrides, 'var(--text-primary)', factor);
  }

  if (accent) {
    const accentText = relativeLuminance(accent) > 0.4 ? '#0d0d0d' : '#ffffff';
    overrides['--accent'] = accent;
    overrides['--accent-hover'] = `color-mix(in oklab, ${accent} 85%, ${accentText === '#0d0d0d' ? '#000000' : '#ffffff'})`;
    overrides['--accent-text'] = accentText;
    overrides['--accent-surface'] = `color-mix(in oklab, ${accent} 22%, var(--bg-base))`;
    overrides['--ring'] = `color-mix(in srgb, ${accent} 76%, transparent)`;
  }

  return overrides;
}

function applyForegroundLadder(overrides: Record<string, string>, source: string, factor: number) {
  overrides['--text-secondary'] = `color-mix(in srgb, ${source} ${pct(78, factor)}, transparent)`;
  overrides['--text-tertiary'] = `color-mix(in srgb, ${source} ${pct(50, factor)}, transparent)`;
  overrides['--text-muted'] = overrides['--text-tertiary'];
  overrides['--text-faint'] = `color-mix(in srgb, ${source} ${pct(40, factor)}, transparent)`;

  overrides['--bg-surface'] = `color-mix(in oklab, ${source} ${pct(5, factor)}, transparent)`;
  overrides['--bg-subtle'] = overrides['--bg-surface'];
  overrides['--bg-ghost'] = `color-mix(in oklab, ${source} ${pct(4, factor)}, transparent)`;
  overrides['--bg-hover'] = `color-mix(in oklab, ${source} ${pct(8, factor)}, transparent)`;
  overrides['--bg-elevated'] = overrides['--bg-hover'];
  overrides['--bg-active'] = `color-mix(in oklab, ${source} ${pct(12, factor)}, transparent)`;
  overrides['--bg-code'] = `color-mix(in srgb, ${source} ${pct(10, factor)}, transparent)`;

  overrides['--border-subtle'] = `color-mix(in srgb, ${source} ${pct(5.5, factor)}, transparent)`;
  overrides['--border-default'] = `color-mix(in srgb, ${source} ${pct(8.2, factor)}, transparent)`;
  overrides['--border-medium'] = `color-mix(in srgb, ${source} ${pct(12, factor)}, transparent)`;
  overrides['--border-strong'] = `color-mix(in srgb, ${source} ${pct(22, factor)}, transparent)`;
}

/** Serialized form used by "Copy theme" / "Import" — a plain JSON contract. */
export type ThemeExport = {
  accentColor: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  contrast: number;
  uiFontFamily: string | null;
  codeFontFamily: string | null;
};

export function exportTheme(appearance: SettingsAppearanceSummary): ThemeExport {
  return {
    accentColor: appearance.accentColor,
    backgroundColor: appearance.backgroundColor,
    foregroundColor: appearance.foregroundColor,
    contrast: appearance.contrast,
    uiFontFamily: appearance.uiFontFamily,
    codeFontFamily: appearance.codeFontFamily
  };
}

/**
 * Parses pasted theme JSON; returns null when nothing usable is present.
 *
 * `translucentSidebar` is deliberately outside this contract: it is a window
 * material for one platform, not a theme colour, and a pasted JSON used to be
 * able to flip it (and live-apply vibrancy) as a side effect of importing.
 */
export function parseThemeImport(raw: string): Partial<ThemeExport> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const source = parsed as Record<string, unknown>;
  const result: Partial<ThemeExport> = {};

  for (const key of ['accentColor', 'backgroundColor', 'foregroundColor'] as const) {
    if (key in source) {
      result[key] = normalizeThemeColor(source[key]);
    }
  }

  if (typeof source.contrast === 'number' && Number.isFinite(source.contrast)) {
    result.contrast = Math.min(100, Math.max(0, Math.round(source.contrast)));
  }

  for (const key of ['uiFontFamily', 'codeFontFamily'] as const) {
    if (typeof source[key] === 'string' && (source[key] as string).trim()) {
      result[key] = (source[key] as string).trim();
    } else if (source[key] === null) {
      result[key] = null;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
