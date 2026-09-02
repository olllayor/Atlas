import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type SurfaceShortcutEvent,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
} from '../src/renderer/components/workbench/surfaceShortcuts.js';

const ACTIONS = [
  { kind: 'diff', shortcut: 'D', available: true },
  { kind: 'git', shortcut: 'G', available: true },
  { kind: 'agents', shortcut: 'A', available: false },
] as const;

function keyEvent(overrides: Partial<SurfaceShortcutEvent> & { key: string }): SurfaceShortcutEvent {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ...overrides,
  };
}

test('a bare letter opens its surface, in either case', () => {
  assert.equal(surfaceShortcutActionForKey(ACTIONS, keyEvent({ key: 'd' }))?.kind, 'diff');
  assert.equal(surfaceShortcutActionForKey(ACTIONS, keyEvent({ key: 'D' }))?.kind, 'diff');
});

test('an unavailable surface does not answer its letter', () => {
  assert.equal(surfaceShortcutActionForKey(ACTIONS, keyEvent({ key: 'a' })), null);
});

test('modifiers mean the user is aiming at an app shortcut', () => {
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
    assert.equal(
      surfaceShortcutActionForKey(ACTIONS, keyEvent({ key: 'd', [modifier]: true })),
      null,
      modifier
    );
  }
});

test('a composing or already-handled keystroke is left alone', () => {
  assert.equal(surfaceShortcutActionForKey(ACTIONS, keyEvent({ key: 'd', isComposing: true })), null);
  assert.equal(
    surfaceShortcutActionForKey(ACTIONS, keyEvent({ key: 'd', defaultPrevented: true })),
    null
  );
});

test('an unbound key matches nothing', () => {
  assert.equal(surfaceShortcutActionForKey(ACTIONS, keyEvent({ key: 'q' })), null);
});

/** Stand-in for the DOM's `closest`, which is all the guard actually uses. */
function target(matches: string[]) {
  return {
    closest: (selectors: string) =>
      selectors.split(',').some((selector) => matches.includes(selector.trim())) ? {} : null,
  };
}

test('a focused text input is a typing context', () => {
  assert.equal(surfaceShortcutTargetsTypingContext(target(['input'])), true);
  assert.equal(surfaceShortcutTargetsTypingContext(target(['textarea'])), true);
  assert.equal(
    surfaceShortcutTargetsTypingContext(
      target(['[contenteditable]:not([contenteditable="false"])'])
    ),
    true
  );
});

test('a plain element is not a typing context', () => {
  assert.equal(surfaceShortcutTargetsTypingContext(target(['div'])), false);
  assert.equal(surfaceShortcutTargetsTypingContext(null), false);
});
