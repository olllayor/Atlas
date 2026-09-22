import assert from 'node:assert/strict';
import test from 'node:test';

import { computePrependRestore } from '../src/renderer/lib/prependRestore.js';

test('keeps the anchor row at its pre-load viewport offset', () => {
  const target = computePrependRestore({
    anchorIndex: 0,
    pixelDelta: 195,
    scrollTopAtStart: 195,
    scrollTopNow: 195,
    prependedCount: 100,
  });
  assert.deepEqual(target, { index: 100, pixelDelta: 195 });
});

test('follows an in-flight scroll to the absolute head', () => {
  const target = computePrependRestore({
    anchorIndex: 0,
    pixelDelta: 195,
    scrollTopAtStart: 195,
    scrollTopNow: 0,
    prependedCount: 100,
  });
  assert.deepEqual(target, { index: 100, pixelDelta: 0 });
});

test('follows an in-flight scroll away from the head', () => {
  const target = computePrependRestore({
    anchorIndex: 2,
    pixelDelta: 40,
    scrollTopAtStart: 800,
    scrollTopNow: 1200,
    prependedCount: 50,
  });
  assert.deepEqual(target, { index: 52, pixelDelta: 440 });
});

test('a reader parked at scrollTop 0 only shifts by the prepend', () => {
  const target = computePrependRestore({
    anchorIndex: 0,
    pixelDelta: 0,
    scrollTopAtStart: 0,
    scrollTopNow: 0,
    prependedCount: 25,
  });
  assert.deepEqual(target, { index: 25, pixelDelta: 0 });
});
