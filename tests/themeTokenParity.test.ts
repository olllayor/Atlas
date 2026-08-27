import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Mechanical guard for the theme token contract, born from two classes of
 * shipped bug:
 *
 * 1. Partial variant blocks — a light/dark block that forgets tokens its
 *    sibling defines (cursor dark once inherited near-black toast ink from
 *    its light sibling; codex light merged the composer into the page).
 * 2. Contrast regressions — token pairs that fail WCAG in one mode only
 *    (cursor's primary button was 1.07:1 in light and 1.34:1 in dark while
 *    every other mode passed).
 *
 * Both are checked here by parsing the stylesheets directly, so a new theme
 * file is covered the moment it lands.
 */

const THEME_DIR = 'src/renderer/themes';

type Block = { selector: string; tokens: Map<string, string> };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Top-level custom-property declarations of every `[data-…]` block. */
function parseBlocks(css: string): Block[] {
  const clean = stripComments(css);
  const blocks: Block[] = [];
  const re = /(^|\n)([^@{}\n]*\[data-[^\]]+\][^@{}\n]*)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    const selector = match[2].trim().replace(/\s+/g, ' ');
    const tokens = new Map<string, string>();
    for (const line of match[3].split('\n')) {
      const decl = line.trim().match(/^(--[\w-]+):\s*(.+?);?$/);
      if (decl) tokens.set(decl[1], decl[2].trim());
    }
    if (tokens.size > 0) blocks.push({ selector, tokens });
  }
  return blocks;
}

function parseRootContract(stylesCss: string): Map<string, string> {
  const clean = stripComments(stylesCss);
  const match = clean.match(/:root\s*\{([^}]*)\}/);
  assert.ok(match, 'styles.css :root contract not found');
  const tokens = new Map<string, string>();
  for (const line of match![1].split('\n')) {
    const decl = line.trim().match(/^(--[\w-]+):\s*(.+?);?$/);
    if (decl) tokens.set(decl[1], decl[2].trim());
  }
  return tokens;
}

const readTheme = (theme: string) => readFileSync(join(THEME_DIR, `${theme}.css`), 'utf8');

// ---------------------------------------------------------------------------
// 1. Variant completeness
// ---------------------------------------------------------------------------

/** Tokens that carry color; everything else (radii, fonts, motion) is mode-independent.
 *
 * Diff and tool hues are deliberately absent: they live in the :root
 * contract with values that double as the dark themes' own palettes, so
 * default/xai legitimately fall through to them. They cannot be silently
 * missing from a *variant* block though — the sibling-parity check in the
 * completeness test enforces that.
 */
const CORE_PREFIXES = [
  /^--bg-/,
  /^--border-(?!radius)/,
  /^--text-/,
  /^--success/,
  /^--warning/,
  /^--error/,
  /^--accent/,
  /^--ring$/,
  /^--toast-/,
  /^--overlay$/,
  /^--scrollbar/,
];

/*
 * The composer slab falls back to --bg-overlay inside :root, and themes are
 * allowed to lean on that fallback (cursor does). Terminal colors live in
 * styles.css, not in theme files.
 */
const OPTIONAL_TOKENS = new Set(['--bg-composer', '--border-composer']);

const requiredTokens = (root: Map<string, string>): string[] =>
  [...root.keys()].filter(
    (name) =>
      CORE_PREFIXES.some((re) => re.test(name)) &&
      !OPTIONAL_TOKENS.has(name) &&
      // The type scale (--text-xs … --text-3xl) rides the --text- prefix but
      // is typography, not color.
      !/^--text-(?:[23]xs|xs|sm|base|md|lg|xl|[23]xl)$/.test(name)
  );

