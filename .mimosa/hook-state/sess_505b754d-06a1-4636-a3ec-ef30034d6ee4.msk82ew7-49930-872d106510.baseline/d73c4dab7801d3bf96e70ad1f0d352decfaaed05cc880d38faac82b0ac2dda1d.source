import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIT_PAYLOAD_MAX_BYTES,
  buildAuditRecord,
  capForAudit,
  isRedactedValue,
  redactForAudit
} from '../src/shared/pluginAudit.js';

const AT = '2026-08-07T12:00:00.000Z';

/* ------------------------------------------------------------------ *
 * Redaction — structural first, shape-matching second
 * ------------------------------------------------------------------ */

test('a sensitive field name redacts its value and says so', () => {
  const out = redactForAudit({ query: 'bugs', api_key: 'abcd1234abcd1234' }) as Record<string, unknown>;

  assert.equal(out.query, 'bugs', 'ordinary fields survive — an audit has to stay diagnostic');
  assert.ok(isRedactedValue(out.api_key));
  assert.deepEqual(out.api_key, {
    __redacted: true,
    reason: 'sensitive-field',
    type: 'string',
    length: 16
  });
});

test('redaction preserves type, name and size so the call stays legible', () => {
  // "the token argument was a 64-character string" answers questions a missing
  // key cannot.
  const out = redactForAudit({ token: 'x'.repeat(64) }) as Record<string, unknown>;

  assert.equal(Object.keys(out)[0], 'token', 'the field name survives');
  assert.equal((out.token as { type: string }).type, 'string');
  assert.equal((out.token as { length: number }).length, 64);
});

test('sensitive names redact whatever they hold, not only strings', () => {
  const out = redactForAudit({ authorization: { scheme: 'Bearer', value: 'abc' } }) as Record<string, unknown>;

  assert.ok(isRedactedValue(out.authorization));
  assert.equal(JSON.stringify(out).includes('Bearer'), false);
});

test('redaction recurses through nested objects and arrays', () => {
  const out = redactForAudit({
    outer: { inner: [{ password: 'hunter2hunter2' }, { safe: 'keep me' }] }
  });

  const json = JSON.stringify(out);
  assert.equal(json.includes('hunter2hunter2'), false);
  assert.ok(json.includes('keep me'));
});

test('a known secret is caught by value, wherever a server echoes it back', () => {
  // The primary mechanism for anything the bundle supplied: it is a secret
  // because of where it came from, not because of the field it landed in.
  const out = redactForAudit(
    { note: 'the value was s3cret-token-value', nested: { anything: 's3cret-token-value' } },
    { knownSecrets: ['s3cret-token-value'] }
  );

  const json = JSON.stringify(out);
  assert.equal(json.includes('s3cret-token-value'), false);
  assert.ok(json.includes('"reason":"known-secret"'), 'attributed to provenance, not to a lucky regex');
});

test('provenance wins over the shape heuristic in the reason it reports', () => {
  const out = redactForAudit(
    { field: 'ey' + 'A'.repeat(20) + '.' + 'B'.repeat(20) + '.c' },
    { knownSecrets: ['ey' + 'A'.repeat(20) + '.' + 'B'.repeat(20) + '.c'] }
  ) as Record<string, unknown>;

  assert.equal((out.field as { reason: string }).reason, 'known-secret');
});

test('a too-short known secret is ignored rather than redacting everything', () => {
  // A one-character "secret" would otherwise redact every field containing it.
  const out = redactForAudit({ a: 'hello world', b: 'x' }, { knownSecrets: ['x', ''] });

  assert.deepEqual(out, { a: 'hello world', b: 'x' });
});

test('the shape heuristic catches JWTs and vendor-prefixed keys', () => {
  for (const value of [
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
    'sk-abcdefghijklmnopqrstuvwx',
    'ghp_abcdefghijklmnopqrstuvwxyz01'
  ]) {
    const out = redactForAudit({ note: value }) as Record<string, unknown>;
    assert.ok(isRedactedValue(out.note), value);
  }
});

test('the heuristic does not eat a commit SHA or ordinary prose', () => {
  // A redactor that cries wolf gets read as noise, and a SHA is exactly the
  // kind of value an audit is opened to find.
  const sha = 'd4d6ddef2c1df315ce6d7c89e6025038449b7f55';
  const out = redactForAudit({ sha, message: 'Fix the parser so it stops dropping trailing commas' });

  assert.deepEqual(out, { sha, message: 'Fix the parser so it stops dropping trailing commas' });
});

test('a pathological nesting depth terminates instead of overflowing', () => {
  // An audit must never be the thing that takes the app down.
  let deep: unknown = 'leaf';
  for (let index = 0; index < 200; index += 1) {
    deep = { next: deep };
  }

  assert.doesNotThrow(() => redactForAudit(deep));
});

