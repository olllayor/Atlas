import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../src/shared/contracts.js';
import {
  CONTENT_MAX_WIDTH,
  MINIMAP_MIN_ITEMS,
  deriveMinimapItems,
  isRowInView,
  resolveContentWidth,
  resolveMinimapHasPersistentGutter,
  resolveMinimapHeightStyle,
  resolveMinimapHitStripWidth,
  resolveMinimapIndexFromPointer,
  resolveMinimapTopPercent,
} from '../src/renderer/lib/timelineMinimap.js';

let nextId = 0;
function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  nextId += 1;
  return {
    id: overrides.id ?? `message-${nextId}`,
    conversationId: 'conversation-1',
    role: 'user',
    content: '',
    reasoning: null,
    parts: [],
    status: 'complete',
    providerId: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    latencyMs: null,
    errorCode: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('resolveContentWidth mirrors the single 48rem chat column', () => {
  assert.equal(resolveContentWidth(500), 500);
  assert.equal(resolveContentWidth(700), 700);
  assert.equal(resolveContentWidth(4000), CONTENT_MAX_WIDTH);
});

test('resolveMinimapTopPercent spreads ticks evenly and clamps', () => {
  assert.equal(resolveMinimapTopPercent(2, 5), 50);
  assert.equal(resolveMinimapTopPercent(-3, 5), 0);
  assert.equal(resolveMinimapTopPercent(99, 5), 100);
  assert.equal(resolveMinimapTopPercent(0, 1), 0, 'single item never divides by zero');
});

test('resolveMinimapHeightStyle caps at the viewport budget', () => {
  assert.equal(resolveMinimapHeightStyle(3), 'min(16px, calc(100vh - 18rem))');
  assert.equal(resolveMinimapHeightStyle(1), 'min(1px, calc(100vh - 18rem))');
});

test('resolveMinimapIndexFromPointer maps pointer progress onto tick indices', () => {
  const rail = { itemCount: 5, railTop: 100, railHeight: 200, pointerY: 0 };
  assert.equal(resolveMinimapIndexFromPointer(rail), 0, 'above the rail clamps to first');
  assert.equal(
    resolveMinimapIndexFromPointer({ ...rail, pointerY: 200 }),
    2,
    'midpoint hits middle tick'
  );
  assert.equal(resolveMinimapIndexFromPointer({ ...rail, pointerY: 9999 }), 4, 'below clamps to last');
  assert.equal(resolveMinimapIndexFromPointer({ ...rail, itemCount: 1 }), 0);
  assert.equal(resolveMinimapIndexFromPointer({ ...rail, railHeight: 0 }), null);
});

test('gutter math: persistent gutter needs 48px of side space; hit strip is capped', () => {
  // Wide window: content capped at 768 → gutter (1440-768)/2 = 336.
  assert.equal(resolveMinimapHasPersistentGutter(1440), true);
  assert.equal(resolveMinimapHitStripWidth(1440), 40);

  // Narrow window: content fills the pane → no usable gutter.
  assert.equal(resolveMinimapHasPersistentGutter(760), false);
  assert.equal(resolveMinimapHitStripWidth(760), 0);

  // 900px: content caps at 768, leaving a 66px gutter → full strip.
  assert.equal(resolveMinimapHasPersistentGutter(900), true);
  assert.equal(resolveMinimapHitStripWidth(900), 40);
});

test('isRowInView adds one row of slack on both sides of the virtual window', () => {
  const range = { startIndex: 10, endIndex: 20 };
  assert.equal(isRowInView(9, range), true);
  assert.equal(isRowInView(21, range), true);
  assert.equal(isRowInView(8, range), false);
  assert.equal(isRowInView(23, range), false);
  assert.equal(isRowInView(0, null), false);
});

test('deriveMinimapItems: one jump per user turn with final assistant text of that turn', () => {
  const messages = [
    makeMessage({ id: 'u1', role: 'user', content: 'First question' }),
    makeMessage({ id: 'a1', role: 'assistant', content: 'Draft answer' }),
    makeMessage({ id: 'a2', role: 'assistant', content: 'Final answer' }),
    makeMessage({ id: 's0', role: 'system', content: 'ignored' }),
    makeMessage({ id: 'u2', role: 'user', content: 'Second  question\nwith newlines' }),
    makeMessage({ id: 'a3', role: 'assistant', content: '' }),
  ];

  const items = deriveMinimapItems(messages);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.id),
    ['u1', 'u2']
  );
  assert.deepEqual(
    items.map((item) => item.rowIndex),
    [0, 4]
  );
  assert.equal(items[0].assistantText, 'Final answer', 'later assistant message wins');
  assert.equal(items[1].assistantText, null, 'empty assistant text is not a preview');
  assert.equal(items[1].userText, 'Second question with newlines', 'whitespace collapsed');
});

test('deriveMinimapItems: long previews truncate on a code-point boundary', () => {
  const messages = [makeMessage({ content: 'x'.repeat(600) })];
  const [item] = deriveMinimapItems(messages);
  assert.ok(item.userText.length <= 240);
  assert.ok(item.userText.endsWith('…'));
});

test('deriveMinimapItems: below the minimum there is nothing to render', () => {
  assert.equal(deriveMinimapItems([]).length, 0);
  const single = deriveMinimapItems([makeMessage({})]);
  assert.ok(single.length < MINIMAP_MIN_ITEMS);
});
