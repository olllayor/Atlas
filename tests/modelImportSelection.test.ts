import assert from 'node:assert/strict';
import test from 'node:test';

import {
  importSelectionCount,
  resolveImportSelection,
} from '../src/renderer/components/providers/modelImportSelection.js';

const model = (id: string, label = id) => ({
  id,
  label,
  contextWindow: 262_144,
});

test('with no filter, import returns every selection', () => {
  const selected = new Set(['a', 'b', 'c']);
  const models = [model('a'), model('b'), model('c')];

  assert.equal(importSelectionCount({ filter: '', selected, models }), 3);
  assert.deepEqual(
    resolveImportSelection({ filter: '', selected, models }).map((m) => m.id),
    ['a', 'b', 'c']
  );
});

test('repro: filter shows the matches, count and import follow the filter', () => {
  // 60 discovered, 2 matching "nemo" — selection was seeded with all 60 unknown ids.
  const all = Array.from({ length: 60 }, (_, i) => model(`model-${i}`));
  all.push(model('nemotron-3-ultra-free'), model('nemotron-3.5-lightning-free'));
  const known = new Set<string>();
  const seeded = new Set(all.filter((m) => !known.has(m.id)).map((m) => m.id)); // all 62

  const filter = 'nemo';
  const count = importSelectionCount({ filter, selected: seeded, models: all });
  const imported = resolveImportSelection({ filter, selected: seeded, models: all });

  assert.equal(count, 2, 'count should reflect the shown matches, not the hidden selection');
  assert.deepEqual(
    imported.map((m) => m.id),
    ['nemotron-3-ultra-free', 'nemotron-3.5-lightning-free']
  );
});

test('filter that matches nothing yields 0 and disables import at the caller', () => {
  const selected = new Set(['a', 'b']);
  const models = [model('a'), model('b')];
  assert.equal(importSelectionCount({ filter: 'zzz', selected, models }), 0);
  assert.deepEqual(resolveImportSelection({ filter: 'zzz', selected, models }), []);
});

test('labels match too, not just ids', () => {
  const selected = new Set(['x', 'y', 'z']);
  const models = [model('x', 'nemo one'), model('y', 'nemo two'), model('z', 'other')];

  const imported = resolveImportSelection({ filter: 'nemo', selected, models });
  assert.deepEqual(
    imported.map((m) => m.id),
    ['x', 'y'],
    'label matches should be importable when their ids were selected'
  );
});

test('whitespace-only filter behaves as no filter', () => {
  const selected = new Set(['a', 'b']);
  const models = [model('a'), model('b')];
  assert.equal(importSelectionCount({ filter: '   ', selected, models }), 2);
});
