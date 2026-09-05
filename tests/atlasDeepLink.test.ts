import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAtlasDeepLink } from '../src/shared/atlasDeepLink.js';

test('chat routes parse into conversation opens and bare views', () => {
  assert.deepEqual(parseAtlasDeepLink('atlas://chat'), { kind: 'chat' });
  assert.deepEqual(parseAtlasDeepLink('atlas://chat/abc-123'), {
    kind: 'chat',
    conversationId: 'abc-123',
  });
});

test('chat/new with a prompt seeds a new conversation', () => {
  assert.deepEqual(parseAtlasDeepLink('atlas://chat/new?prompt=hello%20world'), {
    kind: 'chat',
    prompt: 'hello world',
  });
  // `new` without a prompt is just the chat view.
  assert.deepEqual(parseAtlasDeepLink('atlas://chat/new'), { kind: 'chat' });
});

test('a prompt alongside a conversation id seeds that conversation', () => {
  assert.deepEqual(parseAtlasDeepLink('atlas://chat/abc?prompt=fix%20it'), {
    kind: 'chat',
    conversationId: 'abc',
    prompt: 'fix it',
  });
});

test('settings routes accept only known sections', () => {
  assert.deepEqual(parseAtlasDeepLink('atlas://settings'), { kind: 'settings' });
  assert.deepEqual(parseAtlasDeepLink('atlas://settings/providers'), {
    kind: 'settings',
    section: 'providers',
  });
  assert.equal(parseAtlasDeepLink('atlas://settings/nonsense'), null);
});

test('workspace hosts route without segments', () => {
  assert.deepEqual(parseAtlasDeepLink('atlas://plugins'), { kind: 'plugins' });
  assert.deepEqual(parseAtlasDeepLink('atlas://sites'), { kind: 'sites' });
});

test('malformed and foreign links are rejected', () => {
  assert.equal(parseAtlasDeepLink('not a url'), null);
  assert.equal(parseAtlasDeepLink('https://example.com/chat/abc'), null);
  assert.equal(parseAtlasDeepLink('codex://chat/abc'), null);
  assert.equal(parseAtlasDeepLink('atlas://unknown-host'), null);
  // Ids must stay within [a-zA-Z0-9-]{1,64}: no dots or overlong ids.
  // (`../` never reaches the parser — WHATWG URL normalization collapses it
  // into a plain segment first, so traversal is not expressible here.)
  assert.equal(parseAtlasDeepLink('atlas://chat/has.dot'), null);
  const tooLong = 'a'.repeat(65);
  assert.equal(parseAtlasDeepLink(`atlas://chat/${tooLong}`), null);
  assert.deepEqual(parseAtlasDeepLink(`atlas://chat/${'a'.repeat(64)}`), {
    kind: 'chat',
    conversationId: 'a'.repeat(64),
  });
});
