import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Mechanical enforcement of the theme contract in `src/renderer/styles.css`.
 *
 * This repo has no ESLint, Biome or Stylelint — its conventions are enforced by
 * source-scanning cases in this suite (see `toastConfig.test.ts` for the same
 * shape). That is also how the system this theme layer is modelled on does it:
 * OpenAI's Codex bans raw colour constructors in `clippy.toml` and regex-scans
 * its own tree from a unit test, and in both cases the rationale lives in the
 * failure message rather than in a doc nobody opens.
 *
 * The rule here is narrow: a colour written into a component is a colour the
 * user's theme cannot reach. Every design theme (`themes/*.css`) redefines the
 * contract variables; a literal `text-white` or `bg-zinc-400` silently opts that
 * element out of all of them, which is invisible in the dark theme it was
 * written against and broken in the light one.
 *
 * ESCAPE HATCH
 * Write `design-tokens-allow: <reason>` in a comment on the offending line or
 * within the five lines above it. Reserve it for surfaces that genuinely must
 * not follow the theme — user-authored content, media scrims — and say which.
 */

const RENDERER_ROOT = 'src/renderer';

/** How many lines above a violation an allow-marker may sit (multi-line JSX). */
const ALLOW_LOOKBEHIND = 5;

const ALLOW_MARKER = /design-tokens-allow/;

const TAILWIND_PALETTES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose'
].join('|');

const COLOR_UTILITIES = [
  'text',
  'bg',
  'border',
  'ring',
  'fill',
  'stroke',
  'from',
  'to',
  'via',
  'decoration',
  'outline',
  'shadow',
  'accent',
  'caret',
  'divide',
  'placeholder'
].join('|');

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly why: string;
}

const RULES: readonly Rule[] = [
  {
    name: 'raw-tailwind-palette',
    pattern: new RegExp(
      `(?<![-\\w])(?:${COLOR_UTILITIES})-(?:${TAILWIND_PALETTES})-(?:50|[1-9]00|950)(?![-\\w])`,
      'g'
    ),
    why:
      'Tailwind palette colours are fixed and bypass the theme contract, so this element keeps ' +
      'the same colour in all five design themes and in both light and dark. Use a contract token ' +
      'instead: text-text-primary / -secondary / -tertiary / -muted / -faint for type; ' +
      'bg-bg-base / -panel / -surface / -elevated / -overlay / -subtle / -ghost / -hover / -active ' +
      'for fills; border-border-subtle / -default / -medium / -strong for rules; and ' +
      'text-success / -warning / -error (plus their -bg / -border / -text variants) for status. ' +
      'The full list is the @theme block in src/renderer/styles.css.'
  },
  {
    name: 'literal-black-and-white',
    pattern: /(?<![-\w])(?:text|bg|border|ring|fill|stroke|divide|placeholder)-(?:white|black)(?:\/\d+)?(?![-\w])/g,
    why:
      'Literal white and black do not invert with the theme: text-white is invisible on the codex ' +
      'light theme and bg-black is invisible on the dark ones. Use text-text-primary for the ' +
      'strongest type and text-text-inverse for type on a filled button; use bg-bg-base / ' +
      'bg-bg-panel for surfaces and bg-[var(--overlay)] for a dialog scrim. If the surface really ' +
      'must ignore the theme (user-authored content, a media scrim), keep the literal and add a ' +
      'design-tokens-allow comment saying why.'
  },
  {
    name: 'arbitrary-color-value',
    pattern: new RegExp(
      `(?<![-\\w])(?:${COLOR_UTILITIES})-\\[\\s*(?:#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\(|lab\\(|lch\\(|color\\()`,
      'g'
    ),
    why:
      'A hex or colour-function literal in a className is a hard-coded colour with no theme, no ' +
      'light variant and no contrast guarantee. If a contract token already carries this colour, ' +
      'use its utility (text-text-muted, bg-bg-elevated, …). If none does, add the token to ' +
      ':root in src/renderer/styles.css, give every theme in src/renderer/themes/ a value for it, ' +
      'map it in the @theme block, and reference it as -[var(--your-token)] — the arbitrary-value ' +
      'syntax is fine as long as what is inside the brackets is a variable, not a colour.'
  }
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });

const isAllowed = (lines: readonly string[], index: number): boolean => {
  const start = Math.max(0, index - ALLOW_LOOKBEHIND);
  return lines.slice(start, index + 1).some((line) => ALLOW_MARKER.test(line));
};

for (const rule of RULES) {
  test(`design tokens: no ${rule.name} in ${RENDERER_ROOT}`, () => {
    const offenders: string[] = [];

    for (const file of walk(RENDERER_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');

      lines.forEach((line, index) => {
        rule.pattern.lastIndex = 0;
        const found = line.match(rule.pattern);
        if (!found || isAllowed(lines, index)) return;
        for (const hit of found) {
          offenders.push(`${file}:${index + 1}  ${hit.trim()}`);
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `\n\n${rule.why}\n\nOffending sites:\n  ${offenders.join('\n  ')}\n`
    );
  });
}

/**
 * The radius ramp is a transcription, not a preference.
 *
 * `themes/codex.css` mirrors the `--radius-*` scale published in
 * `@openai/apps-sdk-ui`'s semantic.css. It was previously reverse-engineered
 * from screenshots (7.5 / 10 / 12.5 / 12.5 / 20px) and matched no step of the
 * real scale, which is exactly the kind of drift a comment does not prevent.
 */
test('design tokens: codex radius ramp matches the published OpenAI scale', () => {
  const source = readFileSync(join(RENDERER_ROOT, 'themes/codex.css'), 'utf8');

  const expected: ReadonlyArray<readonly [string, string]> = [
    ['2xs', '2px'],
    ['xs', '4px'],
    ['sm', '6px'],
    ['md', '8px'],
    ['lg', '10px'],
    ['xl', '12px'],
    ['2xl', '16px'],
    ['3xl', '20px'],
    ['4xl', '24px']
  ];

  for (const [step, value] of expected) {
    const declaration = new RegExp(`--radius-${step}:\\s*([^;]+);`);
    const match = source.match(declaration);
    assert.ok(match, `--radius-${step} is missing from themes/codex.css`);
    assert.equal(
      match[1].trim(),
      value,
      `--radius-${step} must be ${value} to match OpenAI's published scale`
    );
  }
});

/**
 * Every step the contract offers must exist in every theme that overrides any
 * of them, or a theme silently inherits a rounded default for the steps it
 * forgot — which is how the square themes grow rounded corners.
 */
test('design tokens: themes that override the radius ramp override all of it', () => {
  const themesDir = join(RENDERER_ROOT, 'themes');
  const steps = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'];

  const gaps: string[] = [];

  for (const entry of readdirSync(themesDir)) {
    if (!entry.endsWith('.css')) continue;
    const source = readFileSync(join(themesDir, entry), 'utf8');
    const declared = steps.filter((step) =>
      new RegExp(`--radius-${step}:`).test(source)
    );
    if (declared.length === 0 || declared.length === steps.length) continue;
    const missing = steps.filter((step) => !declared.includes(step));
    gaps.push(`themes/${entry} declares ${declared.length}/${steps.length}, missing: ${missing.join(', ')}`);
  }

  assert.deepEqual(gaps, []);
});
