import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoOpenedKey,
  browserViewKey,
  findNewServers,
  resetDevServerAutoOpened,
} from '../src/renderer/hooks/useDevServerAutoOpen.js';

const server = (port: number) => ({
  url: `http://localhost:${port}`,
  port,
  command: 'vite' as const,
});

test('a null baseline opens nothing: the first scan only learns what is already there', () => {
  assert.deepEqual(findNewServers(null, [server(5173), server(3000)]), []);
});

test('only arrivals count — baseline ports never re-fire', () => {
  const known = new Set([5173]);
  assert.deepEqual(
    findNewServers(known, [server(5173), server(3000)]).map((entry) => entry.port),
    [3000]
  );
});

test('nothing new means no toast and no tab', () => {
  assert.deepEqual(findNewServers(new Set([5173]), [server(5173)]), []);
});

test('an empty machine that starts serving is one arrival', () => {
  assert.deepEqual(
    findNewServers(new Set(), [server(5173)]).map((entry) => entry.port),
    [5173]
  );
});

test('view keys match WorkbenchPanel: conversation plus view', () => {
  assert.equal(browserViewKey('conv-1', 'view-2'), 'conv-1:view-2');
});

test('once-per-port keys are scoped to the conversation', () => {
  assert.equal(autoOpenedKey('conv-1', 5173), 'conv-1:5173');
  assert.notEqual(autoOpenedKey('conv-1', 5173), autoOpenedKey('conv-2', 5173));
});

test('reset helper exists so tests never leak handled ports', () => {
  resetDevServerAutoOpened();
  assert.ok(true);
});
