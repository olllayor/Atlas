import assert from 'node:assert/strict';
import test from 'node:test';

import { McpAuditLog } from '../src/main/ai/mcp/McpAuditLog.js';
import type { PluginAuditStore } from '../src/main/ai/mcp/McpAuditLog.js';
import type { PluginAuditRecord } from '../src/shared/pluginAudit.js';

/**
 * The observational contract, and the durable/in-memory duality.
 *
 * `PluginAuditRepo` is exercised directly against real SQLite in
 * `pluginAuditRepo.test.ts`; this file is about `McpAuditLog` itself — that it
 * never throws, that both modes dedupe identically, and that the in-memory
 * fallback (what every existing test in the plugin work already relies on)
 * still behaves once idempotency joined the API.
 */

const BASE = {
  requestId: 'req-1',
  conversationId: 'conv-1',
  type: 'mcp_call' as const,
  server: null,
  plugin: null,
  tool: 'search',
  outcome: 'ok' as const,
  approvalId: null,
  toolCallId: 'call-1',
  detail: null
};

/** A store that fails every write, for the never-throws test. */
function brokenStore(): PluginAuditStore {
  return {
    append: () => {
      throw new Error('disk is on fire');
    },
    forRequest: () => [],
    forConversation: () => []
  };
}

function fakeStore(): PluginAuditStore & { records: PluginAuditRecord[] } {
  const records: PluginAuditRecord[] = [];
  const seen = new Set<string>();

  return {
    records,
    append: (record, idempotencyKey) => {
      if (seen.has(idempotencyKey)) return false;
      seen.add(idempotencyKey);
      records.push(record);
      return true;
    },
    forRequest: (requestId) => records.filter((r) => r.requestId === requestId),
    forConversation: (conversationId) => records.filter((r) => r.conversationId === conversationId)
  };
}

/* ------------------------------------------------------------------ *
 * In-memory mode
 * ------------------------------------------------------------------ */

test('without a store, records live in memory and are retrievable', () => {
  const log = new McpAuditLog();
  log.record({ ...BASE, idempotencyKey: 'k1' });

  assert.equal(log.size, 1);
  assert.equal(log.forRequest('req-1').length, 1);
  assert.equal(log.forConversation('conv-1').length, 1);
});

test('the in-memory path dedupes by idempotency key exactly like the durable one', () => {
  const log = new McpAuditLog();
  log.record({ ...BASE, idempotencyKey: 'k1', detail: 'first' });
  log.record({ ...BASE, idempotencyKey: 'k1', detail: 'second' });

  assert.equal(log.size, 1);
  assert.equal(log.forRequest('req-1')[0].detail, 'first', 'the first write wins, not the retry');
});

test('a different idempotency key is a different record even with identical content', () => {
  const log = new McpAuditLog();
  log.record({ ...BASE, idempotencyKey: 'k1' });
  log.record({ ...BASE, idempotencyKey: 'k2' });

  assert.equal(log.size, 2);
});

test('the in-memory ring evicts oldest first and forgets the evicted key', () => {
  const log = new McpAuditLog();

  for (let i = 0; i < 2_001; i += 1) {
    log.record({ ...BASE, toolCallId: `call-${i}`, idempotencyKey: `k${i}` });
  }

  assert.equal(log.size, 2_000, 'bounded');
  assert.equal(log.forRequest('req-1').some((r) => r.toolCallId === 'call-0'), false, 'the oldest fell off');

  // The evicted key must be forgotten, not just the record — otherwise a
  // legitimately-repeated key later in a long session would be refused
  // forever by a Set entry nothing can ever remove.
  log.record({ ...BASE, toolCallId: 'call-0-again', idempotencyKey: 'k0' });
  assert.equal(log.size, 2_000, 'still bounded after the re-admitted key');
});

/* ------------------------------------------------------------------ *
 * Durable mode
 * ------------------------------------------------------------------ */

test('with a store, writes and reads go through it, not the in-memory ring', () => {
  const store = fakeStore();
  const log = new McpAuditLog(store);

  log.record({ ...BASE, idempotencyKey: 'k1' });

  assert.equal(store.records.length, 1);
  assert.equal(log.size, 0, 'the in-memory ring stays empty when a store is present');
  assert.equal(log.forRequest('req-1').length, 1, 'reads still answer, from the store');
});

test('the durable path also relies on the store for dedup', () => {
  const store = fakeStore();
  const log = new McpAuditLog(store);

  log.record({ ...BASE, idempotencyKey: 'k1' });
  log.record({ ...BASE, idempotencyKey: 'k1', detail: 'retry' });

  assert.equal(store.records.length, 1);
});

/* ------------------------------------------------------------------ *
 * Never throws
 * ------------------------------------------------------------------ */

test('a store that throws does not propagate — the caller is a tool call, not this log', () => {
  const log = new McpAuditLog(brokenStore());

  assert.doesNotThrow(() => log.record({ ...BASE, idempotencyKey: 'k1' }));
});

test('a payload that cannot be serialised does not propagate either', () => {
  const log = new McpAuditLog();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  assert.doesNotThrow(() => log.record({ ...BASE, idempotencyKey: 'k1', payload: cyclic }));
});

/* ------------------------------------------------------------------ *
 * clear()
 * ------------------------------------------------------------------ */

test('clear empties the in-memory ring and its dedup set', () => {
  const log = new McpAuditLog();
  log.record({ ...BASE, idempotencyKey: 'k1' });
  log.clear();

  assert.equal(log.size, 0);

  // Re-admitting the same key after a clear must succeed — a cleared log has
  // no memory of anything, dedup included.
  log.record({ ...BASE, idempotencyKey: 'k1' });
  assert.equal(log.size, 1);
});
