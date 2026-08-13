import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { McpClientManager } from '../src/main/ai/mcp/McpClientManager.js';
import type { McpServerConfig } from '../src/shared/mcp.js';

/**
 * These run a real spawn against a binary that does not exist, so they need no
 * network and finish as fast as the OS can refuse an exec.
 */
function serverThatCannotStart(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'srv-bad',
    name: 'broken',
    transport: 'stdio',
    command: 'atlas-definitely-not-a-real-binary',
    args: [],
    env: {},
    envVars: [],
    cwd: null,
    url: null,
    bearerTokenEnvVar: null,
    enabled: true,
    startupTimeoutMs: 5_000,
    toolTimeoutMs: 5_000,
    approvalMode: 'auto',
    createdAt: '',
    updatedAt: '',
    ...overrides
  };
}

test('a server that cannot start is reported as failed, not as ready with no tools', async () => {
  const manager = new McpClientManager(() => [serverThatCannotStart()]);

  const health = await manager.health();
  const entry = health.find((item) => item.serverId === 'srv-bad');

  assert.equal(entry?.status, 'failed');
  assert.equal(entry?.toolCount, 0);
  assert.ok(entry?.error, 'a failed server must say why');

  await manager.disposeAll();
});

test('a disabled server is reported as disabled without being launched', async () => {
  const manager = new McpClientManager(() => [serverThatCannotStart({ enabled: false })]);

  const entry = (await manager.health()).find((item) => item.serverId === 'srv-bad');

  assert.equal(entry?.status, 'disabled');
  assert.equal(entry?.error, null);

  await manager.disposeAll();
});

test('a server that cannot start contributes no tools and does not throw', async () => {
  const manager = new McpClientManager(() => [serverThatCannotStart()]);

  assert.deepEqual(await manager.listTools(), []);

  await manager.disposeAll();
});

test('calling a tool on a server that cannot start explains why', async () => {
  const manager = new McpClientManager(() => [serverThatCannotStart()]);

  await assert.rejects(() => manager.callTool('srv-bad', 'anything', {}), /unavailable/);

  await manager.disposeAll();
});

test('a command containing shell syntax is refused before anything is spawned', async () => {
  const manager = new McpClientManager(() => [
    serverThatCannotStart({ command: 'npx; rm -rf /' })
  ]);

  const entry = (await manager.health()).find((item) => item.serverId === 'srv-bad');

  assert.equal(entry?.status, 'failed');
  assert.match(entry?.error ?? '', /shell/);

  await manager.disposeAll();
});

test('prewarming with no servers configured spawns nothing and resolves', async () => {
  const manager = new McpClientManager(() => []);

  await manager.prewarm();

  await manager.disposeAll();
});

test('prewarming a server that cannot start does not reject', async () => {
  const manager = new McpClientManager(() => [serverThatCannotStart()]);

  await manager.prewarm();

  // The failure is recorded rather than thrown, so health still explains it.
  const entry = (await manager.health()).find((item) => item.serverId === 'srv-bad');
  assert.equal(entry?.status, 'failed');

  await manager.disposeAll();
});

test('a disabled server is not connected by a prewarm', async () => {
  let spawnAttempts = 0;
  const manager = new McpClientManager(() => {
    spawnAttempts += 1;
    return [serverThatCannotStart({ enabled: false })];
  });

  await manager.prewarm();

  // One read for the enabled filter, and no `listTools` behind it: a disabled
  // server must not cost a process launch.
  assert.equal(spawnAttempts, 1);

  await manager.disposeAll();
});

/* ------------------------------------------------------------------ *
 * Tool-call timeout, enforced against a real subprocess.
 *
 * `toolTimeoutMs` is passed straight through to the MCP SDK client, which
 * enforces it with its own `setTimeout` inside `Protocol._setupTimeout` —
 * Atlas's own code does no clock-watching here. The fixture below answers
 * `initialize` and `tools/list` normally, exactly like a real server, and
 * then never replies to `tools/call` at all, so this proves the ceiling is
 * real rather than trusting that passing the option means it is honoured.
 * ------------------------------------------------------------------ */

/** A minimal MCP server that hangs forever on `tools/call`. Generated per test. */
const HANGING_SERVER_SCRIPT = `
const TOOL = { name: 'never_returns', description: 'Hangs forever.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
function respond(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
function handle(message) {
  switch (message.method) {
    case 'initialize':
      return respond(message.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hangs', version: '1.0.0' } });
    case 'tools/list':
      return respond(message.id, { tools: [TOOL] });
    case 'tools/call':
      return; // deliberately never responds
    default:
      if (message.id != null) respond(message.id, {});
  }
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) { try { handle(JSON.parse(line)); } catch {} }
    newline = buffer.indexOf('\\n');
  }
});
`;

test('a tool call that never responds is rejected at the configured timeout, not left hanging', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-mcp-timeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const script = join(dir, 'hangs.mjs');
  writeFileSync(script, HANGING_SERVER_SCRIPT);

  const server = serverThatCannotStart({
    id: 'srv-hang',
    name: 'hangs',
    command: 'node',
    args: [script],
    // The ceiling under test. Small on purpose so the test itself stays fast
    // rather than proving the mechanism by waiting out a realistic timeout.
    toolTimeoutMs: 200
  });

  const manager = new McpClientManager(() => [server]);
  t.after(() => manager.disposeAll());

  const definitions = await manager.listTools();
  assert.equal(definitions.length, 1, 'the server answered tools/list normally');

  const startedAt = Date.now();

  await assert.rejects(manager.callTool('srv-hang', 'never_returns', {}), /timeout|timed out/i);

  const elapsedMs = Date.now() - startedAt;
  // Bounded well above the 200ms ceiling to absorb CI scheduling jitter, and
  // well below "actually hung" — the difference between "timed out promptly"
  // and "the call is silently still running".
  assert.ok(elapsedMs < 3_000, `expected the timeout to fire quickly, took ${elapsedMs}ms`);
});
