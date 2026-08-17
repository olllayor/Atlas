import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import type { ProviderAdapter } from '../src/main/ai/core/ProviderAdapter.js';
import {
  SummaryRefreshService,
  sanitizeModelSummary,
} from '../src/main/ai/compaction/summaryRefresher.js';
import type { ConversationSummaryRecord } from '../src/main/db/repositories/conversationSummariesRepo.js';

type FakeStore = {
  get: (conversationId: string) => ConversationSummaryRecord | null;
  upsert: (input: {
    conversationId: string;
    fingerprint: string;
    rollingSummary: string;
    source: 'heuristic' | 'model';
    status: 'ready' | 'building';
  }) => ConversationSummaryRecord;
  deleteForConversation: (conversationId: string) => void;
  rows: Map<string, ConversationSummaryRecord>;
  upserts: Array<{ status: string; source: string }>;
};

function createFakeStore(): FakeStore {
  const rows = new Map<string, ConversationSummaryRecord>();
  const upserts: Array<{ status: string; source: string }> = [];

  return {
    rows,
    upserts,
    get: (conversationId) => rows.get(conversationId) ?? null,
    upsert: (input) => {
      upserts.push({ status: input.status, source: input.source });
      const record: ConversationSummaryRecord = {
        conversationId: input.conversationId,
        fingerprint: input.fingerprint,
        rollingSummary: input.rollingSummary,
        source: input.source,
        status: input.status,
        updatedAt: new Date().toISOString(),
      };
      rows.set(input.conversationId, record);
      return record;
    },
    deleteForConversation: (conversationId) => {
      rows.delete(conversationId);
    },
  };
}

function createOlderMessages(): ModelMessage[] {
  return [
    { role: 'user', content: 'Build a context manager. It must stay bounded.' },
    { role: 'assistant', content: 'Decision: ship deterministic summarization first.' },
    { role: 'user', content: 'Now add persistence?' },
    { role: 'assistant', content: 'Added a conversation_summaries table.' },
  ];
}

function createService(options: {
  store: FakeStore;
  adapter?: ProviderAdapter;
  apiKey?: string | null;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
}) {
  const { store } = options;
  const providers = new Map<string, ProviderAdapter>();
  if (options.adapter) {
    providers.set('openrouter', options.adapter);
  }

  return new SummaryRefreshService({
    conversationsRepo: {
      getSummary: () => ({
        defaultProviderId: options.defaultProviderId ?? 'openrouter',
        defaultModelId: options.defaultModelId ?? 'test/model',
      }) as never,
    },
    modelsRepo: { getRuntimeHints: () => undefined as never },
    // `=== undefined` on purpose: an explicit null means "no key stored".
    keychain: { getSecret: async () => (options.apiKey === undefined ? 'test-key' : options.apiKey) },
    providers,
    summaries: store,
  });
}

function createAdapter(options: {
  content?: string;
  fail?: boolean;
  capture?: { requests: Array<{ system?: string; messages: ModelMessage[] }> };
}): ProviderAdapter {
  return {
    providerId: 'openrouter',
    validateCredential: async () => undefined,
    listModels: async () => [],
    streamChat: async (request) => {
      options.capture?.requests.push({ system: request.system, messages: request.messages });
      if (options.fail) {
        throw new Error('provider exploded');
      }
      return { content: options.content ?? '', latencyMs: 1 };
    },
  } as ProviderAdapter;
}

test('a successful refresh upgrades the summary to a ready model row', async () => {
  const store = createFakeStore();
  const capture = { requests: [] as Array<{ system?: string; messages: ModelMessage[] }> };
  const modelSummary = 'Goals:\n- build a context manager\n\nDecisions:\n- deterministic first\n\nConstraints:\n- must stay bounded\n\nOpen loops:\n- persistence';
  const service = createService({
    store,
    adapter: createAdapter({ content: modelSummary, capture }),
  });

  await service.refresh('conversation-1', 'fp-1', createOlderMessages());

  const row = store.get('conversation-1');
  assert.ok(row);
  assert.equal(row.status, 'ready');
  assert.equal(row.source, 'model');
  assert.equal(row.fingerprint, 'fp-1');
  assert.equal(row.rollingSummary, modelSummary);
  // The crash lock was taken before the call and released after.
  assert.deepEqual(store.upserts, [
    { status: 'building', source: 'heuristic' },
    { status: 'ready', source: 'model' },
  ]);
  // The transcript carried the older messages, not a fresh prompt.
  assert.equal(capture.requests.length, 1);
  assert.match(String(capture.requests[0]?.messages[0]?.content), /context manager/);
});

test('a refresh without an API key leaves the store untouched', async () => {
  const store = createFakeStore();
  const service = createService({
    store,
    adapter: createAdapter({ content: 'Goals:\n- x' }),
    apiKey: null,
  });

  await service.refresh('conversation-2', 'fp-2', createOlderMessages());

  assert.equal(store.get('conversation-2'), null);
  assert.equal(store.upserts.length, 0);
});

