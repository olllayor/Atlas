import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPILL_MAX_INLINE_BYTES,
  SPILL_SKIPPED_TOOL_NAMES,
  applySpillPolicy,
  buildSpillPreview,
  serializeToolResult,
  spillNotice,
  spillResult
} from '../src/main/ai/tools/spill/spillPolicy.js';

/** In-memory stand-in for the spill store. */
function createFakeStore(options: { fail?: boolean } = {}) {
  const saves: Array<{ conversationId: string; toolName: string; content: string }> = [];

  return {
    saves,
    saveText: async (input: { conversationId: string; toolName: string; content: string }) => {
      if (options.fail) {
        throw new Error('disk full');
      }

      saves.push(input);
      return { path: `/tmp/spills/${input.conversationId}/${saves.length}-${input.toolName}.txt`, bytes: Buffer.byteLength(input.content, 'utf8') };
    }
  };
}

test('serializeToolResult passes strings through and stringifies objects', () => {
  assert.equal(serializeToolResult('plain'), 'plain');
  assert.equal(serializeToolResult({ stdout: 'ok' }), JSON.stringify({ stdout: 'ok' }, null, 2));
  assert.equal(serializeToolResult(null), null);
  assert.equal(serializeToolResult(undefined), null);
});

test('serializeToolResult gives up on circular structures', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.equal(serializeToolResult(circular), null);
});

test('buildSpillPreview returns text untouched when it fits the budget', () => {
  const { preview, omittedBytes } = buildSpillPreview('short text', 1000);

  assert.equal(preview, 'short text');
  assert.equal(omittedBytes, 0);
});

test('buildSpillPreview keeps head and tail within the budget', () => {
  const text = 'a'.repeat(10_000);
  const { preview, omittedBytes } = buildSpillPreview(text, 1_000);

  assert.ok(Buffer.byteLength(preview, 'utf8') <= 1_000);
  assert.ok(preview.startsWith('a'));
  assert.ok(preview.endsWith('a'));
  assert.ok(preview.includes('…'));
  assert.ok(omittedBytes > 9_000 - 1_000);
});

test('buildSpillPreview never cuts inside a multi-byte character', () => {
  // 4-byte emoji: any odd budget lands mid-sequence without alignment.
  const text = '😀'.repeat(500);
  const { preview } = buildSpillPreview(text, 101);

  // A broken cut decodes to U+FFFD; a clean one round-trips.
  assert.equal(Buffer.from(preview, 'utf8').toString('utf8'), preview);
  assert.ok(!preview.includes('\uFFFD'));
});

test('spillNotice names the omitted size and the locator', () => {
  const notice = spillNotice(75_000, '/tmp/spills/c/1-bash.txt');

  assert.ok(notice.includes('73 KB'));
  assert.ok(notice.includes('/tmp/spills/c/1-bash.txt'));
  assert.ok(notice.includes('read_file'));
});

test('applySpillPolicy with a null store is a no-op', () => {
  const tools = { bash: { execute: async () => 'x' } };

  assert.equal(applySpillPolicy(tools, null), tools);
});

test('applySpillPolicy rejects a non-integer cap at assembly time', () => {
  const store = createFakeStore();

  assert.throws(
    () =>
      applySpillPolicy({ bash: { execute: async () => 'x' } }, {
        conversationId: 'c',
        store,
        maxInlineBytes: -1
      }),
    /non-negative integer/
  );
});

test('skipped tools and execute-less definitions pass through untouched', () => {
  const store = createFakeStore();
  const readExecute = async () => 'x';
  const schemaOnly = { description: 'no execute here' };

  const wrapped = applySpillPolicy(
    {
      read_file: { execute: readExecute },
      write_file: { execute: async () => 'y' },
      edit_file: { execute: async () => 'z' },
      git_diff: { execute: async () => 'd' },
      schema_only: schemaOnly
    },
    { conversationId: 'c', store }
  );

  assert.equal((wrapped.read_file as { execute: unknown }).execute, readExecute);
  assert.equal(wrapped.schema_only, schemaOnly);
  assert.ok(SPILL_SKIPPED_TOOL_NAMES.has('read_file'));
});

