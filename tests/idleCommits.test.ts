import assert from 'node:assert/strict';
import test from 'node:test';

import { sameLivenessMap, type LivenessState } from '../src/renderer/lib/livenessMap.js';
import { countRunningAgents } from '../src/renderer/lib/agentActivity.js';
import type { WorkLogEntry } from '../src/shared/contracts.js';

/**
 * The window polls background liveness every two seconds forever. These pin the
 * comparison that decides whether a poll is allowed to become a render.
 */

function livenessMap(entries: Record<string, LivenessState>) {
  return new Map(Object.entries(entries));
}

test('an unchanged liveness reading is recognised as unchanged', () => {
  const before = livenessMap({ c1: 'working', c2: null });
  const after = livenessMap({ c1: 'working', c2: null });

  assert.equal(before === after, false, 'the poll always builds a fresh Map');
  assert.equal(sameLivenessMap(before, after), true, 'and it must still be seen as unchanged');
});

test('a changed reading is not swallowed', () => {
  const before = livenessMap({ c1: 'working' });

  assert.equal(sameLivenessMap(before, livenessMap({ c1: 'monitoring' })), false);
  assert.equal(sameLivenessMap(before, livenessMap({ c1: 'working', c2: 'working' })), false);
  assert.equal(sameLivenessMap(before, livenessMap({})), false);
  // Same size, different keys: the loop has to check membership, not just count.
  assert.equal(sameLivenessMap(before, livenessMap({ c2: 'working' })), false);
});

test('the agent count only moves when an agent starts or settles', () => {
  const running = (status: string): WorkLogEntry =>
    ({ status, payload: { agentKind: 'agent' } }) as unknown as WorkLogEntry;

  assert.equal(countRunningAgents(undefined), 0);
  assert.equal(countRunningAgents([]), 0);
  assert.equal(countRunningAgents([running('running'), running('pending_approval')]), 2);
  assert.equal(countRunningAgents([running('complete'), running('failed')]), 0);
  // A tool row is not an agent row, however busy it looks.
  assert.equal(
    countRunningAgents([{ status: 'running', payload: { agentKind: 'tool' } } as unknown as WorkLogEntry]),
    0
  );
});

test('idle agents never pin the live badge', () => {
  const row = (payloadStatus: string): WorkLogEntry =>
    ({ status: 'running', payload: { agentKind: 'agent', status: payloadStatus } }) as unknown as WorkLogEntry;

  assert.equal(countRunningAgents([row('idle')]), 0);
  assert.equal(countRunningAgents([row('running'), row('idle')]), 1);
  assert.equal(countRunningAgents([row('waiting'), row('pending')]), 2);
});
