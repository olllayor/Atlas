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
import { getVariantShortLabel, resolveEffectiveTheme } from '../src/renderer/lib/themePalette';
import {
  createVividThemeColors,
  parseThemeRgbColor,
  themeContrastRatio,
} from '../src/renderer/lib/themeVividEngine';

test('Theme Color Roles defines all palette roles', () => {
  assert.equal(THEME_COLOR_ROLES.length, 57);
});

test('Built-in themes contain all 57 roles for both light and dark appearances', () => {
  const expectedThemeIds = ['t3-chat', 'grove', 'ocean', 'ember', 'iris', 'workbench'];
  assert.equal(BUILT_IN_THEMES.length, 6);

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

test("getVariantShortLabel derives clean short labels for theme family variants", () => {
  // Base theme matching collection
  assert.equal(getVariantShortLabel("One Dark Pro", "One Dark Pro"), "Pro");
  assert.equal(getVariantShortLabel("Tokyo Night", "Tokyo Night"), "Night");

  // Sub-variants starting with collection name
  assert.equal(getVariantShortLabel("One Dark Pro Darker", "One Dark Pro"), "Darker");
  assert.equal(getVariantShortLabel("One Dark Pro Flat", "One Dark Pro"), "Flat");
  assert.equal(getVariantShortLabel("One Dark Pro Mix", "One Dark Pro"), "Mix");
  assert.equal(getVariantShortLabel("Catppuccin Mocha", "Catppuccin"), "Mocha");
  assert.equal(getVariantShortLabel("Catppuccin Latte", "Catppuccin"), "Latte");
  assert.equal(getVariantShortLabel("Tokyo Night Storm", "Tokyo Night"), "Storm");
  assert.equal(getVariantShortLabel("Solarized Dark", "Solarized"), "Dark");

  // Single word collections fallback
  assert.equal(getVariantShortLabel("Nord", "Nord"), "Nord");
});

test('built-in theme palettes enforce WCAG contrast for core roles', () => {
  for (const theme of BUILT_IN_THEMES) {
    for (const mode of ['light', 'dark'] as const) {
      const colors = getThemeColorsForAppearance(theme, mode);
      assert.ok(colors, `${theme.id} (${mode}) must have colors`);

      const mutedFg = parseThemeRgbColor(colors.mutedForeground, { r: 0, g: 0, b: 0 });
      const mutedBg = parseThemeRgbColor(colors.muted, { r: 0, g: 0, b: 0 });
      const placeholder = parseThemeRgbColor(colors.placeholder, { r: 0, g: 0, b: 0 });
      const surfaceRaised = parseThemeRgbColor(colors.surfaceRaised, { r: 0, g: 0, b: 0 });
      const accentFg = parseThemeRgbColor(colors.accentForeground, { r: 0, g: 0, b: 0 });
      const accentBg = parseThemeRgbColor(colors.accent, { r: 0, g: 0, b: 0 });
      const actionFg = parseThemeRgbColor(colors.messageActionForeground, { r: 0, g: 0, b: 0 });
      const actionBg = parseThemeRgbColor(colors.messageAction, { r: 0, g: 0, b: 0 });
      const actionHover = parseThemeRgbColor(colors.messageActionHover, { r: 0, g: 0, b: 0 });

      const cMuted = themeContrastRatio(mutedFg, mutedBg);
      const cPlaceholder = themeContrastRatio(placeholder, surfaceRaised);
      const cAccent = themeContrastRatio(accentFg, accentBg);
      const cAction = themeContrastRatio(actionFg, actionBg);
      const cActionHover = themeContrastRatio(actionFg, actionHover);

      assert.ok(
        cMuted >= 4.5,
        `${theme.id} (${mode}): mutedForeground on muted contrast must be >= 4.5, got ${cMuted.toFixed(2)}`,
      );
      assert.ok(
        cPlaceholder >= 4.5,
        `${theme.id} (${mode}): placeholder on surfaceRaised contrast must be >= 4.5, got ${cPlaceholder.toFixed(2)}`,
      );
      assert.ok(
        cAccent >= 4.5,
        `${theme.id} (${mode}): accentForeground on accent contrast must be >= 4.5, got ${cAccent.toFixed(2)}`,
      );
      assert.ok(
        cAction >= 4.5,
        `${theme.id} (${mode}): messageActionForeground on messageAction contrast must be >= 4.5, got ${cAction.toFixed(2)}`,
      );
      assert.ok(
        cActionHover >= 4.5,
        `${theme.id} (${mode}): messageActionForeground on messageActionHover contrast must be >= 4.5, got ${cActionHover.toFixed(2)}`,
      );
    }
  }
});

test('createVividThemeColors enforces WCAG contrast for mutedForeground, placeholder, accent, and messageAction', () => {
  for (const mode of ['light', 'dark'] as const) {
    const bg = mode === 'dark' ? '#1a1b26' : '#fbfbfd';
    const accent = '#db2777';
    const colors = createVividThemeColors(mode, bg, accent);

    const mutedFg = parseThemeRgbColor(colors.mutedForeground, { r: 0, g: 0, b: 0 });
    const mutedBg = parseThemeRgbColor(colors.muted, { r: 0, g: 0, b: 0 });
    const placeholder = parseThemeRgbColor(colors.placeholder, { r: 0, g: 0, b: 0 });
    const surfaceRaised = parseThemeRgbColor(colors.surfaceRaised, { r: 0, g: 0, b: 0 });
    const accentFg = parseThemeRgbColor(colors.accentForeground, { r: 0, g: 0, b: 0 });
    const accentBg = parseThemeRgbColor(colors.accent, { r: 0, g: 0, b: 0 });
    const actionFg = parseThemeRgbColor(colors.messageActionForeground, { r: 0, g: 0, b: 0 });
    const actionHover = parseThemeRgbColor(colors.messageActionHover, { r: 0, g: 0, b: 0 });

    const cMuted = themeContrastRatio(mutedFg, mutedBg);
    const cPlaceholder = themeContrastRatio(placeholder, surfaceRaised);
    const cAccent = themeContrastRatio(accentFg, accentBg);
    const cActionHover = themeContrastRatio(actionFg, actionHover);

    assert.ok(cMuted >= 4.5, `vivid (${mode}): muted contrast must be >= 4.5, got ${cMuted.toFixed(2)}`);
    assert.ok(
      cPlaceholder >= 4.5,
      `vivid (${mode}): placeholder contrast must be >= 4.5, got ${cPlaceholder.toFixed(2)}`,
    );
    assert.ok(cAccent >= 4.5, `vivid (${mode}): accent contrast must be >= 4.5, got ${cAccent.toFixed(2)}`);
    assert.ok(
      cActionHover >= 4.5,
      `vivid (${mode}): actionHover contrast must be >= 4.5, got ${cActionHover.toFixed(2)}`,
    );
  }
});
