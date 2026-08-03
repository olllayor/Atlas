/**
 * Archiving used to be a one-way door: the row left the sidebar and only a
 * six-second toast could bring it back. These cover the pure half of the
 * Archived section — which rows belong in it, where a locally patched row
 * lands, and whether the section should exist at all before it has fetched.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationSummary } from '../src/shared/contracts';
import {
  hasArchivedConversations,
  mergeArchivedConversation,
  selectArchivedConversations,
} from '../src/renderer/stores/useAppStore';

function summary(id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  // Cast rather than spelled out in full: this fixture only cares about id,
  // updatedAt and archivedAt, and every unrelated field added to the contract
  // would otherwise break a test that never reads it.
  return {
    id,
    title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastMessagePreview: null,
    lastUserMessagePreview: null,
    lastAssistantMessagePreview: null,
    lastMessageAt: null,
    defaultProviderId: null,
    defaultModelId: null,
    projectId: null,
    pinnedAt: null,
    archivedAt: null,
    ...overrides,
  } as ConversationSummary;
}

test('keeps only the archived rows out of an includeArchived listing', () => {
  const rows = [
    summary('live'),
    summary('archived', { archivedAt: '2026-02-01T00:00:00.000Z' }),
    summary('also-live'),
  ];

  assert.deepEqual(
    selectArchivedConversations(rows).map((conversation) => conversation.id),
    ['archived']
  );
});

test('treats a listing with nothing archived as an empty archive', () => {
  assert.deepEqual(selectArchivedConversations([summary('a'), summary('b')]), []);
});

test('inserts a newly archived row in most-recently-updated order', () => {
  const existing = [
    summary('old', { updatedAt: '2026-01-01T00:00:00.000Z', archivedAt: '2026-01-02T00:00:00.000Z' }),
    summary('older', { updatedAt: '2025-12-01T00:00:00.000Z', archivedAt: '2026-01-02T00:00:00.000Z' }),
  ];
  const merged = mergeArchivedConversation(
    existing,
    summary('middle', { updatedAt: '2025-12-15T00:00:00.000Z', archivedAt: '2026-02-01T00:00:00.000Z' })
  );

  assert.deepEqual(
    merged.map((conversation) => conversation.id),
    ['old', 'middle', 'older']
  );
});

test('replaces a row already in the archive rather than duplicating it', () => {
  const existing = [summary('a', { updatedAt: '2026-01-01T00:00:00.000Z' })];
  const merged = mergeArchivedConversation(
    existing,
    summary('a', { title: 'renamed', updatedAt: '2026-03-01T00:00:00.000Z' })
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'renamed');
});

test('does not drop a row whose timestamp is unparseable', () => {
  const merged = mergeArchivedConversation(
    [summary('good', { updatedAt: '2026-01-01T00:00:00.000Z' })],
    summary('broken', { updatedAt: 'not-a-date' })
  );

  assert.deepEqual(
    merged.map((conversation) => conversation.id),
    ['good', 'broken']
  );
});

test('infers an archive from the gap between the stored count and the live list', () => {
  assert.equal(
    hasArchivedConversations({
      storedConversationCount: 5,
      liveConversationCount: 3,
      archivedConversationCount: 0,
      hasLoadedArchived: false,
    }),
    true
  );
});

test('hides the section when every stored chat is in the live list', () => {
  assert.equal(
    hasArchivedConversations({
      storedConversationCount: 3,
      liveConversationCount: 3,
      archivedConversationCount: 0,
      hasLoadedArchived: false,
    }),
    false
  );
});

test('hides the section before the stats have arrived', () => {
  assert.equal(
    hasArchivedConversations({
      storedConversationCount: null,
      liveConversationCount: 2,
      archivedConversationCount: 0,
      hasLoadedArchived: false,
    }),
    false
  );
});

test('prefers a completed fetch over the stored-count arithmetic', () => {
  // Stats can lag a delete performed elsewhere; once the archive has actually
  // been read, what it contains is the answer.
  assert.equal(
    hasArchivedConversations({
      storedConversationCount: 9,
      liveConversationCount: 3,
      archivedConversationCount: 0,
      hasLoadedArchived: true,
    }),
    false
  );
  assert.equal(
    hasArchivedConversations({
      storedConversationCount: 1,
      liveConversationCount: 3,
      archivedConversationCount: 2,
      hasLoadedArchived: true,
    }),
    true
  );
});
