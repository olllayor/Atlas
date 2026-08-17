import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SpillStore } from '../src/main/ai/tools/spill/SpillStore.js';

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-spill-test-'));
  return { root, store: new SpillStore(root) };
}

test('saveText persists content and reports path and byte length', async () => {
  const { root, store } = createStore();

  const saved = await store.saveText({
    conversationId: 'conversation-1',
    toolName: 'bash',
    content: 'line one\nline two\n'
  });

  assert.equal(saved.bytes, Buffer.byteLength('line one\nline two\n', 'utf8'));
  assert.ok(saved.path.startsWith(join(root, 'conversation-1')));
  assert.ok(saved.path.endsWith('-bash.txt'));
  assert.equal(await readFile(saved.path, 'utf8'), 'line one\nline two\n');
});

test('two saves for the same tool land in distinct files', async () => {
  const { store } = createStore();

  const first = await store.saveText({ conversationId: 'c', toolName: 'bash', content: 'a' });
  const second = await store.saveText({ conversationId: 'c', toolName: 'bash', content: 'b' });

  assert.notEqual(first.path, second.path);
});

test('hostile ids and tool names cannot escape the spill root', async () => {
  const { root, store } = createStore();

  const saved = await store.saveText({
    conversationId: '../../etc',
    toolName: 'bash/../../passwd',
    content: 'contained'
  });

  assert.ok(saved.path.startsWith(root));
  // The real invariant: no path segment is a traversal token. A `..` buried
  // inside a longer segment (`.._.._etc`) is a plain filename, not one.
  for (const segment of saved.path.slice(root.length).split('/').filter(Boolean)) {
    assert.notEqual(segment, '..');
    assert.notEqual(segment, '.');
  }
  assert.equal(await readFile(saved.path, 'utf8'), 'contained');
});

test('bare dot segments are neutralized', async () => {
  const { root, store } = createStore();

  const dot = await store.saveText({ conversationId: '.', toolName: 't', content: 'dot' });
  const dotdot = await store.saveText({ conversationId: '..', toolName: 't', content: 'dotdot' });

  assert.ok(dot.path.startsWith(join(root, '_')));
  assert.ok(dotdot.path.startsWith(join(root, '_')));
});

test('deleteConversation removes only that conversation directory', async () => {
  const { root, store } = createStore();

  await store.saveText({ conversationId: 'keep', toolName: 'bash', content: 'keep' });
  const doomed = await store.saveText({ conversationId: 'doomed', toolName: 'bash', content: 'doomed' });

  await store.deleteConversation('doomed');

  assert.equal(await readFile(join(root, 'keep', (await readdir(join(root, 'keep')))[0]), 'utf8'), 'keep');
  await assert.rejects(readFile(doomed.path));
});

test('deleteConversation on an unknown conversation is a no-op', async () => {
  const { store } = createStore();
  await store.deleteConversation('never-existed');
});

test('sweep removes stale orphan directories and keeps active ones', async () => {
  const { root, store } = createStore();

  await store.saveText({ conversationId: 'active', toolName: 'bash', content: 'active' });
  const orphan = await store.saveText({ conversationId: 'orphan', toolName: 'bash', content: 'orphan' });

  // Age the orphan past the min-age guard; the active dir stays fresh.
  const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(join(root, 'orphan'), past, past);

  await store.sweep(['active']);

  assert.ok((await readdir(root)).includes('active'));
  await assert.rejects(readFile(orphan.path));
});

test('sweep keeps unknown directories modified within the min-age window', async () => {
  const { root, store } = createStore();

  const fresh = await store.saveText({ conversationId: 'fresh-orphan', toolName: 'bash', content: 'fresh' });

  await store.sweep([]);

  assert.equal(await readFile(fresh.path, 'utf8'), 'fresh');
});

test('sweep on a missing root is a no-op', async () => {
  const store = new SpillStore(join(tmpdir(), `atlas-spill-missing-${Date.now()}`));
  await store.sweep(['anything']);
});

test('sweep leaves stray non-directory entries alone', async () => {
  const { root, store } = createStore();

  const stray = join(root, 'stray-file.txt');
  await writeFile(stray, 'not a directory');
  const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(stray, past, past);

  await store.sweep([]);

  assert.equal((await stat(stray)).isFile(), true);
});

test('saves never collide: the random prefix keeps concurrent writes distinct', async () => {
  const { root, store } = createStore();

  // The exclusive open (`wx`) is what protects against a pre-planted target;
  // its observable contract here is that two saves to the same tool produce
  // two distinct files rather than one overwriting the other.
  const first = await store.saveText({ conversationId: 'c', toolName: 't', content: '1' });
  const second = await store.saveText({ conversationId: 'c', toolName: 't', content: '2' });

  const entries = await readdir(join(root, 'c'));
  assert.equal(entries.length, 2);
  assert.notEqual(first.path, second.path);
});
