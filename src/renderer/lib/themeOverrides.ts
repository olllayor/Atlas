import type { SettingsAppearanceSummary } from '../../shared/contracts';
import { CONTRAST_DEFAULT, CONTRAST_MAX, CONTRAST_MIN, normalizeThemeColor } from '../../shared/contracts';

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
  const clamped = Math.min(CONTRAST_MAX, Math.max(CONTRAST_MIN, Number.isFinite(contrast) ? contrast : CONTRAST_DEFAULT));
  return 0.6 + (clamped / 100) * 0.8;
}

/*
 * Contrast as CSS variables (t3code method): the slider stamps three numbers
 * and every derivation reacts live — theme switches included, with no rebuild.
 * 50 is neutral (base 100%, no boost). Below fades derivations toward
 * transparent; above pushes text toward --contrast-target (white in dark mode,
 * black in light, flipped in CSS per data-theme) and borders toward the
 * foreground at a quarter rate. Border boost stays gentle: hairlines go muddy
 * long before text does.
 */
export function contrastVars(contrast: number): { base: string; boost: string; borderBoost: string } {
  const clamped = Math.min(CONTRAST_MAX, Math.max(CONTRAST_MIN, Number.isFinite(contrast) ? contrast : CONTRAST_DEFAULT));
  let base: number;
  let boost: number;
  let borderBoost: number;

  if (clamped <= 50) {
    base = clamped * 2;
    boost = 0;
    borderBoost = 0;
  } else if (clamped <= 100) {
    base = 100;
    boost = (clamped - 50) * 2;
    borderBoost = boost / 4;
  } else {
    base = Math.max(0, 100 - (clamped - 100));
    boost = 100;
    borderBoost = Math.min(100, 25 + (clamped - 100) * 0.75);
  }

  const round = (value: number) => `${Math.round(value * 10) / 10}%`;
  return { base: round(base), boost: round(boost), borderBoost: round(borderBoost) };
}

/** Stamps the three contrast numbers App.tsx owns; the target flips in CSS. */
export function applyAppearanceContrast(root: HTMLElement, contrast: number): void {
  const vars = contrastVars(contrast);
  root.style.setProperty('--contrast-base', vars.base);
  root.style.setProperty('--contrast-boost', vars.boost);
  root.style.setProperty('--contrast-border-boost', vars.borderBoost);
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

  /*
   * The foreground participates even when only a background was picked.
   * A background-only override used to leave --text-primary, --bg-button
   * and --text-inverse at their authored (dark-theme) values while the
   * ladder below derived from black — white body copy on a white page.
   */
  const bgIsLight = background !== null && relativeLuminance(background) > 0.4;
  const derivedFg = background === null ? null : bgIsLight ? '#000000' : '#ffffff';
  const fg = foreground ?? derivedFg;

  if (background) {
    const towardFg = fg ?? (bgIsLight ? '#000000' : '#ffffff');
    overrides['--bg-base'] = background;
    // Dark themes push the sidebar toward black (codex ships it pure black);
    // a light background only gets a whisper of the same treatment.
    overrides['--bg-panel'] = `color-mix(in srgb, ${background} ${bgIsLight ? 96 : 72}%, black)`;
    overrides['--bg-composer'] = `color-mix(in srgb, ${background} 90%, ${towardFg})`;
    overrides['--bg-overlay'] = `color-mix(in srgb, ${background} 86%, ${towardFg})`;
    overrides['--toast-bg'] = overrides['--bg-overlay'];
  }

  if (fg) {
    overrides['--text-primary'] = fg;
    overrides['--text-inverse'] = relativeLuminance(fg) > 0.4 ? '#0d0d0d' : '#ffffff';
    overrides['--bg-button'] = fg;
    overrides['--bg-button-hover'] = `color-mix(in oklab, ${fg} 85%, ${overrides['--text-inverse']})`;
  }

  // The tint/opacity ladder re-derives whenever a color that feeds it changes
  // OR the user moved the contrast slider away from neutral.
  if (fg) {
    applyForegroundLadder(overrides, fg);
  } else if (factor !== 1) {
    // Contrast alone: scale the ladder around the theme's authored foreground.
    applyForegroundLadder(overrides, 'var(--text-primary)');
  }

  if (accent) {
    const accentText = relativeLuminance(accent) > 0.4 ? '#0d0d0d' : '#ffffff';
    overrides['--accent'] = accent;
    overrides['--accent-hover'] = `color-mix(in oklab, ${accent} 85%, ${accentText === '#0d0d0d' ? '#000000' : '#ffffff'})`;
    overrides['--accent-text'] = accentText;
    overrides['--accent-surface'] = `color-mix(in oklab, ${accent} 22%, var(--bg-base))`;
    overrides['--ring'] = `color-mix(in srgb, ${accent} 76%, transparent)`;
  }

  // A light background dropped onto a dark-authored theme strands every
  // satellite palette that was tuned for dark surfaces: pastel semantic
  // text, near-black diff slabs, blue-grey toast ink on a light overlay,
  // and a terminal whose ANSI colors only read on black. Re-derive those
  // for light; dark backgrounds keep the authored values, which are
  // already correct there.
  if (background !== null && bgIsLight && fg) {
    applyLightAdaptation(overrides, factor);
  }

  return overrides;
}

