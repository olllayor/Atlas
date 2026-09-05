import assert from 'node:assert/strict';
import test from 'node:test';

import { PtyService, type PtySessionEmit } from '../src/main/terminal/PtyService.js';
import type { TerminalHistoryRepo } from '../src/main/db/repositories/terminalHistoryRepo.js';

const NOOP_HISTORY: TerminalHistoryRepo = {
  record: () => undefined,
  recent: () => [],
  search: () => [],
  clear: () => undefined,
} as unknown as TerminalHistoryRepo;

test('PtyService adaptive batching: flushes interactive typing immediately', async () => {
  const emits: Array<{ data: string; kind: string }> = [];
  const emit: PtySessionEmit = (payload) => {
    emits.push({ data: payload.data, kind: payload.kind });
  };

  const service = new PtyService(emit, NOOP_HISTORY);
  // Start a shell
  const result = service.start('conv-1', 'term-1', null);
  assert.ok(result);

  // Allow startup banner to settle
  await new Promise((resolve) => setTimeout(resolve, 300));
  const baselineCount = emits.length;

  // Simulate typing a single key 'a'
  service.write('conv-1', 'term-1', 'a');
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Should have received the echo rapidly
  assert.ok(emits.length > baselineCount);

  service.kill('conv-1', 'term-1');
});