test('a refresh without any provider leaves the store untouched', async () => {
  const store = createFakeStore();
  const service = createService({ store });

  await service.refresh('conversation-3', 'fp-3', createOlderMessages());

  assert.equal(store.get('conversation-3'), null);
  assert.equal(store.upserts.length, 0);
});

test('a failed provider call restores the previous heuristic row', async () => {
  const store = createFakeStore();
  store.upsert({
    conversationId: 'conversation-4',
    fingerprint: 'fp-4',
    rollingSummary: 'Goals:\n- heuristic draft',
    source: 'heuristic',
    status: 'ready',
  });
  store.upserts.length = 0;

  const service = createService({ store, adapter: createAdapter({ fail: true }) });
  await service.refresh('conversation-4', 'fp-4', createOlderMessages());

  const row = store.get('conversation-4');
  assert.ok(row);
  assert.equal(row.status, 'ready');
  assert.equal(row.source, 'heuristic');
  assert.equal(row.rollingSummary, 'Goals:\n- heuristic draft');
});

test('a failed provider call with no previous row clears the building lock', async () => {
  const store = createFakeStore();
  const service = createService({ store, adapter: createAdapter({ fail: true }) });

  await service.refresh('conversation-5', 'fp-5', createOlderMessages());

  assert.equal(store.get('conversation-5'), null);
});

test('an unusable model answer keeps the heuristic summary', async () => {
  const store = createFakeStore();
  store.upsert({
    conversationId: 'conversation-6',
    fingerprint: 'fp-6',
    rollingSummary: 'Goals:\n- heuristic draft',
    source: 'heuristic',
    status: 'ready',
  });
  store.upserts.length = 0;

  const service = createService({
    store,
    adapter: createAdapter({ content: 'I refuse to summarise this conversation.' }),
  });
  await service.refresh('conversation-6', 'fp-6', createOlderMessages());

  const row = store.get('conversation-6');
  assert.ok(row);
  assert.equal(row.source, 'heuristic');
  assert.equal(row.status, 'ready');
});

test('a second refresh for the same conversation is skipped while one is in flight', async () => {
  const store = createFakeStore();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const adapter: ProviderAdapter = {
    providerId: 'openrouter',
    validateCredential: async () => undefined,
    listModels: async () => [],
    streamChat: async () => {
      await gate;
      return { content: 'Goals:\n- finish the compaction work started earlier in this session', latencyMs: 1 };
    },
  } as ProviderAdapter;

  const service = createService({ store, adapter });
  const first = service.refresh('conversation-7', 'fp-7', createOlderMessages());
  const second = await service.refresh('conversation-7', 'fp-7', createOlderMessages());

  assert.equal(second, undefined);
  release?.();
  await first;

  // Exactly one building lock and one ready write: the duplicate never ran.
  assert.deepEqual(store.upserts, [
    { status: 'building', source: 'heuristic' },
    { status: 'ready', source: 'model' },
  ]);
});

test('a stale refresh does not clobber a newer fingerprint row written mid-flight', async () => {
  const store = createFakeStore();
  store.upsert({
    conversationId: 'conversation-8',
    fingerprint: 'fp-old',
    rollingSummary: 'Goals:\n- old heuristic',
    source: 'heuristic',
    status: 'ready',
  });

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const adapter: ProviderAdapter = {
    providerId: 'openrouter',
    validateCredential: async () => undefined,
    listModels: async () => [],
    streamChat: async () => {
      // While the model works, a new turn lands a fresh heuristic summary.
      store.upsert({
        conversationId: 'conversation-8',
        fingerprint: 'fp-new',
        rollingSummary: 'Goals:\n- new heuristic',
        source: 'heuristic',
        status: 'ready',
      });
      await gate;
      return { content: 'Goals:\n- stale model upgrade that must not win', latencyMs: 1 };
    },
  } as ProviderAdapter;

  const service = createService({ store, adapter });
  const refresh = service.refresh('conversation-8', 'fp-old', createOlderMessages());
  release?.();
  await refresh;

  const row = store.get('conversation-8');
  assert.ok(row);
  assert.equal(row.fingerprint, 'fp-new', 'the newer row owns the conversation');
  assert.equal(row.source, 'heuristic');
});

test('sanitizeModelSummary rejects thin or unstructured output', () => {
  assert.equal(sanitizeModelSummary(null), null);
  assert.equal(sanitizeModelSummary(''), null);
  assert.equal(sanitizeModelSummary('Goals:\n- x'), null, 'too short to be a useful memory block');
  assert.equal(sanitizeModelSummary('Just some prose without any section headers at all, long enough to pass the length check.'), null);

  const valid = 'Goals:\n- build the thing\n\nDecisions:\n- none captured';
  assert.equal(sanitizeModelSummary(valid), valid);
});

test('sanitizeModelSummary clamps a runaway answer', () => {
  const runaway = `Goals:\n- ${'x'.repeat(6_000)}`;
  const sanitized = sanitizeModelSummary(runaway);
  assert.ok(sanitized);
  assert.ok(sanitized.length <= 4_000);
  assert.ok(sanitized.endsWith('...'));
});
