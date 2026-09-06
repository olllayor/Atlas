import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_DEFAULT_MODEL,
  chatPartsToTimelineEntries,
  getAntigravitySendBlockReason,
  shouldReleaseTimelineAnchorForToolActivity,
  type ServerProvider,
  type TimelineEntry
} from '../src/renderer/components/chat/ChatView.logic.js';

const catalogModels = [
  { id: 'gemini-pro', name: 'Gemini Pro' },
  { id: ANTIGRAVITY_DEFAULT_MODEL, name: 'Gemini 3.8 Flash (High)' }
];

function entry(
  driver: string,
  instanceId: string,
  overrides: Partial<ServerProvider> = {}
): ServerProvider {
  return {
    driver,
    instanceId,
    installed: true,
    status: 'ready',
    auth: { status: 'authenticated' },
    models: catalogModels,
    message: null,
    ...overrides
  };
}

test('lets Antigravity check saved credentials when resuming after a restart', () => {
  const provider = entry('antigravity', 'google_work', {
    status: "warning",
    auth: { status: "unknown" },
    models: []
  });

  assert.equal(getAntigravitySendBlockReason(provider, 'gemini-pro'), null);
  assert.equal(getAntigravitySendBlockReason(provider, ANTIGRAVITY_DEFAULT_MODEL), null);
  assert.equal(
    getAntigravitySendBlockReason({ ...provider, models: catalogModels }, 'gemini-pro'),
    null
  );
  assert.equal(
    getAntigravitySendBlockReason(provider, ''),
    'Choose an Antigravity model before sending.'
  );
  assert.equal(
    getAntigravitySendBlockReason(provider, '   '),
    'Choose an Antigravity model before sending.'
  );
});

test('blocks sends when Antigravity is not installed', () => {
  const provider = entry('antigravity', 'google_work', {
    installed: false,
    auth: { status: 'unknown' },
    models: []
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-pro'),
    'Install Antigravity in provider settings before sending.'
  );
});

test('blocks sends when Antigravity confirms unauthenticated status', () => {
  const provider = entry('antigravity', 'google_work', {
    status: 'warning',
    auth: { status: 'unauthenticated' },
    models: []
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-pro'),
    'Sign in to Antigravity in provider settings before sending.'
  );
});

test('blocks sends when Antigravity model catalog is empty after authentication', () => {
  const provider = entry('antigravity', 'google_work', {
    status: 'ready',
    auth: { status: 'authenticated' },
    models: []
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-pro'),
    'Refresh Antigravity models in provider settings before sending.'
  );
});

test('blocks sends when chosen model is not in Antigravity catalog unless in error state', () => {
  const provider = entry('antigravity', 'google_work', {
    status: 'ready',
    auth: { status: 'authenticated' },
    models: [{ id: 'gemini-3.8-flash-high' }]
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-3.8-flash-high'),
    null
  );
  assert.equal(
    getAntigravitySendBlockReason(provider, 'unknown-gemini-model'),
    'Model "unknown-gemini-model" is not available. Choose another model before sending.'
  );

  // In error state, keep it non-blocking because a refresh or turn startup might resolve it
  const providerInError = { ...provider, status: 'error' };
  assert.equal(getAntigravitySendBlockReason(providerInError, 'unknown-gemini-model'), null);
});

test('releases the send anchor for tool activity in the active turn', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';
  const activeToolEntry: TimelineEntry = {
    id: 'tool-entry',
    kind: 'work',
    createdAt: Date.now(),
    entry: {
      id: 'active-tool',
      createdAt: Date.now(),
      turnId: activeTurnId,
      label: 'Run command',
      tone: 'tool',
      command: 'git status'
    }
  };

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: [activeToolEntry]
    }),
    true
  );
});

test('keeps the anchor while the user reads history', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';
  const activeToolEntry: TimelineEntry = {
    id: 'tool-entry',
    kind: 'work',
    createdAt: Date.now(),
    entry: {
      id: 'active-tool',
      createdAt: Date.now(),
      turnId: activeTurnId,
      label: 'Run command',
      tone: 'tool',
      command: 'git status'
    }
  };

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: false,
      runningTurnId: activeTurnId,
      timelineEntries: [activeToolEntry]
    }),
    false
  );
});

test('ignores tool activity from earlier turns', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';
  const earlierToolEntry: TimelineEntry = {
    id: 'tool-entry',
    kind: 'work',
    createdAt: Date.now(),
    entry: {
      id: 'active-tool',
      createdAt: Date.now(),
      turnId: 'previous-turn',
      label: 'Run command',
      tone: 'tool',
      command: 'git status'
    }
  };

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: [earlierToolEntry]
    }),
    false
  );
});

test('ignores thinking and error rows without tool activity', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';
  const thinkingAndErrorEntries: TimelineEntry[] = [
    {
      id: 'thinking-entry',
      kind: 'work',
      entry: {
        id: 'thinking-entry',
        turnId: activeTurnId,
        label: 'Thinking',
        tone: 'thinking'
      }
    },
    {
      id: 'error-entry',
      kind: 'work',
      entry: {
        id: 'error-entry',
        turnId: activeTurnId,
        label: 'Provider error',
        tone: 'error'
      }
    }
  ];

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: thinkingAndErrorEntries
    }),
    false
  );
});

test('does nothing without an anchor or running turn', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';
  const activeToolEntry: TimelineEntry = {
    id: 'tool-entry',
    kind: 'work',
    entry: {
      id: 'active-tool',
      turnId: activeTurnId,
      label: 'Run command',
      tone: 'tool',
      command: 'git status'
    }
  };

  const input = {
    anchorMessageId,
    liveFollowEnabled: true,
    runningTurnId: activeTurnId,
    timelineEntries: [activeToolEntry]
  };

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({ ...input, anchorMessageId: null }),
    false
  );
  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({ ...input, runningTurnId: null }),
    false
  );
});

test('releases anchor for chatParts with tool calls converted to timeline entries', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';

  const parts = [
    { type: 'text', text: 'Working on it' },
    { type: 'reasoning', reasoning: 'Thinking...' },
    {
      type: 'tool',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'git status' },
      state: 'running'
    }
  ];

  const timelineEntries = chatPartsToTimelineEntries(activeTurnId, parts);

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries
    }),
    true
  );
});

test('releases anchor when work item has itemType or requestKind defined', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';

  const itemTypeEntry: TimelineEntry = {
    id: 'work-1',
    kind: 'work',
    entry: {
      id: 'entry-1',
      turnId: activeTurnId,
      itemType: 'command_execution'
    }
  };

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: [itemTypeEntry]
    }),
    true
  );

  const requestKindEntry: TimelineEntry = {
    id: 'work-2',
    kind: 'work',
    entry: {
      id: 'entry-2',
      turnId: activeTurnId,
      requestKind: 'approval'
    }
  };

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: [requestKindEntry]
    }),
    true
  );
});

test('handles whitespace-only commands without releasing anchor', () => {
  const activeTurnId = 'active-turn';
  const anchorMessageId = 'anchored-message';

  const whitespaceEntry: TimelineEntry = {
    id: 'work-1',
    kind: 'work',
    entry: {
      id: 'entry-1',
      turnId: activeTurnId,
      command: '   \t\n  '
    }
  };

  assert.equal(
    shouldReleaseTimelineAnchorForToolActivity({
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: [whitespaceEntry]
    }),
    false
  );
});