function applyForegroundLadder(overrides: Record<string, string>, source: string) {
  /*
   * Twin formulas, not baked opacities: each token blends its authored alpha
   * first, then answers the stamped contrast numbers live. Neutral (base 100%,
   * boost 0%) resolves to exactly the authored value, so theme switches need
   * no rebuild. Text pushes toward --contrast-target past neutral; borders
   * push toward the foreground at the gentler border-boost rate; elevation
   * only fades, never inverts.
   */
  const text = (alpha: number) =>
    `color-mix(in oklab, color-mix(in srgb, ${source} ${alpha}%, transparent) var(--contrast-base), var(--contrast-target) var(--contrast-boost))`;
  const border = (alpha: number) =>
    `color-mix(in srgb, color-mix(in srgb, ${source} ${alpha}%, transparent) var(--contrast-base), ${source} var(--contrast-border-boost))`;
  const elevation = (alpha: number) =>
    `color-mix(in oklab, color-mix(in oklab, ${source} ${alpha}%, transparent) var(--contrast-base), transparent)`;

  overrides['--text-secondary'] = text(78);
  overrides['--text-tertiary'] = text(50);
  overrides['--text-muted'] = overrides['--text-tertiary'];
  overrides['--text-faint'] = text(40);

  overrides['--bg-surface'] = elevation(5);
  overrides['--bg-subtle'] = overrides['--bg-surface'];
  overrides['--bg-ghost'] = elevation(4);
  overrides['--bg-hover'] = elevation(8);
  overrides['--bg-elevated'] = overrides['--bg-hover'];
  overrides['--bg-active'] = elevation(12);
  overrides['--bg-code'] = `color-mix(in srgb, color-mix(in srgb, ${source} 10%, transparent) var(--contrast-base), transparent)`;

  overrides['--border-subtle'] = border(5.5);
  overrides['--border-default'] = border(8.2);
  overrides['--border-medium'] = border(12);
  overrides['--border-strong'] = border(22);
}

/*
 * Semantic `-text` variants, re-derived for a light background.
 *
 * Themes author these as bright pastels (#a7f3d0, #fde68a, #fecdd3) that
 * only read on dark surfaces. Rather than hardcoding per-theme light
 * variants, each base hue is pulled down in OKLab until it clears WCAG AA
 * on white. The kept-percentage below is the worst case across every
 * shipped dark palette (default #34d399/#fbbf24/#fb7185 and codex's
 * #5dc977/#ff8549), with margin for off-white backgrounds. Referencing
 * var(--success) keeps the mix live: switching design themes re-resolves
 * against the new base without re-running this module.
 */
