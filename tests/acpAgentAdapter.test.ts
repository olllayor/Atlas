import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import { AcpAgentAdapter, type AcpDriverClient } from '../src/main/ai/acp/AcpAgentAdapter.js';
import type { OpenCodeSessionStore } from '../src/main/ai/providers/opencode/OpenCodeAgentAdapter.js';
import type { AcpSessionInfo } from '../src/main/ai/acp/acpClient.js';

/** The agent under test: any ACP CLI; Claude Code is the one Atlas ships with. */
const AGENT = { providerId: 'claude-code', agentLabel: 'Claude Code' } as const;

const USER_TURN: ModelMessage[] = [{ role: 'user', content: 'ship it' }];

function memoryStore(seed?: { conversationId: string; sessionId: string; directory: string }) {
  const rows = new Map<string, { sessionId: string; directory: string; schemaVersion?: number; transport?: 'sdk' | 'acp' }>();
  if (seed) {
    rows.set(seed.conversationId, { sessionId: seed.sessionId, directory: seed.directory, transport: 'acp' });
  }
  return {
    rows,
    get: (conversationId: string) => rows.get(conversationId) ?? null,
    set: ({ conversationId, sessionId, directory, transport }: { conversationId: string; sessionId: string; directory: string; transport?: 'sdk' | 'acp' }) => {
      rows.set(conversationId, { sessionId, directory, transport });
    },
    clear: (conversationId: string) => {
      rows.delete(conversationId);
    }
  };
}

type FakeAcpOptions = {
  sessions?: string[];
  resumeError?: unknown;
  setModelError?: unknown;
  catalog?: Array<{ value: string; name: string }>;
  promptText?: string;
  stopReason?: string;
  hangUntilCancel?: boolean;
  raiseAsk?: { approvalId: string; toolCallId: string };
  /** Hold the prompt open until the test drives frames, then resolves. */
  promptGate?: () => Promise<void>;
};

