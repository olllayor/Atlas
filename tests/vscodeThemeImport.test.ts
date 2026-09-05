import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  isVsCodeThemeFile,
  parseVsCodeThemeFile,
  pairVsCodeThemes,
  resolveThemeLabelCollisions,
  humanizeThemeName,
} from '../src/renderer/lib/vscodeThemeImport';
import { THEME_COLOR_ROLES } from '../src/shared/themePalettes';

test('isVsCodeThemeFile detects VS Code themes by dotted keys or tokenColors', () => {
  assert.equal(
    isVsCodeThemeFile({
      name: 'Test Theme',
      colors: { 'editor.background': '#1e1e1e' },
    }),
    true,
  );

  assert.equal(
    isVsCodeThemeFile({
      name: 'Test Theme',
      tokenColors: [{ settings: { foreground: '#ffffff' } }],
    }),
    true,
  );

  assert.equal(
    isVsCodeThemeFile({
      version: 1,
      name: 'Atlas Native',
      colors: { canvas: '#ffffff' },
    }),
    false,
  );

  assert.equal(isVsCodeThemeFile(null), false);
  assert.equal(isVsCodeThemeFile('invalid'), false);
  assert.equal(isVsCodeThemeFile({}), false);
});

test('humanizeThemeName converts slugs into clean titles', () => {
  assert.equal(humanizeThemeName('one-dark-pro'), 'One Dark Pro');
  assert.equal(humanizeThemeName('catppuccin_mocha'), 'Catppuccin Mocha');
  assert.equal(humanizeThemeName('tokyo-night.storm'), 'Tokyo Night Storm');
  assert.equal(humanizeThemeName('Already Humanized'), 'Already Humanized');
});

test('parseVsCodeThemeFile derives all 57 palette roles and enforces WCAG contrast', () => {
  const vsCodeTheme = {
    name: 'One Dark Pro',
    type: 'dark',
    colors: {
      'editor.background': '#282c34',
      'editor.foreground': '#abb2bf',
      'focusBorder': '#528bff',
      'button.background': '#404754',
      'button.foreground': '#ffffff',
      'sideBar.background': '#21252b',
      'sideBar.foreground': '#9da5b4',
      'terminal.background': '#282c34',
      'terminal.foreground': '#abb2bf',
    },
  };

  const parsed = parseVsCodeThemeFile(vsCodeTheme);
  assert.equal(parsed.label, 'One Dark Pro');
  assert.equal(parsed.appearance, 'dark');
  assert.ok(parsed.id);

  // Check that all 57 roles are populated
  for (const role of THEME_COLOR_ROLES) {
    assert.ok(
      typeof parsed.colors[role] === 'string' && parsed.colors[role].length > 0,
      `Missing role: ${role}`,
    );
  }

  assert.equal(parsed.colors.canvas, '#282c34');
  assert.equal(parsed.colors.sidebar, '#21252b');
});

test('parseVsCodeThemeFile rejects themes without editor.background', () => {
  assert.throws(() => {
    parseVsCodeThemeFile({
      name: 'No Background',
      colors: { 'editor.foreground': '#ffffff' },
    });
  }, /editor\.background/);
});

test('pairVsCodeThemes merges matching light and dark themes into one dual-mode theme', () => {
  const light = parseVsCodeThemeFile({
    name: 'Solarized Light',
    type: 'light',
    colors: { 'editor.background': '#fdf6e3', focusBorder: '#268bd2' },
  });

  const dark = parseVsCodeThemeFile({
    name: 'Solarized Dark',
    type: 'dark',
    colors: { 'editor.background': '#002b36', focusBorder: '#268bd2' },
  });

  const paired = pairVsCodeThemes([light, dark]);
  assert.equal(paired.length, 1);
  assert.equal(paired[0]?.label, 'Solarized');
  assert.equal(paired[0]?.appearance, 'light');
  assert.ok(paired[0]?.variants?.dark);
});

test('resolveThemeLabelCollisions disambiguates duplicated IDs', () => {
  const themeA = parseVsCodeThemeFile({
    name: 'Dracula',
    colors: { 'editor.background': '#282a36' },
  });

  const themeB = parseVsCodeThemeFile({
    name: 'Dracula',
    colors: { 'editor.background': '#282a36' },
  });

  const resolved = resolveThemeLabelCollisions([
    { theme: themeA, sourceName: 'dracula.json' },
    { theme: themeB, sourceName: 'dracula-soft.json' },
  ]);

  assert.equal(resolved.length, 2);
  assert.notEqual(resolved[0]?.id, resolved[1]?.id);
});
