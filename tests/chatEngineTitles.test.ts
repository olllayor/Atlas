import assert from 'node:assert/strict';
import test from 'node:test';

import { setTimeout as delay } from 'node:timers/promises';

import { ChatEngine } from '../src/main/ai/core/ChatEngine.js';
import type { ExecuteTurnRequest, ExecuteTurnResult } from '../src/main/ai/core/ChatSessionRuntime.js';
import type { ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';

function createFakeWindow() {
  const events: StreamEvent[] = [];

  return {
    events,
    window: {
      once() {},
      removeListener() {},
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send(_channel: string, event: StreamEvent) {
          events.push(event);
        },
      },
    },
  };
}

type Harness = {
  events: StreamEvent[];
  renames: Array<{ conversationId: string; title: string }>;
  streamCalls: Array<Record<string, unknown>>;
  run: (overrides?: Partial<ChatStartRequest>) => Promise<void>;
  releaseRuntime: () => void;
};

function createHarness(options: {
  initialTitle?: string;
  titleReply?: string;
  assistantText?: string;
  hasAdapter?: boolean;
  apiKey?: string | null;
  streamThrows?: boolean;
  initialTitleIsAuto?: boolean;
  /** Hold the turn open so the pre-stream naming can be observed alone. */
  blockRuntime?: boolean;
} = {}): Harness {
  const {
    initialTitle = 'Session · Jul 30, 01:22 AM',
    titleReply = 'Atlas chat versus work',
    assistantText = 'Atlas chat is conversational; work runs tasks.',
    hasAdapter = true,
    apiKey = ['sk', 'test'].join('-'),
  } = options;

  const events: StreamEvent[] = [];
  const renames: Array<{ conversationId: string; title: string }> = [];
  const streamCalls: Array<Record<string, unknown>> = [];
  let currentTitle = initialTitle;

  let currentTitleIsAuto = options.initialTitleIsAuto ?? false;

  const conversationsRepo = {
    setDefaults: () => undefined,
      clearLifecycleOnUserActivity: () => undefined,
    addMessage: () => 'message-1',
    updateMessage: () => undefined,
    getTitleState: () => ({ title: currentTitle, auto: currentTitleIsAuto }),
    rename: (conversationId: string, title: string, renameOptions: { auto?: boolean } = {}) => {
      renames.push({ conversationId, title });
      currentTitle = title;
      currentTitleIsAuto = Boolean(renameOptions.auto);
      return { id: conversationId, title };
    },
  };

  const adapter = {
    providerId: 'custom:test',
    async streamChat(request: Record<string, unknown>) {
      streamCalls.push(request);
      if (options.streamThrows) {
        throw new Error('provider exploded');
      }
      return { content: titleReply, latencyMs: 5 };
    },
  };

  const providers = new Map(hasAdapter ? [['custom:test', adapter]] : []);

  let releaseRuntime = () => {};
  const runtimeGate = options.blockRuntime
    ? new Promise<void>((resolve) => {
        releaseRuntime = resolve;
      })
    : Promise.resolve();

  const engine = new ChatEngine(
    conversationsRepo as never,
    {
      getById: () => ({ supportsTools: false }),
      getRuntimeHints: () => ({ supportsTemperature: false, maxOutputTokens: 4_096 }),
    } as never,
    { getSecret: async () => apiKey } as never,
    providers as never,
    { persistAttachment: () => undefined } as never,
    {
      async executeTurn(): Promise<ExecuteTurnResult> {
        await runtimeGate;
        return {
          messageId: 'assistant-message-1',
          parts: [{ id: 'p1', type: 'text', text: assistantText, state: 'done' }],
        } as ExecuteTurnResult;
      },
    } as Pick<{ executeTurn: (r: ExecuteTurnRequest) => Promise<ExecuteTurnResult> }, 'executeTurn'>,
  );

  const fakeWindow = createFakeWindow();
  events.push(...fakeWindow.events);

  return {
    events: fakeWindow.events,
    renames,
    streamCalls,
    async run(overrides: Partial<ChatStartRequest> = {}) {
      await engine.start(fakeWindow.window as never, {
        conversationId: 'conversation-1',
        providerId: 'custom:test',
        modelId: 'deepseek-chat',
        messages: [{ role: 'user', content: 'tell me diff between atlas chat and atlas work?' }],
        enableTools: false,
        ...overrides,
      });
      // start() defers the turn to setImmediate, and titling is a further
      // detached promise after it.
      await delay(10);
    },
    releaseRuntime: () => releaseRuntime(),
  };
}