function fakeAcpClient(options: FakeAcpOptions = {}) {
  const calls = {
    started: 0,
    created: 0,
    forked: [] as Array<{ sessionId: string; directory: string }>,
    resumed: [] as string[],
    setModels: [] as Array<{ sessionId: string; value: string }>,
    prompts: [] as Array<{ sessionId: string; blocks: readonly unknown[] }>,
    cancels: [] as string[],
    closed: [] as string[],
    permissionReplies: [] as Array<{ approvalId: string; decision: string }>
  };
  const sessions = new Set(options.sessions ?? []);
  let createdCount = 0;
  let forkCount = 0;
  let cancelResolve: (() => void) | null = null;
  let permissionHandler: ((ask: { approvalId: string; toolCallId: string | null }) => void) | null = null;
  const updateHandlers = new Set<(update: Record<string, unknown>) => void>();

  const client: AcpDriverClient & {
    emitUpdate(update: Record<string, unknown>): void;
  } = {
    async start() {
      calls.started += 1;
      return {};
    },
    async createSession(): Promise<AcpSessionInfo> {
      calls.created += 1;
      createdCount += 1;
      const id = `ses_acp_${createdCount}`;
      sessions.add(id);
      return {
        sessionId: id,
        models: options.catalog ?? [{ value: 'opencode/big-pickle', name: 'Big Pickle' }],
        currentModel: 'opencode/big-pickle'
      };
    },
    async resumeSession(sessionId): Promise<AcpSessionInfo> {
      calls.resumed.push(sessionId);
      if (options.resumeError) {
        throw options.resumeError;
      }
      if (!sessions.has(sessionId)) {
        throw new Error(`NotFoundError: session ${sessionId} not found (404)`);
      }
      return { sessionId, models: [], currentModel: null };
    },
    async forkSession(sessionId, directory): Promise<AcpSessionInfo> {
      calls.forked.push({ sessionId, directory });
      if (!sessions.has(sessionId)) {
        throw new Error(`NotFoundError: session ${sessionId} not found (404)`);
      }
      forkCount += 1;
      const id = `ses_fork_${forkCount}`;
      sessions.add(id);
      return { sessionId: id, models: [], currentModel: null };
    },
    async setModel(sessionId, value): Promise<AcpSessionInfo> {
      calls.setModels.push({ sessionId, value });
      if (options.setModelError) {
        throw options.setModelError;
      }
      return { sessionId, models: [], currentModel: value };
    },
    async prompt(sessionId, blocks, onChunk) {
      calls.prompts.push({ sessionId, blocks: [...blocks] });
      if (options.raiseAsk) {
        permissionHandler?.({
          approvalId: options.raiseAsk.approvalId,
          toolCallId: options.raiseAsk.toolCallId
        });
        // Let the test resolve the ask before the turn completes.
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      if (options.promptGate) {
        await options.promptGate();
      }
      if (options.hangUntilCancel) {
        await new Promise<void>((resolve) => {
          cancelResolve = resolve;
        });
        return { stopReason: 'cancelled', text: '', thought: '', skipped: [], usage: {} };
      }
      const body = options.promptText ?? 'acp answer';
      onChunk?.({ kind: 'text', delta: body });
      return {
        stopReason: options.stopReason ?? 'end_turn',
        text: body,
        thought: '',
        skipped: [],
        usage: { inputTokens: 10, outputTokens: 2, cachedReadTokens: 1 }
      };
    },
    cancel(sessionId) {
      calls.cancels.push(sessionId);
      cancelResolve?.();
    },
    async closeSession(sessionId) {
      calls.closed.push(sessionId);
      sessions.delete(sessionId);
    },
    setPermissionHandler(handler) {
      permissionHandler = handler;
    },
    handleSessionUpdate(handler) {
      const wrapped = handler as (update: Record<string, unknown>) => void;
      updateHandlers.add(wrapped);
      return () => {
        updateHandlers.delete(wrapped);
      };
    },
    /** Test seam: drive a session update through the turn's subscribers. */
    emitUpdate(update: Record<string, unknown>) {
      for (const handler of [...updateHandlers]) {
        handler(update);
      }
    },
    resolvePermission(approvalId, decision) {
      calls.permissionReplies.push({ approvalId, decision });
    }
  };

  return { client, calls };
}

function buildAdapter(
  overrides: {
    client?: AcpDriverClient;
    store?: OpenCodeSessionStore;
    clientDirs?: string[];
  } = {}
) {
  const store = overrides.store ?? memoryStore();
  const clientDirs = overrides.clientDirs ?? [];
  const client = overrides.client ?? fakeAcpClient().client;
  const adapter = new AcpAgentAdapter({
    ...AGENT,
    readSettings: () => ({ customModels: [] }),
    getClient: (directory) => {
      clientDirs.push(directory);
      return client;
    },
    sessions: store,
    defaultDirectory: () => '/proj'
  });
  return { adapter, store };
}

function streamRequest(
  overrides: {
    modelId?: string;
    messages?: ModelMessage[];
    agentContext?: { conversationId: string; workspaceRoot?: string | null };
  } = {}
) {
  const controller = new AbortController();
  const chunks: string[] = [];
  const notices: Array<{ code: string }> = [];
  const request = {
    apiKey: '',
    modelId: overrides.modelId ?? 'opencode/big-pickle',
    messages: overrides.messages ?? USER_TURN,
    agentContext: overrides.agentContext ?? { conversationId: 'conv_1', workspaceRoot: '/proj' },
    signal: controller.signal,
    onChunk: ({ delta }: { delta: string }) => {
      chunks.push(delta);
    },
    onNotice: (event: { code: string }) => {
      notices.push({ code: event.code });
    }
  } as Parameters<AcpAgentAdapter['streamChat']>[0];
  return { request, controller, chunks, notices };
}

function promptText(blocks: readonly unknown[]): string {
  return blocks
    .map((block) => ((block as { text?: unknown }).text))
    .filter((text): text is string => typeof text === 'string')
    .join('\n\n');
}

test('a fresh conversation creates a session, sets the model, and seeds history', async () => {
  const { client, calls } = fakeAcpClient();
  const store = memoryStore();
  const { adapter } = buildAdapter({ client, store });

  const { request, chunks, notices } = streamRequest({
    messages: [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'ship it' }
    ]
  });
  const result = await adapter.streamChat(request);

  assert.equal(calls.created, 1);
  assert.deepEqual(calls.setModels, [{ sessionId: 'ses_acp_1', value: 'opencode/big-pickle' }]);
  assert.match(promptText(calls.prompts[0]!.blocks), /first answer/);
  assert.match(promptText(calls.prompts[0]!.blocks), /ship it/);
  assert.equal(store.get('conv_1')!.sessionId, 'ses_acp_1');
  assert.deepEqual(chunks, ['acp answer']);
  assert.equal(result.content, 'acp answer');
  assert.equal(result.inputTokens, 11);
  assert.equal(result.cachedInputTokens, 1);
  assert.ok(notices.some((notice) => notice.code === 'opencode.toolsDelegated'));
  assert.ok(!notices.some((notice) => notice.code === 'opencode.acpApprovalsDenied'));
});

