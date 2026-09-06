import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatTiming } from '../src/shared/subagentFormat';

const active = (ms: number) => ({ active: { since: 0, through: ms } });

describe('formatTiming', () => {
  it('keeps sub-minute shapes', () => {
    assert.equal(formatTiming(active(500)), '500ms');
    assert.equal(formatTiming(active(5_000)), '5s');
    assert.equal(formatTiming(active(65_000)), '1m 5s');
  });

  it('shows hours for long runs', () => {
    assert.equal(formatTiming(active(3_600_000)), '1h');
    assert.equal(formatTiming(active(3_660_000)), '1h 1m');
    assert.equal(formatTiming(active(3_601_000)), '1h 1s');
    assert.equal(formatTiming(active(3_661_000)), '1h 1m 1s');
    assert.equal(formatTiming(active(90_061_000)), '25h 1m 1s');
  });

  it('formats settled durations the same way, with an em dash for zero', () => {
    assert.equal(formatTiming({ settledMs: 0 }), '—');
    assert.equal(formatTiming({ settledMs: 90_000 }), '1m 30s');
    assert.equal(formatTiming({ settledMs: 5_400_000 }), '1h 30m');
  });
});
