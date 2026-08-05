import assert from 'node:assert/strict';
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
