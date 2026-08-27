import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import {
  OpenCodeAgentAdapter,
  toOpenCodePermissionReply,
  type OpenCodeSessionStore
} from '../src/main/ai/providers/opencode/OpenCodeAgentAdapter.js';
import type {
  OpenCodeAgentClient,
  OpenCodePromptInput,
  OpenCodePromptResult
} from '../src/main/ai/providers/opencode/OpenCodeAgentClient.js';
import { isOpenCodeNotFound } from '../src/main/ai/providers/opencode/OpenCodeAgentClient.js';
import { normalizeProviderListPayload } from '../src/main/ai/providers/opencode/OpenCodeClient.js';
import { buildOpenCodePromptParts } from '../src/main/ai/providers/opencode/openCodePrompt.js';
import { defaultOpenCodeSettings } from '../src/shared/opencodeSettings.js';

const USER_TURN: ModelMessage[] = [{ role: 'user', content: 'ship it' }];

function memoryStore(seed?: { conversationId: string; sessionId: string; directory: string }) {
  const rows = new Map<string, { sessionId: string; directory: string }>();
  if (seed) {
    rows.set(seed.conversationId, { sessionId: seed.sessionId, directory: seed.directory });
  }
  const store: OpenCodeSessionStore & { rows: typeof rows } = {
    rows,
    get: (conversationId) => rows.get(conversationId) ?? null,
    set: ({ conversationId, sessionId, directory }) => {
      rows.set(conversationId, { sessionId, directory });
    },
    clear: (conversationId) => {
      rows.delete(conversationId);
    }
  };
  return store;
}

type FakeClientOptions = {
  events?: unknown[];
  sessions?: Set<string>;
  getSessionError?: unknown;
  promptResult?: Partial<OpenCodePromptResult>;
  onPrompt?: (input: OpenCodePromptInput) => void;
  hangUntilAbort?: boolean;
  providerPayload?: unknown;
};

function fakeClient(options: FakeClientOptions = {}) {
  const calls = {
    created: 0,
    deleted: [] as string[],
    aborted: [] as string[],
    prompts: [] as OpenCodePromptInput[],
    replies: [] as Array<{ requestId: string; reply: string }>
  };
  const sessions = options.sessions ?? new Set<string>();
  let abortResolve: (() => void) | null = null;

  const client: OpenCodeAgentClient = {
    async listProviders() {
      return normalizeProviderListPayload(options.providerPayload ?? { all: [], connected: [] });
    },
    async getSession(sessionId) {
      if (options.getSessionError) {
        throw options.getSessionError;
      }
      return sessions.has(sessionId) ? { id: sessionId } : null;
    },
    async createSession() {
      calls.created += 1;
      const id = `ses_new_${calls.created}`;
      sessions.add(id);
      return { id };
    },
    async deleteSession(sessionId) {
      calls.deleted.push(sessionId);
      sessions.delete(sessionId);
    },
    async prompt(input) {
      calls.prompts.push(input);
      options.onPrompt?.(input);
      if (options.hangUntilAbort) {
        await new Promise<void>((resolve) => {
          abortResolve = resolve;
        });
      }
      return {
        text: '',
        reasoning: '',
        tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 900 },
        ...options.promptResult
      };
    },
    async abort(sessionId) {
      calls.aborted.push(sessionId);
      abortResolve?.();
    },
    async replyToPermission({ requestId, reply }) {
      calls.replies.push({ requestId, reply });
    },
    subscribeEvents(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of options.events ?? []) {
            if (signal.aborted) return;
            yield event;
          }
          // Idle forever until the adapter closes the stream, like a real SSE
          // connection would.
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      };
    }
  };

  return { client, calls };
}

function buildAdapter(
  overrides: {
    client?: OpenCodeAgentClient;
    store?: OpenCodeSessionStore;
    connect?: () => Promise<{ baseUrl: string; owned: boolean; release: () => void }>;
  } = {}
) {
  const released: number[] = [];
  const store = overrides.store ?? memoryStore();
  const adapter = new OpenCodeAgentAdapter({
    readSettings: () => ({ ...defaultOpenCodeSettings(), enabled: true }),
    readServerPassword: async () => 'hunter2',
    connect:
      overrides.connect ??
      (async () => ({
        baseUrl: 'http://127.0.0.1:4096',
        owned: true,
        release: () => released.push(1)
      })),
    createClient: () => overrides.client ?? fakeClient().client,
    sessions: store,
    defaultDirectory: () => '/tmp/fallback'
  });
  return { adapter, store, released };
}

function streamRequest(overrides: Partial<Parameters<OpenCodeAgentAdapter['streamChat']>[0]> = {}) {
  const controller = new AbortController();
  const chunks: string[] = [];
  return {
    controller,
    chunks,
    request: {
      apiKey: '',
      modelId: 'opencode/claude-opus-4-7',
      messages: USER_TURN,
      signal: controller.signal,
      onChunk: (event: { delta: string }) => chunks.push(event.delta),
      agentContext: { conversationId: 'conv_1', workspaceRoot: '/proj' },
      ...overrides
    } as Parameters<OpenCodeAgentAdapter['streamChat']>[0]
  };
}

