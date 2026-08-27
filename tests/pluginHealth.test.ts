import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPluginHealth } from '../src/main/plugins/pluginViews.js';
import type { McpServerHealth } from '../src/main/ai/mcp/McpClientManager.js';
import type { LoadedPlugin } from '../src/main/plugins/PluginLoader.js';

/**
 * The mapping between what the MCP manager reports and what the detail panel
 * renders — narrowed by plugin, reshaped, and judged.
 */

function pluginWithServers(name: string, serverKeys: string[]): LoadedPlugin {
  return {
    root: `/tmp/${name}`,
    manifest: { name, version: '1.0.0', description: 'd', format: 'codex' } as LoadedPlugin['manifest'],
    skills: [],
    commands: [],
    mcpServers: serverKeys.map((key) => ({ key }) as LoadedPlugin['mcpServers'][number]),
    connectors: [],
    warnings: []
  };
}

function serverHealth(id: string, overrides: Partial<McpServerHealth> = {}): McpServerHealth {
  return { serverId: id, name: id, status: 'ready', toolCount: 3, error: null, ...overrides };
}

test('health is narrowed to the asked plugin and judged per server', () => {
  const plugin = pluginWithServers('github', ['github', 'extra']);
  const health = [
    serverHealth('plugin:github:github', { toolCount: 14 }),
    serverHealth('plugin:other:main', { toolCount: 9 }),
    serverHealth('plugin:github:extra', { status: 'failed', toolCount: 0, error: 'connection refused' })
  ];

  const view = buildPluginHealth(plugin, health);

  assert.deepEqual(
    view.servers.map((server) => server.key),
    ['github', 'extra'],
    'another plugin’s servers are not this plugin’s health'
  );
  assert.equal(view.ok, false, 'one failed server fails the plugin');
  assert.equal(view.servers[1]?.error, 'connection refused');
});

test('a plugin with no servers is healthy — skills need no subprocess', () => {
  const view = buildPluginHealth(pluginWithServers('skills-only', []), [
    serverHealth('plugin:someone-else:x')
  ]);

  assert.equal(view.ok, true);
  assert.deepEqual(view.servers, []);
});

test('an unknown plugin is not found, never guessed', () => {
  const view = buildPluginHealth(undefined, [serverHealth('plugin:github:github')]);

  assert.equal(view.ok, false);
  assert.match(view.error ?? '', /not found/);
});