const LIGHT_SEMANTIC_KEPT: Record<string, number> = {
  '--success-text': 0.62,
  '--warning-text': 0.62,
  '--error-text': 0.76,
};

/*
 * Toast ink follows the foreground ladder — the same opacities codex's
 * light block authors (border 8.2%, text 78%, icon 50%, close 32%/78%).
 */
function applyLightAdaptation(overrides: Record<string, string>, factor: number): void {
  const fg = overrides['--text-primary'] ?? '#000000';

  for (const [token, kept] of Object.entries(LIGHT_SEMANTIC_KEPT)) {
    const base = token.replace('-text', '');
    overrides[token] = `color-mix(in oklab, var(${base}) ${Math.round(kept * 100)}%, black)`;
  }

  overrides['--toast-border'] = `color-mix(in srgb, ${fg} ${pct(8.2, factor)}, transparent)`;
  overrides['--toast-text'] = `color-mix(in srgb, ${fg} ${pct(78, factor)}, transparent)`;
  overrides['--toast-icon'] = `color-mix(in srgb, ${fg} ${pct(50, factor)}, transparent)`;
  overrides['--toast-close'] = `color-mix(in srgb, ${fg} 32%, transparent)`;
  overrides['--toast-close-hover'] = `color-mix(in srgb, ${fg} 78%, transparent)`;

  /*
   * Diffs: GitHub's light palette, the same one codex.css and cursor.css
   * author for their light modes. Foreground colors are literal readable
   * greens/reds rather than the themes' `inherit` so the values survive
   * as inline custom properties.
   */
  overrides['--diff-add-bg'] = '#dafbe1';
  overrides['--diff-del-bg'] = '#ffebe9';
  overrides['--diff-add-fg'] = '#1a7f37';
  overrides['--diff-del-fg'] = '#cf222e';
  overrides['--diff-add-gutter-bg'] = '#aceebb';
  overrides['--diff-del-gutter-bg'] = '#ffcecb';
  overrides['--diff-gutter-fg'] = '#1f2328';
  overrides['--diff-add-fg-count'] = '#1f8a65';
  overrides['--diff-del-fg-count'] = '#d1242f';

  /*
   * Terminal ANSI: verbatim copy of the [data-theme='light'] block in
   * styles.css (GitHub light values). That block never matches here — the
   * app stays data-theme='dark' under a background override — but xterm
   * reads --term-* through TerminalPanel regardless of mode, and the
   * dark-tuned defaults turn to pastel mush on a light --term-bg. Keep
   * the two lists in sync.
   */
  overrides['--term-selection'] = 'rgba(0, 0, 0, 0.16)';
  overrides['--term-selection-inactive'] = 'rgba(0, 0, 0, 0.08)';
  overrides['--term-black'] = '#24292f';
  overrides['--term-red'] = '#cf222e';
  overrides['--term-green'] = '#1a7f37';
  overrides['--term-yellow'] = '#9a6700';
  overrides['--term-blue'] = '#0969da';
  overrides['--term-magenta'] = '#8250df';
  overrides['--term-cyan'] = '#1b7c83';
  overrides['--term-white'] = '#6e7781';
  overrides['--term-bright-black'] = '#57606a';
  overrides['--term-bright-red'] = '#a40e26';
  overrides['--term-bright-green'] = '#116329';
  overrides['--term-bright-yellow'] = '#7d4e00';
  overrides['--term-bright-blue'] = '#0550ae';
  overrides['--term-bright-magenta'] = '#6639ba';
  overrides['--term-bright-cyan'] = '#1b7c83';
  overrides['--term-bright-white'] = '#24292f';
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
    result.contrast = Math.min(CONTRAST_MAX, Math.max(CONTRAST_MIN, Math.round(source.contrast)));
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