/* ------------------------------------------------------------------ *
 * Size limits — after redaction, before storage
 * ------------------------------------------------------------------ */

test('a payload that fits is stored whole with no truncation metadata', () => {
  const capped = capForAudit({ query: 'bugs' });

  assert.deepEqual(capped.value, { query: 'bugs' });
  assert.equal(capped.truncation, null);
});

test('an oversized payload records original bytes, stored bytes and the field', () => {
  const capped = capForAudit({ small: 'ok', huge: 'x'.repeat(50_000) });

  assert.ok(capped.truncation);
  assert.ok(capped.truncation!.originalBytes > 50_000);
  assert.ok(capped.truncation!.storedBytes <= AUDIT_PAYLOAD_MAX_BYTES);
  assert.deepEqual(capped.truncation!.fields, ['huge'], 'names what lost content');
  assert.equal((capped.value as Record<string, string>).small, 'ok', 'the rest survives');
});

test('a long array is capped and named', () => {
  const capped = capForAudit({ rows: Array.from({ length: 5_000 }, (_, i) => `row-${i}-${'p'.repeat(40)}`) });

  assert.ok(capped.truncation);
  assert.deepEqual(capped.truncation!.fields, ['rows']);
});

test('an oversized payload is never stored raw as a fallback', () => {
  // The rule with no exception: too large to hold is stored truncated with
  // metadata, never stored whole "just this once".
  const capped = capForAudit(
    Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`f${i}`, i]))
  );

  assert.ok(capped.truncation);
  assert.ok(capped.truncation!.storedBytes <= AUDIT_PAYLOAD_MAX_BYTES);
  assert.deepEqual(capped.value, {
    __truncated: true,
    note: 'Payload exceeded the audit budget and was not stored.'
  });
});

test('an unmeasurable payload reports -1 rather than crashing', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  const capped = capForAudit(cyclic);
  assert.equal(capped.truncation?.originalBytes, -1);
});

/* ------------------------------------------------------------------ *
 * The ordering — the whole safety argument
 * ------------------------------------------------------------------ */

test('redaction runs before capping, so a secret cannot survive in a prefix', () => {
  // Capping first would truncate the token to a fragment the redactor can no
  // longer recognise, and that fragment would be stored forever.
  const secret = 'sk-' + 'a'.repeat(60);
  const record = buildAuditRecord({
    id: 'a1',
    requestId: 'r1',
    conversationId: 'c1',
    type: 'mcp_call',
    at: AT,
    server: { name: 'github/github', transport: 'stdio', endpoint: null },
    plugin: { name: 'github', version: '1.0.0' },
    tool: 'search_issues',
    outcome: 'ok',
    approvalId: null,
    toolCallId: 'call-1',
    detail: null,
    payload: { filler: 'y'.repeat(40_000), api_key: secret }
  });

  const json = JSON.stringify(record);
  assert.equal(json.includes(secret), false);
  assert.equal(json.includes('sk-aaaa'), false, 'not even a prefix of it');
  assert.ok(record.truncation, 'and it was still capped');
});

/* ------------------------------------------------------------------ *
 * The record shape
 * ------------------------------------------------------------------ */

test('every record carries the durable join key and its provenance', () => {
  const record = buildAuditRecord({
    id: 'a1',
    requestId: 'r1',
    conversationId: 'c1',
    type: 'mcp_call',
    at: AT,
    server: { name: 'github/github', transport: 'http', endpoint: 'https://api.example.com/mcp' },
    plugin: { name: 'github', version: '2.1.0' },
    tool: 'search_issues',
    outcome: 'ok',
    approvalId: 'ap-1',
    toolCallId: 'call-1',
    detail: null,
    payload: { q: 'bugs' }
  });

  // requestId is the join key precisely because it exists for the whole life of
  // a turn — the assistant message row does not.
  assert.equal(record.requestId, 'r1');
  assert.equal(record.at, AT);
  assert.equal(record.server?.endpoint, 'https://api.example.com/mcp');
  assert.equal(record.plugin?.version, '2.1.0');
  assert.equal(record.approvalId, 'ap-1', 'approval correlates to the call it gated');
  assert.equal(record.toolCallId, 'call-1');
});

test('a record with no payload carries no truncation metadata', () => {
  const record = buildAuditRecord({
    id: 'a1',
    requestId: 'r1',
    conversationId: 'c1',
    type: 'mcp_list_tools',
    at: AT,
    server: { name: 'github/github', transport: 'stdio', endpoint: null },
    plugin: { name: 'github', version: '1.0.0' },
    tool: null,
    outcome: 'ok',
    approvalId: null,
    toolCallId: null,
    detail: null
  });

  assert.equal(record.payload, undefined);
  assert.equal(record.truncation, null);
});
