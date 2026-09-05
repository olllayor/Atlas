import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import {
  OpenCodeAgentAdapter,
  toOpenCodePermissionReply,
  toOpenCodeVariant,
  type OpenCodeSessionStore
} from '../src/main/ai/providers/opencode/OpenCodeAgentAdapter.js';
import type {
  OpenCodeAgentClient,
  OpenCodePromptInput,
  OpenCodePromptResult
} from '../src/main/ai/providers/opencode/OpenCodeAgentClient.js';
import { isOpenCodeNotFound } from '../src/main/ai/providers/opencode/OpenCodeAgentClient.js';
import { normalizeProviderListPayload } from '../src/main/ai/providers/opencode/OpenCodeClient.js';
import { buildOpenCodePromptParts, isOpenCodeNativeFilePart, OPENCODE_NATIVE_FILE_PART_MAX_BYTES } from '../src/main/ai/providers/opencode/openCodePrompt.js';
import { buildOpenCodePermissionRules, type OpenCodePermissionRuleset } from '../src/main/ai/providers/opencode/openCodeParsers.js';
import { defaultOpenCodeSettings } from '../src/shared/opencodeSettingsSchema.js';

const USER_TURN: ModelMessage[] = [{ role: 'user', content: 'ship it' }];

function memoryStore(seed?: { conversationId: string; sessionId: string; directory: string }) {
  const rows = new Map<string, { sessionId: string; directory: string; transport?: 'sdk' | 'acp' }>();
  if (seed) {
    rows.set(seed.conversationId, { sessionId: seed.sessionId, directory: seed.directory, transport: 'sdk' });
  }
  const store: OpenCodeSessionStore & { rows: typeof rows } = {
    rows,
    get: (conversationId) => rows.get(conversationId) ?? null,
    set: ({ conversationId, sessionId, directory, transport }) => {
      rows.set(conversationId, { sessionId, directory, transport });
    },
    clear: (conversationId) => {
      rows.delete(conversationId);
    }
  };
  return store;
}

type FakeClientOptions = {
  events?: unknown[];
  /** Throw after yielding events, like a dead SSE connection. */
  eventsError?: unknown;
  sessions?: Set<string>;
  getSessionError?: unknown;
  promptResult?: Partial<OpenCodePromptResult>;
  onPrompt?: (input: OpenCodePromptInput) => void;
  hangUntilAbort?: boolean;
  /** Block `prompt` until a permission reply lands, as the real server does. */
  hangUntilPermissionReply?: boolean;
  providerPayload?: unknown;
  initialQuestions?: Array<Record<string, unknown>>;
  initialPermissions?: Array<Record<string, unknown>>;
  parentsBySession?: Map<string, string>;
  childrenBySession?: Map<string, Array<{ id: string }>>;
};

