import assert from 'node:assert/strict';
import test from 'node:test';

import type { SidebarConversationItem } from '../src/renderer/components/sidebarViewModel.js';
import {
  getActionBadge,
  getActionIntent,
  splitActivityDecks,
} from '../src/renderer/components/SidebarActivityBell.js';

function item(overrides: Partial<SidebarConversationItem> & { id: string }): SidebarConversationItem {
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
    pendingApproval: null,
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

test('splitActivityDecks puts needsInput on top, ambient in tier order, idle excluded', () => {
  const unread = item({ id: 'u', attention: 'unread', unreadCount: 1 });
  const running = item({ id: 'r', attention: 'running' });
  const idle = item({ id: 'i', attention: 'idle' });
  const action = item({ id: 'a', attention: 'needsInput' });
  const queued = item({ id: 'q', attention: 'queued' });

  const { actions, ambient } = splitActivityDecks([unread, running, idle, action, queued]);

  assert.deepEqual(actions.map((entry) => entry.id), ['a']);
  assert.deepEqual(ambient.map((entry) => entry.id), ['r', 'q', 'u']);
});

test('getActionBadge prefers failure over approval', () => {
  assert.equal(getActionBadge(item({ id: 'f', isFailed: true })), 'Failed');
  assert.equal(
    getActionBadge(
      item({
        id: 'a',
        pendingApproval: {
          approvalId: 'ap',
          requestId: 'rq',
          toolName: 'bash',
          verb: 'Approve command',
          subject: 'pnpm test',
        },
      })
    ),
    'Approval'
  );
  assert.equal(getActionBadge(item({ id: 'n' })), 'Needs Input');
});

test('getActionIntent prefers the tool snippet over the assistant preview', () => {
  const withSnippet = item({
    id: 'a',
    secondaryLabel: 'assistant preview',
    pendingApproval: {
      approvalId: 'ap',
      requestId: 'rq',
      toolName: 'bash',
      verb: 'Approve command',
      subject: 'pnpm test',
      commandSnippet: 'pnpm test',
    },
  });
  assert.equal(getActionIntent(withSnippet), 'pnpm test');

  const previewOnly = item({ id: 'b', secondaryLabel: 'which contrast?' });
  assert.equal(getActionIntent(previewOnly), 'which contrast?');

  assert.equal(getActionIntent(item({ id: 'c' })), null);
});
