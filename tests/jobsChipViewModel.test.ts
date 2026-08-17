import assert from 'node:assert/strict';
import test from 'node:test';

import type { JobSnapshotView } from '../src/shared/contracts';
import {
  activeJobCount,
  jobElapsedLabel,
  jobIsKillable,
  jobRowView,
  jobsChipLabel,
  jobsChipVisible,
  jobStatusLabel,
  sortJobsForDisplay
} from '../src/renderer/components/workspace/jobsChipViewModel';

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

test('the chip is hidden when the conversation owns no jobs', () => {
  assert.equal(jobsChipVisible([]), false);
  assert.equal(jobsChipVisible([job()]), true);
});

test('activeJobCount counts only running and stopping jobs', () => {
  const jobs = [
    job({ id: 'bash-1', status: 'running' }),
    job({ id: 'bash-2', status: 'stopping' }),
    job({ id: 'bash-3', status: 'completed' }),
    job({ id: 'bash-4', status: 'killed' }),
    job({ id: 'bash-5', status: 'failed' })
  ];

  assert.equal(activeJobCount(jobs), 2);
});

test('the chip label shows active/total while live, total once settled', () => {
  assert.equal(jobsChipLabel([job({ status: 'running' })]), '1/1');
  assert.equal(
    jobsChipLabel([job({ status: 'running' }), job({ id: 'bash-2', status: 'completed' })]),
    '1/2'
  );
  assert.equal(jobsChipLabel([job({ status: 'completed' })]), '1');
});

test('every status maps to a human label', () => {
  assert.equal(jobStatusLabel('running'), 'Running');
  assert.equal(jobStatusLabel('stopping'), 'Stopping');
  assert.equal(jobStatusLabel('completed'), 'Completed');
  assert.equal(jobStatusLabel('killed'), 'Stopped');
  assert.equal(jobStatusLabel('failed'), 'Failed');
});

test('only live jobs are killable', () => {
  assert.equal(jobIsKillable('running'), true);
  assert.equal(jobIsKillable('stopping'), true);
  assert.equal(jobIsKillable('completed'), false);
  assert.equal(jobIsKillable('killed'), false);
  assert.equal(jobIsKillable('failed'), false);
});

test('elapsed time counts against now while live and freezes once settled', () => {
  const live = job({ startedAt: 1_000 });
  assert.equal(jobElapsedLabel(live, 1_000 + 5_000), '5s');
  assert.equal(jobElapsedLabel(live, 1_000 + 65_000), '1m 5s');
  assert.equal(jobElapsedLabel(live, 1_000 + 3_660_000), '1h 1m');

  const settled = job({ startedAt: 1_000, finishedAt: 1_000 + 9_000 });
  // A later `now` must not move a settled job's clock.
  assert.equal(jobElapsedLabel(settled, 999_999_999), '9s');
});

test('the row subtitle prefers the producer detail over elapsed time', () => {
  const withDetail = job({ status: 'failed', detail: 'exit code: 3', finishedAt: 2_000 });
  assert.equal(jobRowView(withDetail, 5_000).subtitle, 'exit code: 3');

  const withoutDetail = job({ startedAt: 1_000 });
  assert.equal(jobRowView(withoutDetail, 1_000 + 7_000).subtitle, '7s');
});

test('display sort puts live jobs first, then most recently active', () => {
  const jobs = [
    job({ id: 'bash-1', status: 'completed', startedAt: 100, finishedAt: 200 }),
    job({ id: 'bash-2', status: 'running', startedAt: 300 }),
    job({ id: 'bash-3', status: 'completed', startedAt: 400, finishedAt: 500 }),
    job({ id: 'bash-4', status: 'running', startedAt: 600 })
  ];

  const sorted = sortJobsForDisplay(jobs).map((j) => j.id);
  assert.deepEqual(sorted, ['bash-4', 'bash-2', 'bash-3', 'bash-1']);
});

test('display sort does not mutate its input', () => {
  const jobs = [
    job({ id: 'bash-1', status: 'completed', finishedAt: 200 }),
    job({ id: 'bash-2', status: 'running' })
  ];

  sortJobsForDisplay(jobs);
  assert.deepEqual(jobs.map((j) => j.id), ['bash-1', 'bash-2']);
});
