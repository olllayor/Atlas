import assert from 'node:assert/strict';
import test from 'node:test';

import type { JobSnapshotView } from '../src/shared/contracts';
import { jobGlyph, jobTaskRows } from '../src/renderer/components/workbench/jobsSectionModel';

function job(overrides: Partial<JobSnapshotView> = {}): JobSnapshotView {
  return {
    id: 'bash-1',
    kind: 'bash',
    label: 'pnpm build',
    conversationId: 'conv-1',
    status: 'running',
    startedAt: 1_000,
    ...overrides
  };
}

const NOW = 10_000;

test('live jobs map to the running glyph, failures to failed, settled to success', () => {
  assert.equal(jobGlyph('running'), 'running');
  assert.equal(jobGlyph('stopping'), 'running');
  assert.equal(jobGlyph('completed'), 'success');
  assert.equal(jobGlyph('killed'), 'success');
  assert.equal(jobGlyph('failed'), 'failed');
});

test('rows are live-first with kind label and stop availability', () => {
  const rows = jobTaskRows(
    [
      job({ id: 'bash-done', status: 'completed', startedAt: 100, finishedAt: 200 }),
      job({ id: 'bash-live', status: 'running', startedAt: 300 })
    ],
    NOW
  );

  assert.deepEqual(rows.map((r) => r.id), ['bash-live', 'bash-done']);
  assert.equal(rows[0].killable, true);
  assert.equal(rows[0].kindLabel, 'Job');
  assert.equal(rows[0].glyph, 'running');
  assert.equal(rows[1].killable, false);
  assert.equal(rows[1].glyph, 'success');
});

test('status text prefers producer detail, else status + elapsed', () => {
  const [failed] = jobTaskRows(
    [job({ status: 'failed', detail: 'exit code: 3', startedAt: 1_000, finishedAt: 4_000 })],
    NOW
  );
  assert.equal(failed.statusText, 'exit code: 3');
  assert.equal(failed.statusClass, 'text-error');

  const [running] = jobTaskRows([job({ startedAt: 1_000 })], 1_000 + 7_000);
  assert.equal(running.statusText, 'Running · 7s');
});

test('long labels are truncated to the shared budget', () => {
  const [row] = jobTaskRows([job({ label: 'x'.repeat(120) })], NOW);
  assert.equal(row.label.length, 80 + 3);
  assert.ok(row.label.endsWith('[…]'));
});

test('live stream jobs carry at most two tail lines; settled jobs none', () => {
  const rows = jobTaskRows(
    [
      job({ id: 'bash-live', status: 'running', tail: ['l1', 'l2', 'l3'] }),
      job({ id: 'bash-quiet', status: 'running' }),
      job({ id: 'bash-done', status: 'completed', finishedAt: 2_000, tail: ['stale'] })
    ],
    NOW
  );

  const live = rows.find((r) => r.id === 'bash-live')!;
  assert.deepEqual(live.tail, ['l2', 'l3']);

  assert.equal(rows.find((r) => r.id === 'bash-quiet')!.tail, undefined);
  // A settled snapshot must not keep a stale preview alive.
  assert.equal(rows.find((r) => r.id === 'bash-done')!.tail, undefined);
});
