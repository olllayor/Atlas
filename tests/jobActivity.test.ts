import assert from 'node:assert/strict';
import test from 'node:test';

import type { JobSnapshotView } from '../src/shared/contracts';
import {
  liveJobCountFor,
  summarizeJobsByConversation
} from '../src/renderer/lib/jobActivity';

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

test('summaries count live and total per conversation', () => {
  const map = summarizeJobsByConversation([
    job({ id: 'bash-1', conversationId: 'conv-1', status: 'running' }),
    job({ id: 'bash-2', conversationId: 'conv-1', status: 'completed', finishedAt: 2_000 }),
    job({ id: 'bash-3', conversationId: 'conv-2', status: 'stopping' }),
    job({ id: 'bash-4', conversationId: 'conv-2', status: 'failed', finishedAt: 3_000 }),
    job({ id: 'bash-5', conversationId: 'conv-2', status: 'killed', finishedAt: 4_000 })
  ]);

  assert.deepEqual(map.get('conv-1'), { live: 1, total: 2 });
  assert.deepEqual(map.get('conv-2'), { live: 1, total: 3 });
});

test('empty roster folds to an empty map', () => {
  assert.equal(summarizeJobsByConversation([]).size, 0);
});

test('settled jobs do not keep a conversation live', () => {
  const map = summarizeJobsByConversation([
    job({ status: 'completed', finishedAt: 2_000 }),
    job({ status: 'failed', finishedAt: 3_000 })
  ]);
  assert.equal(liveJobCountFor(map, 'conv-1'), 0);
});

test('liveJobCountFor is zero for conversations with no jobs', () => {
  const map = summarizeJobsByConversation([job({ conversationId: 'conv-9' })]);
  assert.equal(liveJobCountFor(map, 'conv-missing'), 0);
  assert.equal(liveJobCountFor(new Map(), 'conv-9'), 0);
});