test('a result under the cap passes through with its shape intact', async () => {
  const store = createFakeStore();
  const original = { stdout: 'small output', stderr: '' };

  const wrapped = applySpillPolicy(
    { bash: { execute: async () => original } },
    { conversationId: 'c', store }
  );

  const result = await (wrapped.bash as { execute: () => Promise<unknown> }).execute();

  assert.equal(result, original);
  assert.equal(store.saves.length, 0);
});

test('an oversized result is spilled and replaced with preview plus locator', async () => {
  const store = createFakeStore();
  const big = { stdout: 'x'.repeat(SPILL_MAX_INLINE_BYTES * 2), stderr: '' };

  const wrapped = applySpillPolicy(
    { bash: { execute: async () => big } },
    { conversationId: 'conversation-9', store }
  );

  const result = await (wrapped.bash as { execute: () => Promise<unknown> }).execute();

  assert.equal(typeof result, 'string');
  const text = result as string;
  assert.ok(text.includes('Full result stored at:'));
  assert.ok(text.includes('conversation-9'));
  assert.ok(text.includes('read_file'));
  assert.ok(Buffer.byteLength(text, 'utf8') <= SPILL_MAX_INLINE_BYTES);

  assert.equal(store.saves.length, 1);
  assert.equal(store.saves[0]?.conversationId, 'conversation-9');
  assert.equal(store.saves[0]?.toolName, 'bash');
  assert.equal(store.saves[0]?.content, JSON.stringify(big, null, 2));
});

test('the replacement never exceeds the cap for a marginally-over result', async () => {
  const store = createFakeStore();
  const cap = 1_000;
  const justOver = 'y'.repeat(cap + 1);

  const wrapped = applySpillPolicy(
    { grep_search: { execute: async () => justOver } },
    { conversationId: 'c', store, maxInlineBytes: cap }
  );

  const result = (await (wrapped.grep_search as { execute: () => Promise<unknown> }).execute()) as string;

  assert.ok(Buffer.byteLength(result, 'utf8') <= cap);
});

test('a save failure keeps the original result and never throws', async () => {
  const store = createFakeStore({ fail: true });
  const big = 'z'.repeat(SPILL_MAX_INLINE_BYTES * 2);

  const wrapped = applySpillPolicy(
    { bash: { execute: async () => big } },
    { conversationId: 'c', store }
  );

  const result = await (wrapped.bash as { execute: () => Promise<unknown> }).execute();

  assert.equal(result, big);
});

test('when the notice alone exceeds the cap the original is kept', async () => {
  const store = createFakeStore();
  const big = 'w'.repeat(500);

  // Cap so small the locator line cannot fit: spilling would break the
  // advertised budget, so the policy must decline.
  const result = await spillResult(big, 'bash', { conversationId: 'c', store, maxInlineBytes: 40 }, 40);

  assert.equal(result, big);
  assert.equal(store.saves.length, 1); // The orphan was written; the sweep reclaims it.
});

test('wrapped execute forwards input and options to the original', async () => {
  const store = createFakeStore();
  const seen: unknown[] = [];

  const wrapped = applySpillPolicy(
    {
      bash: {
        execute: async (input: unknown, execOptions: unknown) => {
          seen.push(input, execOptions);
          return 'ok';
        }
      }
    },
    { conversationId: 'c', store }
  );

  const options = { toolCallId: 'call-1' };
  await (wrapped.bash as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({ command: 'ls' }, options);

  assert.deepEqual(seen, [{ command: 'ls' }, options]);
});

test('non-tool properties on a definition survive wrapping', async () => {
  const store = createFakeStore();

  const wrapped = applySpillPolicy(
    {
      bash: {
        description: 'run a command',
        needsApproval: true,
        execute: async () => 'ok'
      }
    },
    { conversationId: 'c', store }
  );

  const definition = wrapped.bash as { description: string; needsApproval: boolean };
  assert.equal(definition.description, 'run a command');
  assert.equal(definition.needsApproval, true);
});