test('a stored session resumes in place without recreating', async () => {
  const { client, calls } = fakeAcpClient({ sessions: ['ses_known'] });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const { request } = streamRequest();
  await adapter.streamChat(request);

  assert.deepEqual(calls.resumed, ['ses_known']);
  assert.equal(calls.created, 0);
  assert.equal(calls.prompts[0]!.sessionId, 'ses_known');
  // Resumed history stays server-side: only the new turn goes out.
  assert.deepEqual(promptText(calls.prompts[0]!.blocks), 'ship it');
});

test('a confirmed miss recreates and re-points the cursor', async () => {
  const { client, calls } = fakeAcpClient();
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_gone', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.deepEqual(calls.resumed, ['ses_gone']);
  assert.equal(calls.created, 1);
  assert.equal(store.get('conv_1')!.sessionId, 'ses_acp_1');
});

test('a resume failure that is not a miss fails the turn', async () => {
  const { client, calls } = fakeAcpClient({ resumeError: new Error('socket hang up') });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  await assert.rejects(adapter.streamChat(streamRequest().request), /socket hang up/);
  assert.equal(calls.created, 0);
  assert.equal(store.get('conv_1')!.sessionId, 'ses_known');
});

test('a directory move forks the stored session instead of starting fresh', async () => {
  const { client, calls } = fakeAcpClient({ sessions: ['ses_known'] });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/old' });
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.deepEqual(calls.forked, [{ sessionId: 'ses_known', directory: '/proj' }]);
  assert.equal(calls.created, 0);
  assert.equal(calls.prompts[0]!.sessionId, 'ses_fork_1');
  assert.deepEqual(promptText(calls.prompts[0]!.blocks), 'ship it');
  assert.equal(store.get('conv_1')!.sessionId, 'ses_fork_1');
  assert.equal(store.get('conv_1')!.directory, '/proj');
});

test('a forked 404 falls back to a fresh seeded session', async () => {
  const { client, calls } = fakeAcpClient();
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_gone', directory: '/old' });
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.equal(calls.forked.length, 1);
  assert.equal(calls.created, 1);
  assert.equal(store.get('conv_1')!.directory, '/proj');
});

test('an unknown session model fails the turn loudly', async () => {
  const { client } = fakeAcpClient({ setModelError: new Error('unknown model oh-no') });
  const store = memoryStore();
  const { adapter } = buildAdapter({ client, store });

  await assert.rejects(
    adapter.streamChat(streamRequest({ modelId: 'opencode/oh-no' }).request),
    /unknown model/
  );
});

test('abort cancels the ACP session and fails as an abort', async () => {
  const { client, calls } = fakeAcpClient({ sessions: ['ses_known'], hangUntilCancel: true });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const { request, controller } = streamRequest();
  const pending = adapter.streamChat(request);
  setTimeout(() => controller.abort(), 5);

  await assert.rejects(pending, (error: Error) => error.name === 'AbortError');
  assert.deepEqual(calls.cancels, ['ses_known']);
});

test('a context-less call uses a disposable session that is closed after', async () => {
  const { client, calls } = fakeAcpClient();
  const { adapter } = buildAdapter({ client, store: memoryStore() });

  const { request } = streamRequest();
  const { agentContext: _dropped, ...withoutContext } = request;
  void _dropped;
  await adapter.streamChat(withoutContext);

  assert.equal(calls.created, 1);
  assert.deepEqual(calls.closed, ['ses_acp_1']);
});

