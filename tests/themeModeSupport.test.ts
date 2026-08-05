import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  DESIGN_THEMES,
  DESIGN_THEMES_WITH_LIGHT,
  designThemeSupportsLight,
  resolveAppliedThemeMode,
} from '../src/shared/contracts';

const THEME_DIR = 'src/renderer/themes';

/**
 * A theme file only has a light palette if it says so in one of two ways:
 * an explicit `[data-theme='light']` block (codex), or a light-first base with
 * a `[data-theme='dark']` override (cursor). A file with neither defines a
 * single dark palette, which is what `default.css` and `xai.css` do.
 */
function fileDeclaresLight(theme: string): boolean {
  const css = readFileSync(join(THEME_DIR, `${theme}.css`), 'utf8');
  return css.includes("[data-theme='light']") || css.includes("[data-theme='dark']");
}

test('DESIGN_THEMES_WITH_LIGHT matches what the theme stylesheets actually define', () => {
  for (const theme of DESIGN_THEMES) {
    assert.equal(
      designThemeSupportsLight(theme),
      fileDeclaresLight(theme),
      `${theme}.css and DESIGN_THEMES_WITH_LIGHT disagree about light support. ` +
        'Add the light palette to the stylesheet or drop the theme from the list — ' +
        'a theme listed without one paints a dark UI under `color-scheme: light`.'
    );
  }
});

test('a theme without a light palette never resolves to light', () => {
  for (const theme of DESIGN_THEMES) {
    if (designThemeSupportsLight(theme)) continue;

    assert.equal(resolveAppliedThemeMode('light', theme, false), 'dark');
    // `system` on a light desktop is the path a user never chose explicitly.
    assert.equal(resolveAppliedThemeMode('system', theme, false), 'dark');
    assert.equal(resolveAppliedThemeMode('dark', theme, true), 'dark');
  }
});

test('a theme with a light palette still honours every mode', () => {
  for (const theme of DESIGN_THEMES_WITH_LIGHT) {
    assert.equal(resolveAppliedThemeMode('light', theme, true), 'light');
    assert.equal(resolveAppliedThemeMode('dark', theme, false), 'dark');
    assert.equal(resolveAppliedThemeMode('system', theme, false), 'light');
    assert.equal(resolveAppliedThemeMode('system', theme, true), 'dark');
  }
});
