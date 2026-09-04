import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  BUILT_IN_THEMES,
  STANDARD_THEME_CARDS,
  THEME_COLOR_ROLES,
  getThemeCardDefinition,
  getThemeColorsForAppearance,
  getThemeDefinition,
} from '../src/shared/themePalettes';
import { resolveEffectiveTheme } from '../src/renderer/lib/themePalette';

test('Theme Color Roles defines all palette roles', () => {
  assert.equal(THEME_COLOR_ROLES.length, 57);
});

test('Built-in themes contain all 57 roles for both light and dark appearances', () => {
  const expectedThemeIds = ['t3-chat', 'grove', 'ocean', 'ember', 'iris'];
  assert.equal(BUILT_IN_THEMES.length, 5);

  for (const themeId of expectedThemeIds) {
    const theme = getThemeDefinition(themeId);
    assert.ok(theme, `Theme ${themeId} should exist`);
    assert.equal(theme.id, themeId);

    // Check light and dark palettes
    const lightColors = getThemeColorsForAppearance(theme, 'light');
    const darkColors = getThemeColorsForAppearance(theme, 'dark');

    assert.ok(lightColors, `Theme ${themeId} should have light colors`);
    assert.ok(darkColors, `Theme ${themeId} should have dark colors`);

    for (const role of THEME_COLOR_ROLES) {
      assert.ok(
        typeof lightColors[role] === 'string' && lightColors[role].length > 0,
        `Theme ${themeId} missing light role: ${role}`
      );
      assert.ok(
        typeof darkColors[role] === 'string' && darkColors[role].length > 0,
        `Theme ${themeId} missing dark role: ${role}`
      );
    }
  }
});

test('Theme card definitions map preview colors correctly', () => {
  assert.ok(STANDARD_THEME_CARDS.length > 0);
  const atlasCard = STANDARD_THEME_CARDS[0];
  assert.equal(atlasCard.id, 'default');
  assert.equal(atlasCard.label, 'Atlas');

  for (const theme of BUILT_IN_THEMES) {
    const card = getThemeCardDefinition(theme);
    assert.equal(card.id, theme.id);
    assert.equal(card.label, theme.label);
    const lightPreview = card.previews.find((p) => p.mode === 'light');
    const darkPreview = card.previews.find((p) => p.mode === 'dark');
    assert.ok(lightPreview, `Theme ${theme.id} should have light preview`);
    assert.ok(darkPreview, `Theme ${theme.id} should have dark preview`);
    assert.ok(lightPreview.colors.canvas);
    assert.ok(lightPreview.colors.accent);
    assert.ok(darkPreview.colors.canvas);
    assert.ok(darkPreview.colors.accent);
  }
});

test('resolveEffectiveTheme handles single theme and appearance halves', () => {
  // Case 1: Simple theme without halves
  assert.equal(resolveEffectiveTheme('grove', 'light', null), 'grove');
  assert.equal(resolveEffectiveTheme('grove', 'dark', null), 'grove');

  // Case 2: Halves override specific appearance
  const halves = { light: 'ocean', dark: 'ember' };
  assert.equal(resolveEffectiveTheme('grove', 'light', halves), 'ocean');
  assert.equal(resolveEffectiveTheme('grove', 'dark', halves), 'ember');

  // Case 3: Partial half fallback to base theme
  const partialHalves = { light: 'iris', dark: null };
  assert.equal(resolveEffectiveTheme('grove', 'light', partialHalves), 'iris');
  assert.equal(resolveEffectiveTheme('grove', 'dark', partialHalves), 'grove');

  // Case 4: Default fallback
  assert.equal(resolveEffectiveTheme(undefined, 'dark', null), 'default');
});