test('listModels maps the session catalog and closes the probe session', async () => {
  const { client, calls } = fakeAcpClient({
    catalog: [
      { value: 'opencode/big-pickle', name: 'Big Pickle' },
      { value: 'opencode/other', name: 'Other' }
    ]
  });
  const { adapter } = buildAdapter({ client });

  const models = await adapter.listModels();
  assert.deepEqual(
    models.map((model) => [model.id, model.label]),
    [
      ['opencode/big-pickle', 'Big Pickle'],
      ['opencode/other', 'Other']
    ]
  );
  assert.equal(models[0]!.providerId, 'claude-code');
  assert.equal(models[0]!.supportsTemperature, false);
  assert.deepEqual(calls.closed, ['ses_acp_1']);
});

test('image and remote attachments map to file bytes and path fallbacks', async () => {
  const { client, calls } = fakeAcpClient();
  const store = memoryStore();
  const { adapter } = buildAdapter({ client, store });

  const { request, notices } = streamRequest({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at these' },
          {
            type: 'image',
            image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEA',
            mediaType: 'image/png'
          },
          {
            type: 'file',
            data: 'https://example.com/blob.zip',
            mediaType: 'application/zip',
            filename: 'blob.zip'
          }
        ]
      }
    ]
  });
  await adapter.streamChat(request);

  const blocks = calls.prompts[0]!.blocks as Array<Record<string, unknown>>;
  assert.deepEqual(blocks[0], { type: 'text', text: 'look at these' });
  assert.equal(blocks[1]?.type, 'file-bytes');
  assert.equal(blocks[1]?.mime, 'image/png');
  assert.ok(notices.some((notice) => notice.code === 'opencode.acpFilesDeferred'));
});