function fakeClient(options: FakeClientOptions = {}) {
  const calls = {
    created: 0,
    createdPermissions: [] as Array<OpenCodePermissionRuleset | undefined>,
    forked: [] as Array<{ sessionId: string; directory?: string }>,
    deleted: [] as string[],
    aborted: [] as string[],
    prompts: [] as OpenCodePromptInput[],
    replies: [] as Array<{ requestId: string; reply: string }>,
    questionReplies: [] as Array<{ requestId: string; answers: string[][] }>,
    questionRejections: [] as string[]
  };
  const sessions = options.sessions ?? new Set<string>();
  let abortResolve: (() => void) | null = null;
  let permissionResolve: (() => void) | null = null;
  let forkCount = 0;

  const client: OpenCodeAgentClient = {
    async listProviders() {
      return normalizeProviderListPayload(options.providerPayload ?? { all: [], connected: [] });
    },
    async getSession(sessionId) {
      if (options.getSessionError) {
        throw options.getSessionError;
      }
      if (!sessions.has(sessionId)) return null;
      const parentID = options.parentsBySession?.get(sessionId);
      return { id: sessionId, ...(parentID ? { parentID } : {}) };
    },
    async createSession(input) {
      calls.created += 1;
      calls.createdPermissions.push(input?.permission);
      const id = `ses_new_${calls.created}`;
      sessions.add(id);
      return { id };
    },
    async replyToQuestion({ requestId, answers }) {
      calls.questionReplies.push({ requestId, answers });
      permissionResolve?.();
    },
    async rejectQuestion({ requestId }) {
      calls.questionRejections.push(requestId);
      permissionResolve?.();
    },
    async listQuestions() {
      return options.initialQuestions ?? [];
    },
    async listPermissions() {
      return options.initialPermissions ?? [];
    },
    async forkSession({ sessionId, directory }) {
      calls.forked.push({ sessionId, ...(directory ? { directory } : {}) });
      forkCount += 1;
      const id = `ses_fork_${forkCount}`;
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
      if (options.hangUntilPermissionReply) {
        await new Promise<void>((resolve) => {
          permissionResolve = resolve;
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
    async listChildren(sessionId) {
      return options.childrenBySession?.get(sessionId) ?? [];
    },
    async replyToPermission({ requestId, reply }) {
      calls.replies.push({ requestId, reply });
      permissionResolve?.();
    },
    subscribeEvents(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of options.events ?? []) {
            if (signal.aborted) return;
            yield event;
          }
          if (options.eventsError !== undefined) {
            throw options.eventsError;
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

test('a moved project forks the stored session instead of starting fresh', async () => {
  const { client, calls } = fakeClient({ sessions: new Set(['ses_known']) });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/old' });
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.equal(calls.created, 0);
  assert.deepEqual(calls.forked, [{ sessionId: 'ses_known', directory: '/proj' }]);
  assert.equal(calls.prompts[0]!.sessionId, 'ses_fork_1');
  // Forked history travels, so no reseed prefix.
  assert.deepEqual(calls.prompts[0]!.parts, [{ type: 'text', text: 'ship it' }]);
  assert.equal(store.get('conv_1')!.sessionId, 'ses_fork_1');
  assert.equal(store.get('conv_1')!.directory, '/proj');
});

test('a forked 404 falls back to a fresh seeded session', async () => {
  const { client, calls } = fakeClient({ sessions: new Set(['ses_known']) });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/old' });
  const forkError = Object.assign(new Error('NotFoundError'), { status: 404 });
  const failingFork = {
    ...client,
    async forkSession() {
      throw forkError;
    }
  } as OpenCodeAgentClient;
  const { adapter } = buildAdapter({ client: failingFork, store });

  await adapter.streamChat(streamRequest().request);

  assert.equal(calls.created, 1);
  assert.equal(store.get('conv_1')!.directory, '/proj');
});

test('a stale cursor version is ignored, never resumed', async () => {
  const { client, calls } = fakeClient({ sessions: new Set(['ses_known']) });
  const rows = new Map<string, { sessionId: string; directory: string; schemaVersion?: number; transport?: 'sdk' | 'acp' }>();
  rows.set('conv_1', { sessionId: 'ses_known', directory: '/proj', schemaVersion: 999 });
  const store: OpenCodeSessionStore & { rows: typeof rows } = {
    rows,
    get: (conversationId) => rows.get(conversationId) ?? null,
    set: ({ conversationId, sessionId, directory, transport }) => {
      rows.set(conversationId, { sessionId, directory, transport });
    },
    clear: (conversationId) => {
      rows.delete(conversationId);
    }
  };
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.equal(calls.created, 1);
  assert.equal(calls.prompts[0]!.sessionId, 'ses_new_1');
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

test('abort stops the parent session and all descendant child sessions (PR #9005)', async () => {
  const children = new Map([
    ['ses_known', [{ id: 'ses_child_1' }, { id: 'ses_child_2' }]],
    ['ses_child_1', [{ id: 'ses_grandchild' }]],
    ['ses_child_2', []],
    ['ses_grandchild', []]
  ]);
  const { client, calls } = fakeClient({
    sessions: new Set(['ses_known']),
    hangUntilAbort: true,
    childrenBySession: children
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const { request, controller } = streamRequest();
  const pending = adapter.streamChat(request);
  setTimeout(() => controller.abort(), 5);

  await assert.rejects(pending, (error: Error) => error.name === 'AbortError');
  assert.equal(calls.aborted[0], 'ses_known');
  assert.deepEqual(new Set(calls.aborted), new Set(['ses_known', 'ses_child_1', 'ses_child_2', 'ses_grandchild']));
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

const PERMISSION_ASK = {
  id: 'e',
  type: 'permission.asked',
  properties: {
    sessionID: 'ses_known',
    id: 'perm_1',
    permission: 'edit',
    patterns: ['src/**'],
    tool: { messageID: 'm', callID: 'c1' }
  }
};

/** Wait for a condition the event pump reaches on its own turns of the loop. */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), 'condition never became true');
}

test('an approval decision is relayed once and maps onto opencode replies', async () => {
  const { client, calls } = fakeClient({
    sessions: new Set(['ses_known']),
    events: [PERMISSION_ASK],
    hangUntilPermissionReply: true
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const approvals: string[] = [];
  const resolved: string[] = [];
  const { request } = streamRequest({
    onToolApprovalRequested: (event: { approvalId: string }) => approvals.push(event.approvalId),
    onToolApprovalResolved: (event: { approvalId: string }) => resolved.push(event.approvalId)
  });

  // The turn is still in flight while the ask waits, exactly as it is in the app.
  const turn = adapter.streamChat(request);
  await until(() => approvals.length === 1);

  await adapter.resolveApproval('perm_1', 'approve_always');
  await adapter.resolveApproval('perm_1', 'deny');
  await turn;

  assert.deepEqual(approvals, ['perm_1']);
  assert.deepEqual(calls.replies, [{ requestId: 'perm_1', reply: 'always' }]);
  assert.deepEqual(resolved, ['perm_1']);
  assert.equal(toOpenCodePermissionReply('approve'), 'once');
  assert.equal(toOpenCodePermissionReply('deny'), 'reject');
});

test('asks nobody answered leave with their turn instead of piling up', async () => {
  const { client, calls } = fakeClient({
    sessions: new Set(['ses_known']),
    events: [PERMISSION_ASK]
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const approvals: string[] = [];
  const { request } = streamRequest({
    onToolApprovalRequested: (event: { approvalId: string }) => approvals.push(event.approvalId)
  });
  await adapter.streamChat(request);
  assert.deepEqual(approvals, ['perm_1']);

  // The turn is over: the ask is stale, and answering it must not reach a
  // server that moved on — nor keep its client alive for the rest of the run.
  await adapter.resolveApproval('perm_1', 'approve');
  assert.deepEqual(calls.replies, []);
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

test('a dead stream with a good prompt answer still succeeds', async () => {
  const { client } = fakeClient({
    sessions: new Set(['ses_known']),
    eventsError: new Error('socket hang up'),
    promptResult: { text: 'answered over HTTP', reasoning: '' }
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const result = await adapter.streamChat(streamRequest().request);
  assert.equal(result.content, 'answered over HTTP');
});

test('a dead stream plus an empty answer fails instead of returning empty success', async () => {
  const { client } = fakeClient({
    sessions: new Set(['ses_known']),
    eventsError: new Error('socket hang up'),
    promptResult: { text: '', reasoning: '' }
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  await assert.rejects(adapter.streamChat(streamRequest().request), /event stream failed/);
});

test('a 401 stream failure names the saved password', async () => {
  const { client } = fakeClient({
    sessions: new Set(['ses_known']),
    eventsError: new Error('Request failed with status code 401'),
    promptResult: { text: '', reasoning: '' }
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  await assert.rejects(adapter.streamChat(streamRequest().request), /rejected authentication/);
});

test('a foreign-transport cursor is a miss, never resumed', async () => {
  const { client, calls } = fakeClient({ sessions: new Set(['ses_acp_1']) });
  const store = memoryStore();
  store.rows.set('conv_1', { sessionId: 'ses_acp_1', directory: '/proj', transport: 'acp' });
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.equal(calls.created, 1, 'foreign cursor misses and recreates');
  assert.equal(store.get('conv_1')!.transport, 'sdk');
});

test('buildOpenCodePermissionRules maps runtime mode onto correct ruleset', () => {
  const full = buildOpenCodePermissionRules('full-access');
  assert.deepEqual(full, [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'external_directory', pattern: '*', action: 'allow' }
  ]);

  const autoEdit = buildOpenCodePermissionRules('auto-accept-edits');
  assert.equal(autoEdit.find((r) => r.permission === 'edit')?.action, 'allow');
  assert.equal(autoEdit.find((r) => r.permission === 'bash')?.action, 'ask');
  assert.equal(autoEdit.find((r) => r.permission === 'question')?.action, 'allow');

  const supervised = buildOpenCodePermissionRules('ask');
  assert.equal(supervised.find((r) => r.permission === 'edit')?.action, 'ask');
  assert.equal(supervised.find((r) => r.permission === 'bash')?.action, 'ask');
  assert.equal(supervised.find((r) => r.permission === 'question')?.action, 'allow');
});

test('session.create receives permission rules from toolPermissionMode', async () => {
  const { client, calls } = fakeClient();
  const { adapter } = buildAdapter({ client });

  const req = streamRequest().request;
  req.toolPermissionMode = 'full-access';
  await adapter.streamChat(req);

  assert.equal(calls.created, 1);
  assert.deepEqual(calls.createdPermissions[0], [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'external_directory', pattern: '*', action: 'allow' }
  ]);
});

test('full-access auto-replies once to permission asks without blocking', async () => {
  const { client, calls } = fakeClient({
    events: [
      {
        id: 'evt_ask',
        type: 'permission.asked',
        properties: { id: 'perm_doom', permission: 'doom_loop', sessionID: 'ses_new_1' }
      }
    ]
  });
  const { adapter } = buildAdapter({ client });

  let asked = false;
  const req = streamRequest({
    onToolApprovalRequested: () => {
      asked = true;
    }
  }).request;
  req.toolPermissionMode = 'full-access';

  await adapter.streamChat(req);

  assert.equal(asked, false, 'full-access should not surface approval to user');
  assert.equal(calls.replies.length, 1);
  assert.deepEqual(calls.replies[0], { requestId: 'perm_doom', reply: 'once' });
});

test('isOpenCodeNativeFilePart gates allowed types and 20MB limit', () => {
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/png', sizeBytes: 1000 }), true);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/jpeg', sizeBytes: 1000 }), true);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/gif', sizeBytes: 1000 }), true);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/webp', sizeBytes: 1000 }), true);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'application/pdf', sizeBytes: 1000 }), true);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'text/plain', sizeBytes: 1000 }), true);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'text/typescript', sizeBytes: 1000 }), true);

  // 20MB cap
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/png', sizeBytes: OPENCODE_NATIVE_FILE_PART_MAX_BYTES }), true);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/png', sizeBytes: OPENCODE_NATIVE_FILE_PART_MAX_BYTES + 1 }), false);

  // Unsupported formats
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/svg+xml', sizeBytes: 100 }), false);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'image/bmp', sizeBytes: 100 }), false);
  assert.equal(isOpenCodeNativeFilePart({ mimeType: 'application/zip', sizeBytes: 100 }), false);
});

test('unsupported attachments or files over 20MB degrade to text part', () => {
  const parts = buildOpenCodePromptParts({
    seedHistory: false,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: Buffer.from('binary data'),
            filename: 'archive.zip',
            mediaType: 'application/zip'
          },
          {
            type: 'file',
            data: Buffer.alloc(100),
            sizeBytes: 25 * 1024 * 1024,
            filename: 'huge.png',
            mediaType: 'image/png'
          }
        ]
      } as ModelMessage
    ]
  });

  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.type, 'text');
  assert.equal(parts[0]!.text, '[Attached file: archive.zip]');
  assert.equal(parts[1]!.type, 'text');
  assert.equal(parts[1]!.text, '[Attached file: huge.png]');
});

