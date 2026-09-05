import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeThemeColor } from '../src/shared/contracts';
import {
  buildThemeOverrides,
  contrastFactor,
  contrastVars,
  exportTheme,
  parseThemeImport
} from '../src/renderer/lib/themeOverrides';
import { DEFAULT_SETTINGS_APPEARANCE } from '../src/shared/contracts';

test('normalizeThemeColor accepts 3- and 6-digit hex, rejects everything else', () => {
  assert.equal(normalizeThemeColor('#0169CC'), '#0169cc');
  assert.equal(normalizeThemeColor(' #abc '), '#aabbcc');
  assert.equal(normalizeThemeColor('#12345'), null);
  assert.equal(normalizeThemeColor('blue'), null);
  assert.equal(normalizeThemeColor('#0169cc; }'), null);
  assert.equal(normalizeThemeColor(12), null);
  assert.equal(normalizeThemeColor(null), null);
});

test('contrastFactor maps the slider to 0.6–1.4 with a neutral midpoint', () => {
  assert.equal(contrastFactor(50), 1);
  assert.equal(contrastFactor(0), 0.6);
  assert.equal(contrastFactor(100), 1.4);
  assert.equal(contrastFactor(200), 2.2);
  assert.equal(contrastFactor(Number.NaN), 1);
});

test('contrastVars splits the slider into base, boost, and border boost', () => {
  // Neutral: authored values pass through untouched.
  assert.deepEqual(contrastVars(50), { base: '100%', boost: '0%', borderBoost: '0%' });
  // Low end fades derivations out, never pushes.
  assert.deepEqual(contrastVars(0), { base: '0%', boost: '0%', borderBoost: '0%' });
  // High end keeps the base and pushes text toward the target; borders at quarter rate.
  assert.deepEqual(contrastVars(100), { base: '100%', boost: '100%', borderBoost: '25%' });
  assert.deepEqual(contrastVars(150), { base: '50%', boost: '100%', borderBoost: '62.5%' });
  assert.deepEqual(contrastVars(200), { base: '0%', boost: '100%', borderBoost: '100%' });
  assert.deepEqual(contrastVars(75), { base: '100%', boost: '50%', borderBoost: '12.5%' });
  assert.deepEqual(contrastVars(Number.NaN), { base: '100%', boost: '0%', borderBoost: '0%' });
});

test('no overrides at defaults: neutral contrast and no colors emit nothing', () => {
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: null,
    foregroundColor: null,
    contrast: 50
  });
  assert.deepEqual(overrides, {});
});

test('accent override derives hover, text, surface, and ring from one color', () => {
  const overrides = buildThemeOverrides({
    accentColor: '#0169cc',
    backgroundColor: null,
    foregroundColor: null,
    contrast: 50
  });

  assert.equal(overrides['--accent'], '#0169cc');
  // #0169cc is dark enough to need white accent text.
  assert.equal(overrides['--accent-text'], '#ffffff');
  assert.ok(overrides['--ring']?.includes('#0169cc'));
  // Accent alone must not touch the foreground ladder.
  assert.equal(overrides['--text-secondary'], undefined);
});

test('background override synthesizes a foreground ladder from luminance', () => {
  const dark = buildThemeOverrides({
    accentColor: null,
    backgroundColor: '#111111',
    foregroundColor: null,
    contrast: 50
  });
  assert.equal(dark['--bg-base'], '#111111');
  assert.ok(dark['--text-secondary']?.includes('#ffffff'));

  const light = buildThemeOverrides({
    accentColor: null,
    backgroundColor: '#fafafa',
    foregroundColor: null,
    contrast: 50
  });
  assert.ok(light['--text-secondary']?.includes('#000000'));
});

test('background-only override also flips primary text, inverse, and button ink', () => {
  // Regression: only the opacity ladder used to follow the derived
  // foreground, leaving --text-primary white on the new white background.
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: '#fafafa',
    foregroundColor: null,
    contrast: 50
  });

  assert.equal(overrides['--text-primary'], '#000000');
  assert.equal(overrides['--text-inverse'], '#ffffff');
  assert.equal(overrides['--bg-button'], '#000000');
  assert.ok(overrides['--bg-button-hover']?.includes('#000000'));
});

test('an explicit foreground still wins over the luminance-derived one', () => {
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: '#fafafa',
    foregroundColor: '#1a1c1f',
    contrast: 50
  });

  assert.equal(overrides['--text-primary'], '#1a1c1f');
});

