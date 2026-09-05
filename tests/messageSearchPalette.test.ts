import assert from 'node:assert/strict';
import test from 'node:test';

import { MESSAGE_SEARCH_MATCH_CLOSE, MESSAGE_SEARCH_MATCH_OPEN } from '../src/shared/contracts';
import type { MessageSearchHit } from '../src/shared/contracts';
import {
  createPaletteFilter,
  INITIAL_MESSAGE_SEARCH_STATE,
  MESSAGE_HIT_SCORE,
  messageHitValue,
  messageSearchReducer,
  shouldSearchMessages,
  splitSnippetSegments,
  visibleHits,
} from '../src/renderer/hooks/useMessageSearch';
import type { MessageSearchState } from '../src/renderer/hooks/useMessageSearch';

function hit(overrides: Partial<MessageSearchHit> = {}): MessageSearchHit {
  return {
    conversationId: 'conv-1',
    conversationTitle: 'Migration notes',
    messageId: 'msg-1',
    role: 'user',
    snippet: 'a snippet',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    ...overrides,
  };
}

test('shouldSearchMessages refuses empty, blank and one-character queries', () => {
  assert.equal(shouldSearchMessages(''), false);
  assert.equal(shouldSearchMessages('   '), false);
  assert.equal(shouldSearchMessages('\n\t '), false);
  assert.equal(shouldSearchMessages('a'), false);
  assert.equal(shouldSearchMessages(' a '), false);
  assert.equal(shouldSearchMessages('ab'), true);
  assert.equal(shouldSearchMessages('  ab  '), true);
  assert.equal(shouldSearchMessages('ab', 3), false);
});

test('a stale response never overwrites a newer one', () => {
  let state = messageSearchReducer(INITIAL_MESSAGE_SEARCH_STATE, {
    type: 'request',
    query: 'mi',
    requestId: 1,
  });
  state = messageSearchReducer(state, { type: 'request', query: 'migra', requestId: 2 });

  // Request 1 finishes last, as a slower query legitimately can.
  const withNewest = messageSearchReducer(state, {
    type: 'resolve',
    requestId: 2,
    hits: [hit({ messageId: 'new' })],
  });
  const afterStale = messageSearchReducer(withNewest, {
    type: 'resolve',
    requestId: 1,
    hits: [hit({ messageId: 'old' })],
  });

  assert.deepEqual(
    afterStale.hits.map((entry) => entry.messageId),
    ['new']
  );
  assert.equal(afterStale.status, 'ready');
});

test('a stale rejection does not blank out a settled newer response', () => {
  let state = messageSearchReducer(INITIAL_MESSAGE_SEARCH_STATE, {
    type: 'request',
    query: 'mi',
    requestId: 4,
  });
  state = messageSearchReducer(state, { type: 'request', query: 'migr', requestId: 5 });
  state = messageSearchReducer(state, { type: 'resolve', requestId: 5, hits: [hit()] });
  state = messageSearchReducer(state, { type: 'reject', requestId: 4 });

  assert.equal(state.status, 'ready');
  assert.equal(state.hits.length, 1);
});

test('an out-of-order request cannot roll the sequence backwards', () => {
  let state = messageSearchReducer(INITIAL_MESSAGE_SEARCH_STATE, {
    type: 'request',
    query: 'migrate',
    requestId: 9,
  });
  state = messageSearchReducer(state, { type: 'request', query: 'mi', requestId: 8 });

  assert.equal(state.query, 'migrate');
  assert.equal(state.requestId, 9);
});

test('refining a query keeps the rows on screen, changing it clears them', () => {
  let state = messageSearchReducer(INITIAL_MESSAGE_SEARCH_STATE, {
    type: 'request',
    query: 'migr',
    requestId: 1,
  });
  state = messageSearchReducer(state, { type: 'resolve', requestId: 1, hits: [hit()] });

  const refined = messageSearchReducer(state, { type: 'request', query: 'migra', requestId: 2 });
  assert.equal(refined.hits.length, 1, 'typing forward should not blink the list');
  assert.equal(refined.status, 'loading');

  const replaced = messageSearchReducer(state, { type: 'request', query: 'sqlite', requestId: 3 });
  assert.equal(replaced.hits.length, 0, 'a different question must not show the old answer');
});

test('a failure empties the section and reports error without losing the sequence', () => {
  let state = messageSearchReducer(INITIAL_MESSAGE_SEARCH_STATE, {
    type: 'request',
    query: 'migr',
    requestId: 1,
  });
  state = messageSearchReducer(state, { type: 'resolve', requestId: 1, hits: [hit()] });
  state = messageSearchReducer(state, { type: 'request', query: 'migra', requestId: 2 });
  state = messageSearchReducer(state, { type: 'reject', requestId: 2 });

  assert.equal(state.status, 'error');
  assert.deepEqual(state.hits, []);

  const reset = messageSearchReducer(state, { type: 'reset', requestId: 3 });
  assert.equal(reset.status, 'idle');
  assert.equal(reset.query, '');
  assert.equal(reset.requestId, 3, 'reset burns a sequence number rather than rewinding');
  assert.equal(
    messageSearchReducer(reset, { type: 'resolve', requestId: 2, hits: [hit()] }).hits.length,
    0,
    'a request in flight when the input was cleared must not repopulate the section'
  );
});