test('every mode-defining theme block carries the full color-token contract', () => {
  const root = parseRootContract(readFileSync('src/renderer/styles.css', 'utf8'));
  const required = requiredTokens(root);
  assert.ok(required.length >= 40, `contract shrank unexpectedly: ${required.length} tokens`);

  for (const theme of ['codex', 'default', 'xai', 'cursor']) {
    const blocks = parseBlocks(readTheme(theme));

    for (const block of blocks) {
      const missing = required.filter((name) => !block.tokens.has(name));
      assert.deepEqual(
        missing,
        [],
        `${theme}.css [${block.selector}] is missing color tokens its mode needs: ${missing.join(', ')}. ` +
          'A variant block that leans on its dark/light sibling paints stale values whenever that sibling was authored for the other mode.'
      );
    }

    // Sibling parity for the satellite palettes: if any block in this file
    // defines diff or tool hues, every block must (they tune them per mode).
    const satellite = [...blocks].flatMap((b) => [...b.tokens.keys()]).filter(
      (name) => /^--diff-/.test(name) || /^--tool-/.test(name)
    );
    for (const block of blocks) {
      const missing = satellite.filter((name) => !block.tokens.has(name));
      assert.deepEqual(
        missing,
        [],
        `${theme}.css [${block.selector}] omits satellite tokens a sibling defines: ${missing.join(', ')}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 2. WCAG contrast on canonical token pairs
// ---------------------------------------------------------------------------

type Rgba = { rgb: [number, number, number]; a: number };

function parseColor(value: string): Rgba | null {
  let m = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (m) return { rgb: [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number], a: 1 };
  m = value.trim().match(/^#([0-9a-f]{3})$/i);
  if (m)
    return {
      rgb: [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number],
      a: 1,
    };
  m = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return { rgb: parts.slice(0, 3) as [number, number, number], a: parts.length > 3 ? parts[3] : 1 };
  }
  // var(), color-mix(), … — unresolvable without an engine.
  return null;
}

const toHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Source-over compositing of `top` onto an opaque sRGB bottom layer. */
const over = (top: Rgba, bottomRgb: [number, number, number]): [number, number, number] =>
  top.rgb.map((v, i) => top.a * v + (1 - top.a) * bottomRgb[i]) as [number, number, number];

function luminance(hex: string): number {
  const channel = (raw: string) => {
    const value = parseInt(raw, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7))
  );
}

function contrast(aHex: string, bHex: string): number {
  const [l1, l2] = [luminance(aHex), luminance(bHex)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Which selector carries each mode's palette, per theme file. */
const MODE_BLOCKS: Record<string, { light?: string; dark: string }> = {
  codex: { dark: "[data-design-theme='codex']", light: "[data-theme='light'][data-design-theme='codex']" },
  cursor: { light: "[data-design-theme='cursor']", dark: "[data-theme='dark'][data-design-theme='cursor']" },
  default: { dark: "[data-design-theme='default']" },
  xai: { dark: "[data-design-theme='xai']" },
};

/*
 * Pairings measured against their own painted surface. Alpha values are
 * composited onto the pair's background (which may itself composite onto
 * --bg-base). Thresholds: 4.5 for text, 3 for non-text UI.
 */
const CONTRAST_PAIRS: Array<{ fg: string; bg: string; min: number }> = [
  { fg: '--text-primary', bg: '--bg-base', min: 4.5 },
  { fg: '--text-muted', bg: '--bg-base', min: 4.5 },
  { fg: '--text-faint', bg: '--bg-base', min: 3 },
  { fg: '--text-inverse', bg: '--bg-button', min: 4.5 },
  { fg: '--accent-text', bg: '--accent', min: 4.5 },
  // Chip text on accent-tinted surfaces (file-ref badges, gallery chips).
  { fg: '--accent-strong', bg: '--accent-surface', min: 4.5 },
  // Fill/border-vs-tint separation only — text there reads --accent-strong.
  { fg: '--accent', bg: '--accent-surface', min: 3 },
];

/*
 * Known, documented shortfalls. Every entry must name the reason and the
 * follow-up; delete the entry when the fix lands.
 */
const EXEMPTIONS: Array<{ theme: string; mode: string; fg: string; bg: string; ratio: number; why: string }> = [
  {
    theme: 'cursor',
    mode: 'light',
    fg: '--accent',
    bg: '--accent-surface',
    ratio: 2.69,
    why: 'Orange fill/border on its own tint. Text no longer paints with --accent here (chips use --accent-strong), so this only bounds decorative separation.',
  },
];

test('canonical token pairs clear WCAG in every theme and mode', () => {
  const root = parseRootContract(readFileSync('src/renderer/styles.css', 'utf8'));

  for (const [theme, modes] of Object.entries(MODE_BLOCKS)) {
    const blocks = parseBlocks(readTheme(theme));
    const resolve = (mode: keyof typeof modes) => {
      const primary = blocks.find((b) => b.selector === modes[mode]);
      assert.ok(primary, `${theme}.css: block for ${mode} ('${modes[mode]}') not found`);
      const siblings = blocks.filter((b) => b !== primary);
      return (token: string): string | null => {
        const own = primary!.tokens.get(token);
        if (own && !own.startsWith('var(')) return own;
        if (own?.startsWith('var(')) {
          const ref = own.slice(4, -1).trim();
          return siblings.find((s) => s.tokens.get(ref))?.tokens.get(ref) ?? root.get(token) ?? null;
        }
        return siblings.find((s) => s.tokens.get(token))?.tokens.get(token) ?? root.get(token) ?? null;
      };
    };

    for (const mode of Object.keys(modes) as Array<keyof typeof modes>) {
      const get = resolve(mode);

      for (const pair of CONTRAST_PAIRS) {
        const exempt = EXEMPTIONS.find(
          (e) => e.theme === theme && e.mode === mode && e.fg === pair.fg && e.bg === pair.bg
        );

        const fgRaw = get(pair.fg);
        const bgRaw = get(pair.bg);
        assert.ok(fgRaw && bgRaw, `${theme}/${mode}: cannot resolve ${pair.fg} or ${pair.bg}`);

        const fg = parseColor(fgRaw!);
        let bg = parseColor(bgRaw!);
        assert.ok(fg && bg, `${theme}/${mode}: ${pair.fg}/'${fgRaw}' or ${pair.bg}/'${bgRaw}' is not a plain color`);

        // An alpha background sits on --bg-base; then alpha foreground on that.
        let bgHex: string;
        if (bg!.a < 1) {
          const canvasRaw = get('--bg-base');
          const canvas = canvasRaw ? parseColor(canvasRaw) : null;
          assert.ok(canvas && canvas!.a === 1, `${theme}/${mode}: --bg-base must be opaque`);
          bgHex = toHex(over(bg!, canvas!.rgb));
          bg = parseColor(bgHex)!;
        } else {
          bgHex = toHex(bg!.rgb);
        }
        const fgHex = fg!.a < 1 ? toHex(over(fg!, bg!.rgb)) : bgHex === '' ? '' : toHex(fg!.rgb);

        const actual = contrast(fgHex!, bgHex);

        if (exempt) {
          assert.ok(
            Math.abs(actual - exempt.ratio) < 0.15,
            `${theme}/${mode} ${pair.fg} on ${pair.bg}: exemption says ${exempt.ratio}, measured ${actual.toFixed(2)}. Update or drop the exemption entry.`
          );
          continue;
        }

        assert.ok(
          actual >= pair.min,
          `${theme}/${mode}: ${pair.fg} (${fgHex}) on ${pair.bg} (${bgHex}) is ${actual.toFixed(2)}:1, needs ${pair.min}:1`
        );
      }
    }
  }
});