test('a light background override adapts semantic, toast, diff, and terminal palettes', () => {
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: '#fafafa',
    foregroundColor: null,
    contrast: 50
  });

  // Semantic text derives from the theme's own base hue, not a hardcoded value.
  assert.ok(overrides['--success-text']?.startsWith('color-mix(in oklab, var(--success)'));
  assert.ok(overrides['--warning-text']?.startsWith('color-mix(in oklab, var(--warning)'));
  assert.ok(overrides['--error-text']?.startsWith('color-mix(in oklab, var(--error)'));

  // Toast ink follows the foreground ladder.
  assert.ok(overrides['--toast-text']?.includes('#000000'));
  assert.ok(overrides['--toast-border']?.includes('#000000'));

  // GitHub light diffs.
  assert.equal(overrides['--diff-add-bg'], '#dafbe1');
  assert.equal(overrides['--diff-del-bg'], '#ffebe9');

  // Terminal ANSI readable on light.
  assert.equal(overrides['--term-red'], '#cf222e');
  assert.equal(overrides['--term-selection'], 'rgba(0, 0, 0, 0.16)');
});

test('a dark background override keeps the authored dark satellite palettes', () => {
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: '#101319',
    foregroundColor: null,
    contrast: 50
  });

  assert.equal(overrides['--success-text'], undefined);
  assert.equal(overrides['--term-red'], undefined);
  assert.equal(overrides['--diff-add-bg'], undefined);
  assert.equal(overrides['--toast-text'], undefined);
});

test('contrast alone emits live twin formulas around the authored foreground', () => {
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: null,
    foregroundColor: null,
    contrast: 100
  });

  assert.equal(overrides['--bg-base'], undefined);
  // Text answers base + target boost; borders answer base + gentler fg boost.
  assert.ok(overrides['--text-secondary']?.includes('var(--text-primary)'));
  assert.ok(overrides['--text-secondary']?.includes('var(--contrast-base)'));
  assert.ok(overrides['--text-secondary']?.includes('var(--contrast-target)'));
  assert.ok(overrides['--text-secondary']?.includes('var(--contrast-boost)'));
  assert.ok(overrides['--border-strong']?.includes('var(--contrast-border-boost)'));
  // No baked percentages survive: theme switches re-resolve without a rebuild.
  assert.ok(!overrides['--text-secondary']?.includes('109.2%'));
  assert.ok(!overrides['--border-strong']?.includes('30.8%'));
});

test('foreground override sets primary text and inverse', () => {
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: null,
    foregroundColor: '#fcfcfc',
    contrast: 50
  });

  assert.equal(overrides['--text-primary'], '#fcfcfc');
  assert.equal(overrides['--text-inverse'], '#0d0d0d');
  assert.ok(overrides['--border-default']?.includes('#fcfcfc'));
});

test('theme export → import round-trips', () => {
  const appearance = {
    ...DEFAULT_SETTINGS_APPEARANCE,
    accentColor: '#0169cc',
    backgroundColor: '#111111',
    foregroundColor: '#fcfcfc',
    contrast: 64,
    translucentSidebar: true,
    uiFontFamily: 'Geist',
    codeFontFamily: 'Geist Mono'
  };

  const exported = exportTheme(appearance);
  const imported = parseThemeImport(JSON.stringify(exported));

  assert.deepEqual(imported, exported);
});

test('theme contract excludes translucentSidebar — a pasted theme cannot flip vibrancy', () => {
  const appearance = { ...DEFAULT_SETTINGS_APPEARANCE, translucentSidebar: true };

  assert.ok(!('translucentSidebar' in exportTheme(appearance)));
  assert.deepEqual(parseThemeImport(JSON.stringify({ accentColor: '#0169cc', translucentSidebar: true })), {
    accentColor: '#0169cc'
  });
});

test('parseThemeImport rejects garbage and normalizes bad colors to null', () => {
  assert.equal(parseThemeImport('not json'), null);
  assert.equal(parseThemeImport('42'), null);
  assert.equal(parseThemeImport('{}'), null);

  const partial = parseThemeImport(JSON.stringify({ accentColor: 'red', contrast: 250 }));
  assert.deepEqual(partial, { accentColor: null, contrast: 200 });
});
