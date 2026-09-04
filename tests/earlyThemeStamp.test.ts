import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';

import {
  persistCachedTheme,
  stampCachedTheme,
  THEME_MODE_STORAGE_KEY,
  DESIGN_THEME_STORAGE_KEY
} from '../src/renderer/lib/earlyThemeStamp';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

let storage: Record<string, string> = {};
let documentElement: {
  dataset: Record<string, string>;
  style: Record<string, string>;
};

beforeEach(() => {
  storage = {};
  documentElement = {
    dataset: {},
    style: {}
  };

  const mockLocalStorage = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    }
  };

  const mockDocument = {
    documentElement
  };

  const mockWindow = {
    matchMedia: (query: string) => ({
      matches: query.includes('dark'),
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  };

  (globalThis as any).localStorage = mockLocalStorage;
  (globalThis as any).document = mockDocument;
  (globalThis as any).window = mockWindow;
});

afterEach(() => {
  (globalThis as any).window = originalWindow;
  (globalThis as any).document = originalDocument;
  (globalThis as any).localStorage = originalLocalStorage;
});

test('persistCachedTheme writes mode and design theme to localStorage', () => {
  persistCachedTheme('light', 'cursor');
  assert.equal(storage[THEME_MODE_STORAGE_KEY], 'light');
  assert.equal(storage[DESIGN_THEME_STORAGE_KEY], 'cursor');
});

test('stampCachedTheme applies cached theme before React mounts', () => {
  storage[THEME_MODE_STORAGE_KEY] = 'light';
  storage[DESIGN_THEME_STORAGE_KEY] = 'cursor';

  stampCachedTheme();

  assert.equal(documentElement.dataset.theme, 'light');
  assert.equal(documentElement.dataset.designTheme, 'cursor');
  assert.equal(documentElement.style.colorScheme, 'light');
});

test('stampCachedTheme resolves system mode using matchMedia', () => {
  storage[THEME_MODE_STORAGE_KEY] = 'system';
  storage[DESIGN_THEME_STORAGE_KEY] = 'xai';

  stampCachedTheme();

  // matchMedia matches dark
  assert.equal(documentElement.dataset.theme, 'dark');
  assert.equal(documentElement.dataset.designTheme, 'xai');
  assert.equal(documentElement.style.colorScheme, 'dark');
});

test('stampCachedTheme does nothing when no cached theme is found', () => {
  stampCachedTheme();
  assert.equal(documentElement.dataset.theme, undefined);
  assert.equal(documentElement.dataset.designTheme, undefined);
});