test('local file paths convert to file:// URLs for native types', () => {
  const parts = buildOpenCodePromptParts({
    seedHistory: false,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            path: '/absolute/path/to/diagram.png',
            mediaType: 'image/png'
          }
        ]
      } as ModelMessage
    ]
  });

  assert.equal(parts.length, 1);
  assert.equal(parts[0]!.type, 'file');
  assert.equal(parts[0]!.url, 'file:///absolute/path/to/diagram.png');
});

test('question.asked resolves via approval or respondToQuestion', async () => {
  const { client, calls } = fakeClient({
    events: [
      {
        id: 'evt_q',
        type: 'question.asked',
        properties: {
          id: 'q_ask_1',
          sessionID: 'ses_new_1',
          questions: [
            {
              header: 'Choice',
              question: 'Pick one',
              options: [{ label: 'Option A' }, { label: 'Option B' }]
            }
          ]
        }
      }
    ],
    hangUntilPermissionReply: true
  });
  const { adapter } = buildAdapter({ client });

  let requestedApprovalId: string | null = null;
  const req = streamRequest({
    onToolApprovalRequested: (event) => {
      requestedApprovalId = event.approvalId;
    }
  }).request;

  const stream = adapter.streamChat(req);
  await until(() => requestedApprovalId === 'q_ask_1');

  // Approve uses the first option by default
  await adapter.resolveApproval('q_ask_1', 'approve');
  await stream;

  assert.equal(calls.questionReplies.length, 1);
  assert.deepEqual(calls.questionReplies[0], {
    requestId: 'q_ask_1',
    answers: [['Option A']]
  });

  // Test respondToQuestion directly with custom answers
  const { client: client2, calls: calls2 } = fakeClient({
    events: [
      {
        id: 'evt_q2',
        type: 'question.asked',
        properties: {
          id: 'q_ask_2',
          sessionID: 'ses_new_1',
          questions: [
            {
              header: 'Choice',
              question: 'Select options',
              options: [{ label: 'One' }, { label: 'Two' }],
              multiple: true
            }
          ]
        }
      }
    ],
    hangUntilPermissionReply: true
  });
  const { adapter: adapter2 } = buildAdapter({ client: client2 });
  let asked2 = false;
  const req2 = streamRequest({
    onToolApprovalRequested: () => {
      asked2 = true;
    }
  }).request;

  const stream2 = adapter2.streamChat(req2);
  await until(() => asked2);

  await adapter2.respondToQuestion('q_ask_2', {
    'question-0-choice': ['Two']
  });
  await stream2;

  assert.equal(calls2.questionReplies.length, 1);
  assert.deepEqual(calls2.questionReplies[0], {
    requestId: 'q_ask_2',
    answers: [['Two']]
  });
});

