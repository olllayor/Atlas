import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationSummary } from '../src/shared/contracts';
import {
  buildSidebarConversationItems,
  floatUnsettledSidebarItems,
  formatSettledSectionLabel,
  formatShelfSectionLabel,
  resolveSidebarRowVariant,
  splitSettledSidebarItems,
  splitSnoozedSidebarItems,
  type SidebarConversationItem,
} from '../src/renderer/components/sidebarViewModel';
import {
  effectiveSnoozed,
  formatSnoozeClockLabel,
  resolveSnoozePresets,
  isTimerWoken,
  snoozeWakeLabel,
} from '../src/renderer/lib/snooze';

function item(overrides: Partial<SidebarConversationItem> & Pick<SidebarConversationItem, 'id'>): SidebarConversationItem {
  return {
    projectId: null,
    isRunning: false,
    isFailed: false,
    status: 'idle',
    attention: 'idle',
    unreadCount: 0,
    primaryLabel: overrides.id,
    secondaryLabel: null,
    timestampLabel: null,
    timestampMs: null,
    workspaceMode: null,
    modelId: null,
    changeStats: { fileCount: 0, linesAdded: 0, linesRemoved: 0 },
    pinnedAt: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const future = (ms: number) => new Date(NOW + ms).toISOString();
const past = (ms: number) => new Date(NOW - ms).toISOString();

test('settled chats move to the shelf newest-parked first, pins stay put', () => {
  const { settled, rest } = splitSettledSidebarItems([
    item({ id: 'active' }),
    item({ id: 'old-settled', settledAt: '2026-09-01T00:00:00.000Z' }),
    item({ id: 'new-settled', settledAt: '2026-09-02T00:00:00.000Z' }),
    item({ id: 'pinned-settled', settledAt: '2026-09-02T12:00:00.000Z', pinnedAt: '2026-08-01T00:00:00.000Z' }),
  ]);

  assert.deepEqual(
    settled.map((entry) => entry.id),
    ['new-settled', 'old-settled']
  );
  assert.deepEqual(
    rest.map((entry) => entry.id),
    ['active', 'pinned-settled']
  );
});

test('snoozed shelf holds future wakes soonest-first, approvals and past wakes stay', () => {
  const approval = {
    approvalId: 'ap',
    requestId: 'rq',
    toolName: 'bash',
    verb: 'Approve command',
    subject: 'pnpm test',
  };
  const { snoozed, rest } = splitSnoozedSidebarItems(
    [
      item({ id: 'active' }),
      item({ id: 'later', snoozedUntil: future(7200_000) }),
      item({ id: 'sooner', snoozedUntil: future(3600_000) }),
      item({ id: 'woken', snoozedUntil: past(1000) }),
      item({ id: 'broken', snoozedUntil: 'not-a-date' }),
      item({ id: 'approval', snoozedUntil: future(3600_000), attention: 'needsInput', pendingApproval: approval }),
      item({ id: 'failed', snoozedUntil: future(3600_000), attention: 'needsInput', isFailed: true }),
    ],
    NOW
  );

  assert.deepEqual(
    snoozed.map((entry) => entry.id),
    ['sooner', 'failed', 'later']
  );
  assert.deepEqual(
    rest.map((entry) => entry.id),
    ['active', 'woken', 'broken', 'approval']
  );
});

test('unsettled chats float above the list without disturbing the rest', () => {
  const ordered = floatUnsettledSidebarItems([
    item({ id: 'a' }),
    item({ id: 'b', unsettledAt: '2026-09-01T00:00:00.000Z' }),
    item({ id: 'c' }),
    item({ id: 'd', unsettledAt: '2026-09-02T00:00:00.000Z' }),
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ['d', 'b', 'a', 'c']
  );
});

test('shelf labels show counts only while collapsed', () => {
  assert.equal(formatShelfSectionLabel('Archived', { expanded: true, count: 4 }), 'Archived');
  assert.equal(formatShelfSectionLabel('Archived', { expanded: false, count: 4 }), 'Archived (4)');
  assert.equal(formatShelfSectionLabel('Snoozed', { expanded: false, count: 0 }), 'Snoozed');
  assert.equal(formatSettledSectionLabel({ expanded: false, count: 2 }), 'Settled (2)');
});

test('parked rows render slim, live rows render cards', () => {
  assert.equal(resolveSidebarRowVariant('settled'), 'slim');
  assert.equal(resolveSidebarRowVariant('snoozed'), 'slim');
  assert.equal(resolveSidebarRowVariant('archived'), 'slim');
  assert.equal(resolveSidebarRowVariant({ settled: true }), 'slim');
  assert.equal(resolveSidebarRowVariant({ snoozed: true }), 'slim');
  assert.equal(resolveSidebarRowVariant('pinned'), 'card');
  assert.equal(resolveSidebarRowVariant('project'), 'card');
  assert.equal(resolveSidebarRowVariant('recents'), 'card');
  assert.equal(resolveSidebarRowVariant({}), 'card');
});

test('built items carry lifecycle fields and tolerate pre-column summaries', () => {
  const summary = {
    id: 'a',
    title: 'Test',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    projectId: null,
    status: 'idle',
    settledAt: '2026-09-02T12:00:00.000Z',
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
  } as ConversationSummary;
  const [built] = buildSidebarConversationItems({ conversations: [summary], draftsByConversation: {}, now: NOW });
  assert.equal(built?.settledAt, '2026-09-02T12:00:00.000Z');
  assert.equal(built?.snoozedUntil, null);

  const legacy = { ...summary, settledAt: undefined, snoozedUntil: undefined } as unknown as ConversationSummary;
  const [tolerant] = buildSidebarConversationItems({
    conversations: [legacy],
    draftsByConversation: {},
    now: NOW,
  });
  assert.equal(tolerant?.settledAt, null);
  assert.equal(tolerant?.unsettledAt, null);
  assert.equal(tolerant?.snoozedUntil, null);
  assert.equal(tolerant?.snoozedAt, null);
});

test('snooze presets adapt to the clock', () => {
  const morning = resolveSnoozePresets(new Date('2026-09-03T09:00:00'));
  assert.ok(morning.some((preset) => preset.id === 'evening'));
  assert.ok(morning.every((preset) => Date.parse(preset.snoozedUntil) > Date.parse('2026-09-03T09:00:00')));

  const late = resolveSnoozePresets(new Date('2026-09-03T17:30:00'));
  assert.ok(!late.some((preset) => preset.id === 'evening'));

  // Sunday: Tomorrow and Next week land on the same Monday, so one is offered.
  const sunday = resolveSnoozePresets(new Date('2026-09-06T10:00:00'));
  const ids = sunday.map((preset) => preset.id);
  assert.ok(!(ids.includes('tomorrow') && ids.includes('next-week')));
  assert.equal(new Set(sunday.map((preset) => preset.snoozedUntil)).size, sunday.length);
});

test('wake labels stay compact and never read 0m while hidden', () => {
  assert.equal(snoozeWakeLabel(new Date(NOW + 30_000).toISOString(), NOW), '1m');
  assert.equal(snoozeWakeLabel(new Date(NOW + 2 * 3600_000).toISOString(), NOW), '2h');
  assert.equal(snoozeWakeLabel(new Date(NOW + 3 * 86400_000).toISOString(), NOW), '3d');
  assert.equal(snoozeWakeLabel(new Date(NOW - 1000).toISOString(), NOW), 'now');
});

test('snooze clock label names the wake time for the confirmation toast', () => {
  const clock = formatSnoozeClockLabel(future(3600_000));
  assert.ok(clock && clock.includes(':'));
  assert.equal(formatSnoozeClockLabel('not-a-date'), null);
});
test('snooze visibility needs a future wake and no pending approval', () => {
  const wake = future(3600_000);
  assert.equal(effectiveSnoozed({ snoozedUntil: wake, hasPendingApproval: false }, NOW), true);
  assert.equal(
    effectiveSnoozed({ snoozedUntil: wake, hasPendingApproval: true }, NOW),
    false
  );
  assert.equal(effectiveSnoozed({ snoozedUntil: past(1000), hasPendingApproval: false }, NOW), false);
  assert.equal(effectiveSnoozed({ snoozedUntil: 'not-a-date', hasPendingApproval: false }, NOW), false);
  assert.equal(effectiveSnoozed({ snoozedUntil: null, hasPendingApproval: false }, NOW), false);
});

test('snoozed thread completion lifts snooze early', () => {
  const snoozeTime = '2026-09-03T10:00:00.000Z';
  const completeTime = '2026-09-03T10:05:00.000Z';
  const beforeSnooze = '2026-09-03T09:55:00.000Z';

  // Completed before snooze: stays snoozed
  assert.equal(
    effectiveSnoozed(
      { snoozedUntil: future(3600_000), hasPendingApproval: false, snoozedAt: snoozeTime, completedAt: beforeSnooze },
      NOW
    ),
    true
  );

  // Completed after snooze: raises early (effectiveSnoozed === false)
  assert.equal(
    effectiveSnoozed(
      { snoozedUntil: future(3600_000), hasPendingApproval: false, snoozedAt: snoozeTime, completedAt: completeTime },
      NOW
    ),
    false
  );
});

test('isTimerWoken detects elapsed snoozes until dismissed or settled', () => {
  const wakePast = past(5000);
  const wakeFuture = future(3600_000);

  // Future snooze is not woken
  assert.equal(isTimerWoken({ snoozedUntil: wakeFuture }, NOW), false);

  // Past snooze is woken
  assert.equal(isTimerWoken({ snoozedUntil: wakePast }, NOW), true);

  // Dismissed woken is not woken
  assert.equal(isTimerWoken({ snoozedUntil: wakePast, isDismissed: true }, NOW), false);

  // Settled chat is not woken
  assert.equal(isTimerWoken({ snoozedUntil: wakePast, settledAt: past(1000) }, NOW), false);
});