test('permission asks surface and resolve through the client exactly once', async () => {
  const { client, calls } = fakeAcpClient({
    sessions: ['ses_known'],
    raiseAsk: { approvalId: 'call_9', toolCallId: 'call_9' }
  });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const asked: Array<{ approvalId: string; toolCallId: string }> = [];
  const resolved: string[] = [];
  const { request } = streamRequest();
  const pending = adapter.streamChat({
    ...request,
    onToolApprovalRequested: (event: { approvalId: string; toolCallId: string }) => {
      asked.push({ approvalId: event.approvalId, toolCallId: event.toolCallId });
    },
    onToolApprovalResolved: (event: { approvalId: string }) => {
      resolved.push(event.approvalId);
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(asked, [{ approvalId: 'call_9', toolCallId: 'call_9' }]);

  await adapter.resolveApproval('call_9', 'deny');
  await adapter.resolveApproval('call_9', 'deny');
  await pending;

  assert.deepEqual(calls.permissionReplies, [{ approvalId: 'call_9', decision: 'deny' }]);
  assert.deepEqual(resolved, ['call_9']);
});

test('the system prompt rides as the first text block', async () => {
  const { client, calls } = fakeAcpClient({ sessions: ['ses_known'] });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const { request } = streamRequest();
  await adapter.streamChat({ ...request, system: 'You are Atlas. Be terse.' });

  const blocks = calls.prompts[0]!.blocks as Array<Record<string, unknown>>;
  assert.deepEqual(blocks[0], { type: 'text', text: 'You are Atlas. Be terse.' });
  assert.deepEqual(blocks[1], { type: 'text', text: 'ship it' });
});

test('tool calls surface start, input, and output with the shared lifecycle', async () => {
  let releasePrompt!: () => void;
  const gate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const { client, calls: turnCalls } = fakeAcpClient({ sessions: ['ses_known'], promptGate: () => gate });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const started: unknown[] = [];
  const inputs: unknown[] = [];
  const outputs: unknown[] = [];
  const errors: unknown[] = [];
  const { request } = streamRequest();
  const pending = adapter.streamChat({
    ...request,
    onToolInputStart: (event) => {
      started.push(event);
    },
    onToolInputAvailable: (event) => {
      inputs.push(event);
    },
    onToolOutputAvailable: (event) => {
      outputs.push(event);
    },
    onToolOutputError: (event) => {
      errors.push(event);
    }
  });
  // The turn subscribes before the fake prompt runs, so reaching the prompt
  // means every frame below lands on a live subscriber.
  while (turnCalls.prompts.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  client.emitUpdate({
    sessionId: 'ses_known',
    kind: 'tool_call',
    toolCallId: 'call_1',
    title: 'read',
    toolKind: 'read',
    status: 'pending'
  });
  client.emitUpdate({
    sessionId: 'ses_known',
    kind: 'tool_call_update',
    toolCallId: 'call_1',
    title: 'read',
    toolKind: 'read',
    status: 'in_progress',
    input: { filePath: '/proj/a.txt' }
  });
  // Repeated input snapshots do not re-emit.
  client.emitUpdate({
    sessionId: 'ses_known',
    kind: 'tool_call_update',
    toolCallId: 'call_1',
    title: 'read',
    toolKind: 'read',
    status: 'in_progress',
    input: { filePath: '/proj/a.txt' }
  });
  client.emitUpdate({
    sessionId: 'ses_known',
    kind: 'tool_call_update',
    toolCallId: 'call_1',
    title: 'proj/a.txt',
    toolKind: 'read',
    status: 'completed',
    input: { filePath: '/proj/a.txt' },
    outputText: 'hello'
  });
  // A late duplicate terminal state cannot repeat the output.
  client.emitUpdate({
    sessionId: 'ses_known',
    kind: 'tool_call_update',
    toolCallId: 'call_1',
    status: 'completed',
    outputText: 'hello'
  });
  client.emitUpdate({
    sessionId: 'other',
    kind: 'tool_call',
    toolCallId: 'call_x',
    title: 'bash'
  });
  releasePrompt();
  await pending;

  assert.equal(started.length, 1);
  assert.deepEqual(started[0], {
    toolCallId: 'call_1',
    toolName: 'read',
    dynamic: true,
    providerExecuted: true
  });
  assert.equal(inputs.length, 1);
  assert.deepEqual(inputs[0], {
    toolCallId: 'call_1',
    toolName: 'read',
    input: { filePath: '/proj/a.txt' },
    dynamic: true,
    providerExecuted: true,
    title: 'read'
  });
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0], {
    toolCallId: 'call_1',
    toolName: 'read',
    input: { filePath: '/proj/a.txt' },
    output: 'hello',
    dynamic: true,
    providerExecuted: true,
    title: 'proj/a.txt'
  });
  assert.deepEqual(errors, []);
});

test('failed tool calls report errors, never success', async () => {
  let releasePrompt!: () => void;
  const gate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const { client, calls: turnCalls } = fakeAcpClient({ sessions: ['ses_known'], promptGate: () => gate });
  const store = memoryStore({ conversationId: 'conv_1', sessionId: 'ses_known', directory: '/proj' });
  const { adapter } = buildAdapter({ client, store });

  const outputs: unknown[] = [];
  const errors: unknown[] = [];
  const { request } = streamRequest();
  const pending = adapter.streamChat({
    ...request,
    onToolOutputAvailable: (event) => {
      outputs.push(event);
    },
    onToolOutputError: (event) => {
      errors.push(event);
    }
  });
  while (turnCalls.prompts.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  client.emitUpdate({
    sessionId: 'ses_known',
    kind: 'tool_call',
    toolCallId: 'call_2',
    title: 'read'
  });
  client.emitUpdate({
    sessionId: 'ses_known',
    kind: 'tool_call_update',
    toolCallId: 'call_2',
    title: 'read',
    status: 'failed',
    input: { filePath: '/proj/missing.txt' },
    errorText: 'File not found: /proj/missing.txt'
  });
  releasePrompt();
  await pending;

  assert.deepEqual(outputs, []);
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0], {
    toolCallId: 'call_2',
    toolName: 'read',
    input: { filePath: '/proj/missing.txt' },
    errorText: 'File not found: /proj/missing.txt',
    dynamic: true,
    providerExecuted: true,
    title: 'read'
  });
});

test('a foreign-transport cursor is a miss, never resumed', async () => {
  const { client, calls } = fakeAcpClient();
  const store = memoryStore();
  store.rows.set('conv_1', { sessionId: 'ses_sdk', directory: '/proj', transport: 'sdk' });
  const { adapter } = buildAdapter({ client, store });

  await adapter.streamChat(streamRequest().request);

  assert.deepEqual(calls.resumed, []);
  assert.deepEqual(calls.forked, []);
  assert.equal(calls.created, 1);
  assert.equal(store.get('conv_1')!.transport, 'acp');
});
