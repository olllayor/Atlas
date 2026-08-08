import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeThemeColor } from '../src/shared/contracts';
import {
  buildThemeOverrides,
  contrastFactor,
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
  assert.equal(contrastFactor(Number.NaN), 1);
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

test('contrast alone rescales the ladder around the authored foreground', () => {
  const overrides = buildThemeOverrides({
    accentColor: null,
    backgroundColor: null,
    foregroundColor: null,
    contrast: 100
  });

  assert.equal(overrides['--bg-base'], undefined);
  assert.ok(overrides['--text-secondary']?.includes('var(--text-primary)'));
  // 78% × 1.4 = 109.2 clamps to the 100% ceiling.
  assert.ok(overrides['--text-secondary']?.includes('100%'));
  assert.ok(overrides['--border-strong']?.includes('30.8%'));
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

test('parseThemeImport rejects garbage and normalizes bad colors to null', () => {
  assert.equal(parseThemeImport('not json'), null);
  assert.equal(parseThemeImport('42'), null);
  assert.equal(parseThemeImport('{}'), null);

  const partial = parseThemeImport(JSON.stringify({ accentColor: 'red', contrast: 250 }));
  assert.deepEqual(partial, { accentColor: null, contrast: 100 });
});
