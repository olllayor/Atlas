import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Regression guard for the white-border incidents (activity popover, project
 * scope menu): Tailwind v4 renders a bare `border` utility with
 * `currentColor` — near-white text in dark mode — unless `@theme` sets
 * `--default-border-color`. Dozens of call sites rely on the bare utility,
 * so the default lives in one place instead of a color class on each one.
 */
test('@theme sets a default border color on the design token', () => {
  const css = readFileSync('src/renderer/styles.css', 'utf8');
  const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  assert.ok(theme, '@theme block not found in styles.css');
  assert.match(
    theme![1],
    /--default-border-color:\s*var\(--border-default\)/,
    'bare `border` utilities fall back to currentColor (white in dark mode)'
  );
});
