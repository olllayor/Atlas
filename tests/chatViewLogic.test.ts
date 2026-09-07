import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_DEFAULT_MODEL,
  chatPartsToTimelineEntries,
  getAntigravitySendBlockReason,
  shouldReleaseTimelineAnchorForToolActivity,
  shouldShowComposerContextStrip,
  toolGroupConsumesUpwardNavigation,
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

test('shouldShowComposerContextStrip keeps strip expanded during draft state', () => {
  assert.equal(
    shouldShowComposerContextStrip({
      conversationStarted: false,
      hasProject: true,
      persistComposerContextStrip: false
    }),
    true
  );
  assert.equal(
    shouldShowComposerContextStrip({
      conversationStarted: false,
      hasProject: false,
      persistComposerContextStrip: false
    }),
    true
  );
  assert.equal(
    shouldShowComposerContextStrip({
      conversationStarted: false,
      hasProject: true,
      persistComposerContextStrip: true
    }),
    true
  );
});

test('shouldShowComposerContextStrip collapses in active conversation when preference is false', () => {
  assert.equal(
    shouldShowComposerContextStrip({
      conversationStarted: true,
      hasProject: true,
      persistComposerContextStrip: false
    }),
    false
  );
});

test('shouldShowComposerContextStrip stays expanded in active conversation when preference is true', () => {
  assert.equal(
    shouldShowComposerContextStrip({
      conversationStarted: true,
      hasProject: true,
      persistComposerContextStrip: true
    }),
    true
  );
  assert.equal(
    shouldShowComposerContextStrip({
      conversationStarted: true,
      persistComposerContextStrip: true
    }),
    true
  );
  assert.equal(
    shouldShowComposerContextStrip({
      conversationStarted: true,
      hasProject: false,
      persistComposerContextStrip: true
    }),
    false
  );
});


// ---------------------------------------------------------------------------
// toolGroupConsumesUpwardNavigation
// ---------------------------------------------------------------------------

/**
 * A DOM stand-in: this suite is bare `node --test` with no jsdom, which is why
 * the helper reads overflow through an injected function rather than
 * `getComputedStyle`.
 */
type FakeNode = {
  scrollTop: number;
  overflowY: string;
  isToolGroup: boolean;
  parentElement: FakeNode | null;
  closest(selector: string): FakeNode | null;
};

const readOverflowY = (target: unknown) => (target as FakeNode).overflowY;

function fakeNode(
  options: { scrollTop?: number; overflowY?: string; isToolGroup?: boolean },
  parent: FakeNode | null = null
): FakeNode {
  const self: FakeNode = {
    scrollTop: options.scrollTop ?? 0,
    overflowY: options.overflowY ?? 'visible',
    isToolGroup: options.isToolGroup ?? false,
    parentElement: parent,
    closest(selector: string) {
      if (selector !== '[data-tool-group-scroll]') return null;
      for (let node: FakeNode | null = self; node; node = node.parentElement) {
        if (node.isToolGroup) return node;
      }
      return null;
    }
  };
  return self;
}

test('toolGroupConsumesUpwardNavigation leaves the transcript lock alone outside a tool log', () => {
  const transcript = fakeNode({ scrollTop: 400, overflowY: 'auto' });
  const row = fakeNode({}, transcript);
  assert.equal(toolGroupConsumesUpwardNavigation(row, readOverflowY), false);
});

test('toolGroupConsumesUpwardNavigation claims the gesture while the log has scrollback', () => {
  const transcript = fakeNode({ scrollTop: 400, overflowY: 'auto' });
  const log = fakeNode({ scrollTop: 120, overflowY: 'auto', isToolGroup: true }, transcript);
  const step = fakeNode({}, log);
  assert.equal(toolGroupConsumesUpwardNavigation(step, readOverflowY), true);
});

test('toolGroupConsumesUpwardNavigation releases the gesture at the log top', () => {
  // Nothing left above inside the log, so the wheel is the transcript's again
  // and the reader is deliberately leaving the live edge.
  const transcript = fakeNode({ scrollTop: 400, overflowY: 'auto' });
  const log = fakeNode({ scrollTop: 0, overflowY: 'auto', isToolGroup: true }, transcript);
  const step = fakeNode({}, log);
  assert.equal(toolGroupConsumesUpwardNavigation(step, readOverflowY), false);
});

test('toolGroupConsumesUpwardNavigation counts a scrolled result inside the log', () => {
  const log = fakeNode({ scrollTop: 0, overflowY: 'auto', isToolGroup: true });
  const output = fakeNode({ scrollTop: 60, overflowY: 'scroll' }, log);
  const line = fakeNode({}, output);
  assert.equal(toolGroupConsumesUpwardNavigation(line, readOverflowY), true);
});

test('toolGroupConsumesUpwardNavigation ignores scroll state above the log', () => {
  // The transcript being scrolled is the whole reason the gesture matters; it
  // must never be the reason the log claims it.
  const transcript = fakeNode({ scrollTop: 400, overflowY: 'auto' });
  const log = fakeNode({ scrollTop: 0, overflowY: 'auto', isToolGroup: true }, transcript);
  assert.equal(toolGroupConsumesUpwardNavigation(log, readOverflowY), false);
});

test('toolGroupConsumesUpwardNavigation ignores a non-event target', () => {
  assert.equal(toolGroupConsumesUpwardNavigation(null, readOverflowY), false);
  assert.equal(toolGroupConsumesUpwardNavigation({}, readOverflowY), false);
});
