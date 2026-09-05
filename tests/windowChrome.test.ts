import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chromeStateSignature,
  resolveChromeBackground,
  resolveChromeMode,
  resolveChromeSymbolColor,
  type WindowChromeState,
} from '../src/main/bootstrap/windowChrome';

function state(overrides: Partial<WindowChromeState> = {}): WindowChromeState {
  return {
    themeMode: 'dark',
    designTheme: 'codex',
    backgroundColor: null,
    foregroundColor: null,
    translucentSidebar: false,
    ...overrides,
  };
}

test('explicit modes win, system follows the OS reading', () => {
  assert.equal(resolveChromeMode('light', true), 'light');
  assert.equal(resolveChromeMode('dark', false), 'dark');
  assert.equal(resolveChromeMode('system', true), 'dark');
  assert.equal(resolveChromeMode('system', false), 'light');
});

test('background resolves per design theme, override wins over all', () => {
  assert.equal(resolveChromeBackground(state()), '#181818');
  assert.equal(resolveChromeBackground(state({ designTheme: 'atlas', themeMode: 'dark' }), true), '#09090b');
  assert.equal(resolveChromeBackground(state({ designTheme: 'atlas', themeMode: 'light' }), false), '#fcfcfc');
  assert.equal(resolveChromeBackground(state({ designTheme: 'cursor', themeMode: 'dark' }), true), '#26251e');
  assert.equal(resolveChromeBackground(state({ designTheme: 'cursor', themeMode: 'light' }), false), '#f2f1ed');
  assert.equal(
    resolveChromeBackground(state({ designTheme: 'xai', themeMode: 'system' }), false),
    '#ffffff'
  );
  assert.equal(
    resolveChromeBackground(state({ backgroundColor: '#123456' })),
    '#123456'
  );
});

test('symbol color follows the override, else the resolved mode', () => {
  assert.equal(resolveChromeSymbolColor(state({ foregroundColor: '#abcdef' })), '#abcdef');
  assert.equal(resolveChromeSymbolColor(state()), '#9aa3b2');
  assert.equal(resolveChromeSymbolColor(state({ themeMode: 'light' })), '#4b5563');
});

test('signature distinguishes every sync-relevant axis', () => {
  const base = chromeStateSignature(state());
  assert.equal(chromeStateSignature(state()), base);
  assert.notEqual(chromeStateSignature(state({ themeMode: 'light' })), base);
  assert.notEqual(chromeStateSignature(state({ designTheme: 'default' })), base);
  assert.notEqual(chromeStateSignature(state({ backgroundColor: '#000000' })), base);
  assert.notEqual(chromeStateSignature(state({ foregroundColor: '#ffffff' })), base);
  assert.notEqual(chromeStateSignature(state({ translucentSidebar: true })), base);
  // System mode tracks the OS reading
  assert.notEqual(
    chromeStateSignature(state({ themeMode: 'system' }), false),
    chromeStateSignature(state({ themeMode: 'system' }), true)
  );
  // Explicit mode ignores the OS reading
  assert.equal(
    chromeStateSignature(state({ themeMode: 'dark' }), false),
    chromeStateSignature(state({ themeMode: 'dark' }), true)
  );
});
