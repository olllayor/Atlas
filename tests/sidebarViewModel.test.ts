import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ConversationChangeStats,
  ConversationSummary,
  ModelSummary,
  WorkspaceProject,
} from '../src/shared/contracts';
import {
  buildSidebarConversationItems,
  formatChangeCount,
  formatConversationChangeStats,
  formatHomeRelativePath,
  formatSettledSectionLabel,
  resolveModelDisplayLabel,
  resolveSidebarRowVariant,
  sortProjectsByPin,
  splitPinnedSidebarItems,
  type SidebarConversationItem,
} from '../src/renderer/components/sidebarViewModel';

function modelSummary(overrides: Partial<ModelSummary> & Pick<ModelSummary, 'id'>): ModelSummary {
  return {
    providerId: 'openrouter',
    label: overrides.id,
    contextWindow: null,
    isFree: false,
    supportsVision: null,
    supportsDocumentInput: null,
    supportsTools: null,
    archived: false,
    ...overrides,
  } as ModelSummary;
}

test('names a model from the catalog rather than from its id', () => {
  const catalog = [modelSummary({ id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' })];
  assert.equal(resolveModelDisplayLabel('deepseek/deepseek-v4-flash', catalog), 'DeepSeek V4 Flash');
});

test('falls back to the id segment when the catalog carries no separate label', () => {
  const catalog = [modelSummary({ id: 'vendor/some-model:free', label: 'vendor/some-model:free' })];
  assert.equal(resolveModelDisplayLabel('vendor/some-model:free', catalog), 'some-model');
});

test('says nothing about a model the catalog does not know', () => {
  assert.equal(resolveModelDisplayLabel('vendor/retired-model', []), null);
  assert.equal(resolveModelDisplayLabel(null, []), null);
});

test('collapses a macOS home prefix to ~', () => {
  assert.equal(formatHomeRelativePath('/Users/ada/Code/Projects/Atlas'), '~/Code/Projects/Atlas');
});

test('collapses a Linux home prefix to ~', () => {
  assert.equal(formatHomeRelativePath('/home/ada/src/atlas'), '~/src/atlas');
});

test('collapses a Windows home prefix to ~', () => {
  assert.equal(formatHomeRelativePath('C:\\Users\\ada\\src\\atlas'), '~\\src\\atlas');
});

test('renders the home directory itself as ~', () => {
  assert.equal(formatHomeRelativePath('/Users/ada'), '~');
});

test('leaves roots outside a home directory untouched', () => {
  assert.equal(formatHomeRelativePath('/opt/src/atlas'), '/opt/src/atlas');
  assert.equal(formatHomeRelativePath('/Volumes/Work/atlas'), '/Volumes/Work/atlas');
});

test('does not collapse a path that merely starts with the same letters', () => {
  assert.equal(formatHomeRelativePath('/UsersData/atlas'), '/UsersData/atlas');
});

function stats(
  fileCount: number,
  linesAdded = 0,
  linesRemoved = 0
): ConversationChangeStats {
  return { fileCount, linesAdded, linesRemoved };
}

function item(id: string, pinnedAt: string | null): SidebarConversationItem {
  return {
    id,
    projectId: null,
    isRunning: false,
    isFailed: false,
    status: 'idle',
    attention: 'idle',
    unreadCount: 0,
    primaryLabel: id,
    secondaryLabel: null,
    timestampLabel: null,
    timestampMs: null,
    workspaceMode: null,
    modelId: null,
    changeStats: stats(0),
    pinnedAt,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
  };
}

function summary(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: 'c1',
    title: 'Chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastMessagePreview: null,
    lastUserMessagePreview: null,
    lastAssistantMessagePreview: null,
    lastMessageAt: null,
    defaultProviderId: null,
    defaultModelId: null,
    workspaceMode: 'code',
    projectId: null,
    toolPermissionMode: 'ask',
    changeStats: stats(0),
    pinnedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function project(id: string, pinnedAt: string | null): WorkspaceProject {
  return {
    id,
    title: id,
    root: `/Users/ada/${id}`,
    exists: true,
    isGitRepository: false,
    branch: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    pinnedAt,
  };
}

test('pinned chats leave the main list and sort newest pin first', () => {
  const { pinned, rest } = splitPinnedSidebarItems([
    item('a', '2026-01-01T00:00:00.000Z'),
    item('b', null),
    item('c', '2026-02-01T00:00:00.000Z'),
  ]);

  assert.deepEqual(pinned.map((entry) => entry.id), ['c', 'a']);
  // Moved, not copied: one row per chat, or the same title reads twice.
  assert.deepEqual(rest.map((entry) => entry.id), ['b']);
});

test('pinned projects float up while the unpinned keep their given order', () => {
  const ordered = sortProjectsByPin([
    project('recent', null),
    project('older', null),
    project('kept', '2026-01-01T00:00:00.000Z'),
    project('kept-later', '2026-03-01T00:00:00.000Z'),
  ]);

  assert.deepEqual(ordered.map((entry) => entry.id), ['kept-later', 'kept', 'recent', 'older']);
});

test('a chat that touched nothing has no stats label at all', () => {
  // Not `0 files`: that row would render on every chat that only ever answered
  // a question, which is the state most chats are in.
  assert.equal(formatConversationChangeStats(stats(0)), null);
  assert.equal(formatConversationChangeStats(stats(0, 12, 3)), null);
  assert.equal(formatConversationChangeStats(null), null);
});

test('formats a diff as files plus a signed pair', () => {
  assert.deepEqual(formatConversationChangeStats(stats(12, 240, 18)), {
    files: '12 files',
    added: '+240',
    removed: '−18',
    detail: '12 files changed, 240 lines added, 18 removed',
  });
});

test('keeps the numeral on a single file and pluralises above it', () => {
  assert.equal(formatConversationChangeStats(stats(1, 9, 2))?.files, '1 file');
  assert.equal(formatConversationChangeStats(stats(2, 9, 2))?.files, '2 files');
});

test('drops a side of the diff that is zero rather than printing −0', () => {
  const added = formatConversationChangeStats(stats(3, 40, 0));
  assert.equal(added?.added, '+40');
  assert.equal(added?.removed, null);

  const removed = formatConversationChangeStats(stats(3, 0, 40));
  assert.equal(removed?.added, null);
  assert.equal(removed?.removed, '−40');
});

test('renders files alone when nothing recorded a line count', () => {
  assert.deepEqual(formatConversationChangeStats(stats(3)), {
    files: '3 files',
    added: null,
    removed: null,
    detail: '3 files changed',
  });
});

test('compacts line counts past four digits and keeps the exact number in detail', () => {
  assert.equal(formatChangeCount(0), '0');
  assert.equal(formatChangeCount(240), '240');
  assert.equal(formatChangeCount(1_204), '1,204');
  assert.equal(formatChangeCount(9_999), '9,999');
  assert.equal(formatChangeCount(10_000), '10k');
  assert.equal(formatChangeCount(12_480), '12.5k');
  assert.equal(formatChangeCount(124_300), '124k');
  assert.equal(formatChangeCount(999_500), '1M');
  assert.equal(formatChangeCount(1_400_000), '1.4M');

  assert.equal(
    formatConversationChangeStats(stats(12, 12_480, 9_812))?.detail,
    '12 files changed, 12,480 lines added, 9,812 removed'
  );
});

test('a malformed count degrades to zero instead of NaN', () => {
  assert.equal(formatChangeCount(Number.NaN), '0');
  assert.equal(formatChangeCount(-5), '0');
  assert.equal(formatConversationChangeStats(stats(2, Number.NaN, -1))?.added, null);
});

test('the view model carries change stats through from the summary', () => {
  const [built] = buildSidebarConversationItems({
    conversations: [summary({ changeStats: stats(12, 240, 18) })],
    draftsByConversation: {},
    now: Date.parse('2026-01-01T00:00:00.000Z'),
  });

  assert.deepEqual(built.changeStats, { fileCount: 12, linesAdded: 240, linesRemoved: 18 });
});

test('a summary cached before the column existed reads as zeros', () => {
  const legacy = summary();
  // The contract promises the field, but a persisted row from an older build
  // does not — and `undefined files` is the one thing the card must never say.
  delete (legacy as Partial<ConversationSummary>).changeStats;

  const [built] = buildSidebarConversationItems({
    conversations: [legacy],
    draftsByConversation: {},
    now: Date.parse('2026-01-01T00:00:00.000Z'),
  });

  assert.deepEqual(built.changeStats, { fileCount: 0, linesAdded: 0, linesRemoved: 0 });
  assert.equal(formatConversationChangeStats(built.changeStats), null);
});

test('sorting projects by pin does not mutate the input', () => {
  const input = [project('a', null), project('b', '2026-01-01T00:00:00.000Z')];
  sortProjectsByPin(input);
  assert.deepEqual(input.map((entry) => entry.id), ['a', 'b']);
});

test('row variant selection: archived resolves to slim, every other section to card', () => {
  assert.equal(resolveSidebarRowVariant('archived'), 'slim');
  assert.equal(resolveSidebarRowVariant({ archived: true }), 'slim');
  assert.equal(resolveSidebarRowVariant('pinned'), 'card');
  assert.equal(resolveSidebarRowVariant('project'), 'card');
  assert.equal(resolveSidebarRowVariant('recents'), 'card');
  assert.equal(resolveSidebarRowVariant({ archived: false }), 'card');
  assert.equal(resolveSidebarRowVariant({}), 'card');
  assert.equal(resolveSidebarRowVariant(undefined), 'card');
});

test('Settled header label: collapsed renders count, expanded does not, neither renders trailing space', () => {
  // Collapsed with count renders count
  assert.equal(formatSettledSectionLabel({ expanded: false, count: 5 }), 'Settled (5)');
  assert.equal(formatSettledSectionLabel({ expanded: false, count: 1 }), 'Settled (1)');

  // Expanded with count renders bare label without count
  assert.equal(formatSettledSectionLabel({ expanded: true, count: 5 }), 'Settled');

  // With count 0 or negative, collapsed and expanded render clean Settled without count
  assert.equal(formatSettledSectionLabel({ expanded: false, count: 0 }), 'Settled');
  assert.equal(formatSettledSectionLabel({ expanded: true, count: 0 }), 'Settled');
  assert.equal(formatSettledSectionLabel({ expanded: false, count: -1 }), 'Settled');

  // Verify no trailing space in any branch
  assert.ok(!formatSettledSectionLabel({ expanded: false, count: 0 }).endsWith(' '));
  assert.ok(!formatSettledSectionLabel({ expanded: true, count: 5 }).endsWith(' '));
  assert.ok(!formatSettledSectionLabel({ expanded: false, count: 5 }).endsWith(' '));
});