const textEvent = (sessionID: string, delta: string) => ({
  id: 'e1',
  type: 'session.next.text.delta',
  properties: { sessionID, textID: 't1', delta }
});

test('a resumed session prompts without recreating, and streams its deltas', async () => {
  const { client, calls } = fakeClient({
    sessions: new Set(['ses_known']),
    events: [textEvent('ses_known', 'streamed ')]
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter, released } = buildAdapter({ client, store });

  const { request, chunks } = streamRequest();
  const result = await adapter.streamChat(request);

  assert.equal(calls.created, 0);
  assert.equal(calls.prompts[0]!.sessionId, 'ses_known');
  assert.deepEqual(calls.prompts[0]!.model, { providerID: 'opencode', modelID: 'claude-opus-4-7' });
  assert.deepEqual(chunks, ['streamed ']);
  assert.equal(result.content, 'streamed ');
  // A resumed session already has the history, so only the new turn is sent.
  assert.deepEqual(calls.prompts[0]!.parts, [{ type: 'text', text: 'ship it' }]);
  assert.equal(released.length, 1);
});

test('token usage folds cache reads into the prompt total and keeps the hit', async () => {
  const { client } = fakeClient({ sessions: new Set(['ses_known']) });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const result = await adapter.streamChat(streamRequest().request);

  assert.equal(result.inputTokens, 1000);
  assert.equal(result.cachedInputTokens, 900);
  assert.equal(result.outputTokens, 20);
  assert.equal(result.reasoningTokens, 5);
});

test('a provider that reports no cache leaves cachedInputTokens absent', async () => {
  const { client } = fakeClient({
    sessions: new Set(['ses_known']),
    promptResult: { tokens: { input: 10, output: 2 } }
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const result = await adapter.streamChat(streamRequest().request);

  assert.equal(result.inputTokens, 10);
  assert.equal('cachedInputTokens' in result, false);
});

test('a confirmed miss recreates the session, seeds history, and re-points the cursor', async () => {
  const { client, calls } = fakeClient();
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_gone', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const { request } = streamRequest({
    messages: [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'ship it' }
    ]
  });
  await adapter.streamChat(request);

  assert.equal(calls.created, 1);
  assert.equal(store.get('conv_1')!.sessionId, 'ses_new_1');
  const parts = calls.prompts[0]!.parts;
  assert.equal(parts.length, 2);
  assert.match(String(parts[0]!.text), /Conversation so far/);
  assert.match(String(parts[0]!.text), /first answer/);
  assert.equal(parts[1]!.text, 'ship it');
});

test('a moved project starts a fresh session instead of resuming another directory', async () => {
  const { client, calls } = fakeClient({ sessions: new Set(['ses_known']) });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/old' });
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.equal(calls.created, 1);
  assert.equal(store.get('conv_1')!.directory, '/proj');
});