test('reconnect recovers pending questions and permissions from server', async () => {
  const { client } = fakeClient({
    sessions: new Set(['ses_resumed']),
    initialQuestions: [
      {
        id: 'q_server_1',
        sessionID: 'ses_resumed',
        questions: [{ header: 'Pending', question: 'Still waiting?', options: [] }]
      }
    ],
    initialPermissions: [
      {
        id: 'p_server_1',
        sessionID: 'ses_resumed',
        permission: 'bash',
        patterns: ['git status']
      }
    ]
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_resumed', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const asked: string[] = [];
  const req = streamRequest({
    onToolApprovalRequested: (event) => {
      asked.push(event.approvalId);
    }
  }).request;

  await adapter.streamChat(req);

  assert.equal(asked.includes('q_server_1'), true, 'recovered pending question on reconnect');
  assert.equal(asked.includes('p_server_1'), true, 'recovered pending permission on reconnect');
});

test("toOpenCodeVariant maps unified reasoning effort to OpenCode wire variant", () => {
  assert.equal(toOpenCodeVariant("low"), "low");
  assert.equal(toOpenCodeVariant("minimal"), "low");
  assert.equal(toOpenCodeVariant("medium"), "medium");
  assert.equal(toOpenCodeVariant("on"), "medium");
  assert.equal(toOpenCodeVariant("high"), "high");
  assert.equal(toOpenCodeVariant("xhigh"), "xhigh");
  assert.equal(toOpenCodeVariant("max"), "xhigh");
  assert.equal(toOpenCodeVariant("off"), undefined);
  assert.equal(toOpenCodeVariant(undefined), undefined);
});

test("request reasoning effort is mapped to variant and passed to client.prompt", async () => {
  const { client, calls } = fakeClient();
  const { adapter } = buildAdapter({ client });

  const { request: reqHigh } = streamRequest({ reasoningEffort: "high" });
  await adapter.streamChat(reqHigh);
  assert.equal(calls.prompts[0]?.variant, "high");

  const { request: reqMax } = streamRequest({ reasoningEffort: "max" });
  await adapter.streamChat(reqMax);
  assert.equal(calls.prompts[1]?.variant, "xhigh");

  const { request: reqOff } = streamRequest({ reasoningEffort: "off" });
  await adapter.streamChat(reqOff);
  assert.equal(calls.prompts[2]?.variant, undefined);

  const { request: reqDefault } = streamRequest();
  await adapter.streamChat(reqDefault);
  assert.equal(calls.prompts[3]?.variant, undefined);
});

test("child session permission asks are routed to the parent turn via ancestry (PR #8480)", async () => {
  const { client, calls } = fakeClient({
    sessions: new Set(["ses_known", "ses_subagent_1"]),
    parentsBySession: new Map([["ses_subagent_1", "ses_known"]]),
    events: [
      {
        id: "evt_p1",
        type: "permission.asked",
        properties: {
          id: "req_subagent_bash",
          sessionID: "ses_subagent_1",
          permission: "bash",
          patterns: ["npm test"],
          metadata: {}
        }
      }
    ],
    hangUntilPermissionReply: true
  });
  const store = memoryStore({ conversationId: "conv_1", sessionId: "ses_known", directory: "/proj" });
  const { adapter } = buildAdapter({ client, store });

  let asked = false;
  let receivedApprovalId: string | null = null;
  const { request } = streamRequest({
    onToolApprovalRequested: (event) => {
      asked = true;
      receivedApprovalId = event.approvalId;
    }
  });

  const stream = adapter.streamChat(request);
  await until(() => asked);

  assert.equal(receivedApprovalId, "req_subagent_bash");
  await adapter.resolveApproval("req_subagent_bash", "approve");
  await stream;

  assert.equal(calls.replies.length, 1);
  assert.deepEqual(calls.replies[0], {
    requestId: "req_subagent_bash",
    reply: "once"
  });
});

test("full-access mode auto-answers child question asks without blocking (PR #8480 + PR #9282)", async () => {
  const { client, calls } = fakeClient({
    sessions: new Set(["ses_known", "ses_subagent_3"]),
    parentsBySession: new Map([["ses_subagent_3", "ses_known"]]),
    events: [
      {
        id: "evt_q3",
        type: "question.asked",
        properties: {
          id: "req_child_q",
          sessionID: "ses_subagent_3",
          questions: [
            {
              header: "Choice",
              question: "Pick one",
              options: [{ label: "Option A" }, { label: "Option B" }]
            }
          ]
        }
      }
    ]
  });
  const store = memoryStore({ conversationId: "conv_1", sessionId: "ses_known", directory: "/proj" });
  const { adapter } = buildAdapter({ client, store });

  let modalShown = false;
  const { request } = streamRequest({
    toolPermissionMode: "full-access",
    onToolApprovalRequested: () => {
      modalShown = true;
    }
  });

  await adapter.streamChat(request);

  assert.equal(modalShown, false, "Modal should be suppressed in full-access mode");
  assert.equal(calls.replies.length, 0, "question must not go over the permission wire");
  assert.equal(calls.questionReplies.length, 1);
  assert.deepEqual(calls.questionReplies[0], {
    requestId: "req_child_q",
    answers: [["Option A"]]
  });
  // No leaked pending entry: a later user decision must be a no-op, not a double reply.
  await adapter.resolveApproval("req_child_q", "approve");
  assert.equal(calls.questionReplies.length, 1);
});
test("full-access mode auto-approves child session asks without blocking (PR #8480 + PR #9282)", async () => {
  const { client, calls } = fakeClient({
    sessions: new Set(["ses_known", "ses_subagent_2"]),
    parentsBySession: new Map([["ses_subagent_2", "ses_known"]]),
    events: [
      {
        id: "evt_p2",
        type: "permission.asked",
        properties: {
          id: "req_child_doom",
          sessionID: "ses_subagent_2",
          permission: "doom_loop",
          patterns: [],
          metadata: {}
        }
      }
    ],
    hangUntilPermissionReply: true
  });
  const store = memoryStore({ conversationId: "conv_1", sessionId: "ses_known", directory: "/proj" });
  const { adapter } = buildAdapter({ client, store });

  let modalShown = false;
  const { request } = streamRequest({
    toolPermissionMode: "full-access",
    onToolApprovalRequested: () => {
      modalShown = true;
    }
  });

  await adapter.streamChat(request);

  assert.equal(modalShown, false, "Modal should be suppressed in full-access mode");
  assert.equal(calls.replies.length, 1);
  assert.deepEqual(calls.replies[0], {
    requestId: "req_child_doom",
    reply: "once"
  });
});