test('a session is named from the prompt first, then refined by the model', async () => {
  const harness = createHarness();
  await harness.run();

  assert.deepEqual(harness.renames, [
    // Immediate, offline, before a single token streams.
    { conversationId: 'conversation-1', title: 'tell me diff between atlas chat and atlas work' },
    // Refined once the model has seen the answer.
    { conversationId: 'conversation-1', title: 'Atlas chat versus work' },
  ]);

  const titleEvents = harness.events.filter((event) => event.type === 'conversation-title');
  assert.equal(titleEvents.length, 2, 'the renderer is told about both names');
  assert.equal(
    titleEvents.at(-1)?.type === 'conversation-title' ? titleEvents.at(-1)!.title : null,
    'Atlas chat versus work'
  );
});

test('the local name lands before the turn starts streaming', async () => {
  const harness = createHarness({ blockRuntime: true });
  await harness.run();

  // The turn is still in flight, yet the sidebar already has a real name.
  assert.deepEqual(harness.renames, [
    { conversationId: 'conversation-1', title: 'tell me diff between atlas chat and atlas work' },
  ]);
  harness.releaseRuntime();
});

test('the naming request carries both sides of the exchange', async () => {
  const harness = createHarness();
  await harness.run();

  assert.equal(harness.streamCalls.length, 1);
  const call = harness.streamCalls[0]!;
  const messages = call.messages as Array<{ role: string; content: string }>;
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.content, /tell me diff between atlas chat/);
  assert.match(messages[0]!.content, /Atlas chat is conversational/);
  assert.equal(call.modelId, 'deepseek-chat');
});

test('the naming request carries catalog hints and asks for no deliberation', async () => {
  const harness = createHarness();
  await harness.run();

  const call = harness.streamCalls[0]!;
  // Without hints the shared stream core sends a default temperature, which
  // reasoning models reject with a hard 400 — the failure that made titling
  // look like it never ran.
  assert.deepEqual(call.modelHints, { supportsTemperature: false, maxOutputTokens: 4_096 });
  // A reasoning model spends the same budget on thinking as on the answer;
  // left unbounded it returns an empty title.
  assert.equal(call.reasoningEffort, 'minimal');
});

test('a title the user typed is never touched', async () => {
  const harness = createHarness({ initialTitle: 'My hand-picked name' });
  await harness.run();

  assert.deepEqual(harness.renames, []);
  assert.equal(harness.streamCalls.length, 0, 'no model call should be made at all');
});

test('an earlier automatic name is still open to refinement', async () => {
  const harness = createHarness({
    initialTitle: 'tell me diff between atlas chat',
    initialTitleIsAuto: true,
  });
  await harness.run();

  // The local pass re-derives, then the model refines — both allowed
  // because no human ever named this thread.
  assert.equal(harness.renames.at(-1)?.title, 'Atlas chat versus work');
});

const LOCAL_TITLE = 'tell me diff between atlas chat and atlas work';

test('unusable model output leaves the local name standing', async () => {
  const harness = createHarness({ titleReply: '   ' });
  await harness.run();

  assert.deepEqual(harness.renames, [{ conversationId: 'conversation-1', title: LOCAL_TITLE }]);
});

test('a provider failure leaves the local name standing', async () => {
  const harness = createHarness({ streamThrows: true });
  await harness.run();

  assert.deepEqual(harness.renames, [{ conversationId: 'conversation-1', title: LOCAL_TITLE }]);
});

test('a missing adapter or key still names the session locally', async () => {
  const noAdapter = createHarness({ hasAdapter: false });
  await noAdapter.run();
  assert.deepEqual(noAdapter.renames, [{ conversationId: 'conversation-1', title: LOCAL_TITLE }]);
  assert.equal(noAdapter.streamCalls.length, 0, 'no model call without an adapter');

  const noKey = createHarness({ apiKey: null });
  await noKey.run();
  assert.deepEqual(noKey.renames, [{ conversationId: 'conversation-1', title: LOCAL_TITLE }]);
  assert.equal(noKey.streamCalls.length, 0, 'no model call without a key');
});
