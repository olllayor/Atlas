import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPACTION_THRESHOLD_DEFAULT,
  COMPACTION_THRESHOLD_MAX,
  COMPACTION_THRESHOLD_MIN,
  clampCompactionThresholdPercent,
  compactionPercentToRatio,
  normalizeCompactionThresholdPercent,
} from '../src/shared/contextCompaction.ts';

test('normalize returns default for missing/invalid values', () => {
  assert.equal(normalizeCompactionThresholdPercent(undefined), COMPACTION_THRESHOLD_DEFAULT);
  assert.equal(normalizeCompactionThresholdPercent(null), COMPACTION_THRESHOLD_DEFAULT);
  assert.equal(normalizeCompactionThresholdPercent('85' as unknown as number), COMPACTION_THRESHOLD_DEFAULT);
  assert.equal(normalizeCompactionThresholdPercent(Number.NaN), COMPACTION_THRESHOLD_DEFAULT);
  assert.equal(normalizeCompactionThresholdPercent(Infinity), COMPACTION_THRESHOLD_DEFAULT);
  assert.equal(normalizeCompactionThresholdPercent({}), COMPACTION_THRESHOLD_DEFAULT);
});

test('normalize clamps to 50..95 and rounds', () => {
  assert.equal(normalizeCompactionThresholdPercent(10), COMPACTION_THRESHOLD_MIN);
  assert.equal(normalizeCompactionThresholdPercent(200), COMPACTION_THRESHOLD_MAX);
  assert.equal(normalizeCompactionThresholdPercent(84.4), 84);
  assert.equal(normalizeCompactionThresholdPercent(84.6), 85);
  assert.equal(normalizeCompactionThresholdPercent(50.2), 50);
  assert.equal(normalizeCompactionThresholdPercent(94.6), 95);
});

test('clamp rounds and clamps numeric input', () => {
  assert.equal(clampCompactionThresholdPercent(50), 50);
  assert.equal(clampCompactionThresholdPercent(95), 95);
  assert.equal(clampCompactionThresholdPercent(49), 50);
  assert.equal(clampCompactionThresholdPercent(96), 95);
  assert.equal(clampCompactionThresholdPercent(85.5), 86);
});

test('ratio conversion', () => {
  assert.equal(compactionPercentToRatio(50), 0.5);
  assert.equal(compactionPercentToRatio(85), 0.85);
  assert.equal(compactionPercentToRatio(95), 0.95);
  // clamped inputs
  assert.equal(compactionPercentToRatio(10), 0.5);
  assert.equal(compactionPercentToRatio(200), 0.95);
});

test('defaults are as spec', () => {
  assert.equal(COMPACTION_THRESHOLD_MIN, 50);
  assert.equal(COMPACTION_THRESHOLD_MAX, 95);
  assert.equal(COMPACTION_THRESHOLD_DEFAULT, 85);
});