test('visibleHits only shows rows whose query is still a prefix of the input', () => {
  const state: MessageSearchState = {
    status: 'ready',
    query: 'migr',
    hits: [hit()],
    requestId: 1,
  };

  assert.equal(visibleHits(state, 'migr').length, 1);
  assert.equal(visibleHits(state, 'migrat').length, 1);
  assert.equal(visibleHits(state, 'mig').length, 0);
  assert.equal(visibleHits(state, 'sqlite').length, 0);
  assert.equal(visibleHits({ ...state, query: '' }, 'migr').length, 0);
});

test('splitSnippetSegments separates matched spans from plain text', () => {
  const snippet = `we ${MESSAGE_SEARCH_MATCH_OPEN}migrated${MESSAGE_SEARCH_MATCH_CLOSE} the ${MESSAGE_SEARCH_MATCH_OPEN}index${MESSAGE_SEARCH_MATCH_CLOSE} twice`;

  assert.deepEqual(splitSnippetSegments(snippet), [
    { text: 'we ', match: false },
    { text: 'migrated', match: true },
    { text: ' the ', match: false },
    { text: 'index', match: true },
    { text: ' twice', match: false },
  ]);
});

test('splitSnippetSegments handles plain, empty and unterminated snippets', () => {
  assert.deepEqual(splitSnippetSegments('nothing matched here'), [
    { text: 'nothing matched here', match: false },
  ]);
  assert.deepEqual(splitSnippetSegments(''), []);

  // A truncated snippet can end mid-highlight; the tail must still render.
  assert.deepEqual(splitSnippetSegments(`tail ${MESSAGE_SEARCH_MATCH_OPEN}open`), [
    { text: 'tail ', match: false },
    { text: 'open', match: true },
  ]);

  // A close marker with no open one is not a highlight and must not survive
  // into the DOM as a tofu box.
  assert.deepEqual(splitSnippetSegments(`stray${MESSAGE_SEARCH_MATCH_CLOSE}marker`), [
    { text: 'straymarker', match: false },
  ]);
});

test('splitSnippetSegments collapses whitespace and never produces markup', () => {
  assert.deepEqual(splitSnippetSegments('line one\nline\t\ttwo'), [
    { text: 'line one line two', match: false },
  ]);

  const hostile = `<img src=x onerror="alert(1)"> ${MESSAGE_SEARCH_MATCH_OPEN}<script>${MESSAGE_SEARCH_MATCH_CLOSE}`;
  assert.deepEqual(splitSnippetSegments(hostile), [
    { text: '<img src=x onerror="alert(1)"> ', match: false },
    { text: '<script>', match: true },
  ]);
});

test('createPaletteFilter forces server hits through and delegates everything else', () => {
  const seen: string[] = [];
  const fallback = (value: string, search: string) => {
    seen.push(value);
    return value.includes(search) ? 1 : 0;
  };
  const filter = createPaletteFilter(fallback);

  // A snippet that the fuzzy matcher would score 0 still renders.
  const hitValue = messageHitValue('conv-1', 'msg-1');
  assert.equal(filter(hitValue, 'sqlite'), MESSAGE_HIT_SCORE);
  assert.deepEqual(seen, [], 'message rows must not be re-judged client-side');

  // Commands and chat titles keep the exact behaviour they had.
  assert.equal(filter('New Chat', 'New'), 1);
  assert.equal(filter('chat:conv-1 Migration notes', 'zzz'), 0);
  assert.deepEqual(seen, ['New Chat', 'chat:conv-1 Migration notes']);

  // Low enough that any real match outranks a message row.
  assert.ok(MESSAGE_HIT_SCORE > 0 && MESSAGE_HIT_SCORE < 0.0001);
});

test('createPaletteFilter strips UUIDs before the fuzzy matcher sees them', () => {
  const seen: string[] = [];
  const fallback = (value: string) => {
    seen.push(value);
    return 0;
  };
  const filter = createPaletteFilter(fallback);

  // Chat rows embed the conversation id for uniqueness; hex fragments like
  // "beef" or "cafe" must not fuzzy-match queries it has no business
  // answering. The matcher only ever sees the title.
  filter('chat:9beef3a2-1caf-4dec-8f0d-2b7e5a1c9d33 Migration notes', 'beef');
  assert.deepEqual(seen, ['chat:  Migration notes']);

  // Non-id values pass through untouched.
  filter('New Chat', 'zzz');
  assert.deepEqual(seen, ['chat:  Migration notes', 'New Chat']);
});