test('a server hiccup fails the turn rather than silently forgetting the session', async () => {
  const { client, calls } = fakeClient({
    getSessionError: Object.assign(new Error('fetch failed'), {})
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  await assert.rejects(adapter.streamChat(streamRequest().request), /fetch failed/);
  assert.equal(calls.created, 0);
  assert.equal(store.get('conv_1')!.sessionId, 'ses_known');
});

test('abort tells opencode first, then fails the turn as an abort', async () => {
  const { client, calls } = fakeClient({ sessions: new Set(['ses_known']), hangUntilAbort: true });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const { request, controller } = streamRequest();
  const pending = adapter.streamChat(request);
  setTimeout(() => controller.abort(), 5);

  await assert.rejects(pending, (error: Error) => error.name === 'AbortError');
  assert.deepEqual(calls.aborted, ['ses_known']);
});

test('an unparseable model id is rejected before anything is spawned', async () => {
  const { client, calls } = fakeClient();
  const { adapter } = buildAdapter({ client });

  const { request } = streamRequest({ modelId: 'claude-opus-4-7' });
  await assert.rejects(adapter.streamChat(request), /Expected "<provider>\/<model>"/);
  assert.equal(calls.prompts.length, 0);
});

test('a message-level error from opencode fails the turn', async () => {
  const { client } = fakeClient({
    sessions: new Set(['ses_known']),
    promptResult: { errorText: 'Provider rejected the request.' }
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  await assert.rejects(adapter.streamChat(streamRequest().request), /Provider rejected the request\./);
});

test('offering Atlas tools notices once that opencode runs its own', async () => {
  const { client } = fakeClient({ sessions: new Set(['ses_known']) });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const notices: string[] = [];
  const { request } = streamRequest({
    tools: { bash: {} } as never,
    onNotice: (event: { code: string }) => notices.push(event.code)
  });
  await adapter.streamChat(request);

  assert.deepEqual(notices, ['opencode.toolsDelegated']);
});

test('an approval decision is relayed once and maps onto opencode replies', async () => {
  const { client, calls } = fakeClient({
    sessions: new Set(['ses_known']),
    events: [
      {
        id: 'e',
        type: 'permission.asked',
        properties: {
          sessionID: 'ses_known',
          id: 'perm_1',
          permission: 'edit',
          patterns: ['src/**'],
          tool: { messageID: 'm', callID: 'c1' }
        }
      }
    ]
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const approvals: string[] = [];
  const resolved: string[] = [];
  const { request } = streamRequest({
    onToolApprovalRequested: (event: { approvalId: string }) => approvals.push(event.approvalId),
    onToolApprovalResolved: (event: { approvalId: string }) => resolved.push(event.approvalId)
  });
  await adapter.streamChat(request);

  assert.deepEqual(approvals, ['perm_1']);

  await adapter.resolveApproval('perm_1', 'approve_always');
  await adapter.resolveApproval('perm_1', 'deny');

  assert.deepEqual(calls.replies, [{ requestId: 'perm_1', reply: 'always' }]);
  assert.deepEqual(resolved, ['perm_1']);
  assert.equal(toOpenCodePermissionReply('approve'), 'once');
  assert.equal(toOpenCodePermissionReply('deny'), 'reject');
});

test('listModels flattens the live catalog with the user\'s custom slugs', async () => {
  const { client } = fakeClient({
    providerPayload: {
      all: [{ id: 'opencode', name: 'Zen', models: { m1: { id: 'm1', name: 'M One' } } }],
      connected: ['opencode']
    }
  });
  const { adapter } = buildAdapter({ client });

  const models = await adapter.listModels();
  assert.deepEqual(
    models.map((model) => model.id),
    ['opencode/m1']
  );
  assert.equal(models[0]!.providerId, 'opencode');
});

test('404-shaped failures are the only confirmed miss', () => {
  assert.equal(isOpenCodeNotFound(Object.assign(new Error('x'), { status: 404 })), true);
  assert.equal(isOpenCodeNotFound(new Error('Request failed with status code 404')), true);
  assert.equal(isOpenCodeNotFound(new Error('session not found')), true);
  assert.equal(isOpenCodeNotFound(new Error('ECONNREFUSED')), false);
  assert.equal(isOpenCodeNotFound(Object.assign(new Error('x'), { status: 500 })), false);
});

test('attachments ride along as file parts, tool traffic does not', () => {
  const parts = buildOpenCodePromptParts({
    seedHistory: false,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
        ]
      } as ModelMessage
    ]
  });

  assert.equal(parts.length, 2);
  assert.equal(parts[1]!.type, 'file');
  assert.equal(parts[1]!.mime, 'image/png');
  assert.match(String(parts[1]!.url), /^data:image\/png;base64,/);
});

test('a turn with no conversation uses a scratch session and cleans it up', async () => {
  const { client, calls } = fakeClient();
  const store = memoryStore();
  const { adapter, store: sessions } = buildAdapter({ client, store });

  // Titles and summary refreshes call the adapter without an agent context.
  const { request } = streamRequest({ agentContext: undefined });
  await adapter.streamChat(request);

  assert.equal(calls.created, 1);
  assert.deepEqual(calls.deleted, ['ses_new_1'], 'the scratch session was removed');
  assert.equal(sessions.rows.size, 0, 'and no cursor was written for it');
});

test('a conversation session survives the turn that created it', async () => {
  const { client, calls } = fakeClient();
  const store = memoryStore();
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.equal(calls.created, 1);
  assert.deepEqual(calls.deleted, [], 'a real conversation keeps its session');
  assert.equal(store.get('conv_1')!.sessionId, 'ses_new_1');
});

test('a stored attachment arrives as bytes and rides along as a data URL', () => {
  // The exact shape `ConversationsRepo.getModelHistory` produces: the store has
  // already resolved `atlas-attachment://` into bytes by this point (see
  // `buildModelMessageContent`), so the adapter never sees an Atlas URL.
  const parts = buildOpenCodePromptParts({
    seedHistory: false,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in this pdf' },
          {
            type: 'file',
            data: Buffer.from('hello'),
            filename: 'notes.pdf',
            mediaType: 'application/pdf'
          }
        ]
      } as ModelMessage
    ]
  });

  assert.deepEqual(parts[0], { type: 'text', text: 'what is in this pdf' });
  assert.equal(parts[1]!.type, 'file');
  assert.equal(parts[1]!.mime, 'application/pdf');
  assert.equal(parts[1]!.filename, 'notes.pdf');
  assert.equal(parts[1]!.url, `data:application/pdf;base64,${Buffer.from('hello').toString('base64')}`);
});

test('an attachment already encoded as a data URL is passed through unchanged', () => {
  const url = 'data:image/png;base64,AAAA';
  const parts = buildOpenCodePromptParts({
    seedHistory: false,
    messages: [
      {
        role: 'user',
        content: [{ type: 'file', data: url, mediaType: 'image/png' }]
      } as ModelMessage
    ]
  });

  assert.equal(parts[0]!.url, url);
});
