import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadPlugin } from '../src/main/plugins/PluginLoader.js';
import type { LoadedPlugin } from '../src/main/plugins/PluginLoader.js';
import { PluginInstaller } from '../src/main/plugins/PluginInstaller.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { resolveMcpToolProvenance } from '../src/main/ai/mcp/mcpToolProvenance.js';
import { namespaceMcpTool } from '../src/shared/mcp.js';
import { pluginServerName } from '../src/shared/plugins.js';

/**
 * Attributing a wire tool name back to the real plugin behind it.
 *
 * An approval only ever sees the wire name — the model never learns a server's
 * configured `plugin/key` form — so this is the one place that has to work
 * backwards from it correctly. Built against real `loadPlugin()` output rather
 * than a hand-built `LoadedPlugin`, so a change to the manifest or server shape
 * fails this test too, not just the production code it exercises.
 */

function workspace(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-provenance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root: string, relative: string, contents: string) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

/** A plugin with one MCP server, key equal to the plugin's own name. */
function pluginWithServer(root: string, name: string, serverKey: string): LoadedPlugin {
  write(root, '.codex-plugin/plugin.json', JSON.stringify({ name, version: '1.0.0', description: 'd' }));
  write(
    root,
    '.mcp.json',
    JSON.stringify({ mcpServers: { [serverKey]: { command: 'node', args: ['./server.js'] } } })
  );
  write(root, 'server.js', '// fixture, never run');

  const result = loadPlugin(root);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) throw new Error('unreachable');
  return result.plugin;
}

test('the common case: server key equals the plugin name', (t) => {
  const plugin = pluginWithServer(workspace(t), 'github', 'github');
  const wireName = namespaceMcpTool(pluginServerName('github', 'github'), 'search_issues');

  assert.deepEqual(resolveMcpToolProvenance(wireName, [plugin]), {
    pluginName: 'github',
    serverKey: 'github'
  });
});

test('a plugin and server key that differ resolve exactly, not by guessing', (t) => {
  // `describeMcpToolName`'s *display* label would show this whole segment as
  // "acme_kanban" — a lossy guess. Provenance has the installed list to check
  // against and must not settle for that.
  const plugin = pluginWithServer(workspace(t), 'acme', 'kanban');
  const wireName = namespaceMcpTool(pluginServerName('acme', 'kanban'), 'list_cards');

  assert.deepEqual(resolveMcpToolProvenance(wireName, [plugin]), {
    pluginName: 'acme',
    serverKey: 'kanban'
  });
});

test('the right plugin is picked out of several installed', (t) => {
  const a = pluginWithServer(join(workspace(t), 'a'), 'alpha', 'alpha');
  const dir = mkdtempSync(join(tmpdir(), 'atlas-provenance-b-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const b = pluginWithServer(dir, 'beta', 'beta');

  const wireName = namespaceMcpTool(pluginServerName('beta', 'beta'), 'do_thing');

  assert.deepEqual(resolveMcpToolProvenance(wireName, [a, b]), {
    pluginName: 'beta',
    serverKey: 'beta'
  });
});

test('a plugin no longer installed resolves to null, not a guess', () => {
  // Wrong attribution in an audit record is worse than an absent one, because
  // it would be believed.
  const wireName = namespaceMcpTool(pluginServerName('gone', 'gone'), 'anything');

  assert.equal(resolveMcpToolProvenance(wireName, []), null);
});

test('a built-in tool name is not an MCP name at all', (t) => {
  const plugin = pluginWithServer(workspace(t), 'github', 'github');

  assert.equal(resolveMcpToolProvenance('read_file', [plugin]), null);
  assert.equal(resolveMcpToolProvenance('', [plugin]), null);
});

/* ------------------------------------------------------------------ *
 * The exact scenario an approval record needs right: updates, renames,
 * removals. Driven through a real `PluginInstaller`/`PluginRegistry`, because
 * this is about what a *fresh snapshot* says after the installed set changes
 * under it — a hand-built `LoadedPlugin[]` array can't exercise that.
 * ------------------------------------------------------------------ */

function bundleSource(dir: string, name: string, version: string, serverKey: string) {
  const root = join(dir, `${name}-${version}`);
  write(root, '.codex-plugin/plugin.json', JSON.stringify({ name, version, description: 'd' }));
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { [serverKey]: { command: 'node', args: ['./s.js'] } } }));
  write(root, 's.js', '// fixture');
  return root;
}

test('an approval for a call made before an update resolves to the version now installed', (t) => {
  // The version on the record is read from a fresh snapshot at *approval*
  // time, not captured once and cached — this proves that reading again after
  // the installed set changes actually observes the change.
  const dir = workspace(t);
  const pluginsRoot = join(dir, 'plugins');
  const registry = new PluginRegistry({ root: pluginsRoot });
  const installer = new PluginInstaller(registry);

  installer.install(bundleSource(dir, 'acme', '1.0.0', 'acme'));
  registry.invalidate();

  const wireName = namespaceMcpTool(pluginServerName('acme', 'acme'), 'do_thing');
  const beforeUpdate = resolveMcpToolProvenance(wireName, registry.snapshot().plugins);
  const versionBefore = registry.snapshot().plugins.find((p) => p.manifest.name === 'acme')?.manifest.version;

  assert.deepEqual(beforeUpdate, { pluginName: 'acme', serverKey: 'acme' });
  assert.equal(versionBefore, '1.0.0');

  installer.install(bundleSource(dir, 'acme', '2.0.0', 'acme'), { replaceExisting: true, expectName: 'acme' });
  registry.invalidate();

  const afterUpdate = resolveMcpToolProvenance(wireName, registry.snapshot().plugins);
  const versionAfter = registry.snapshot().plugins.find((p) => p.manifest.name === 'acme')?.manifest.version;

  assert.deepEqual(afterUpdate, { pluginName: 'acme', serverKey: 'acme' }, 'the server key is unchanged by the update');
  assert.equal(versionAfter, '2.0.0', 'a fresh snapshot sees the new version, not the one at call time');
});

test('a renamed plugin: the old wire name resolves to nothing, never to the new name', (t) => {
  // A rename is really "the old plugin is gone and a different one exists" as
  // far as an installed-name lookup is concerned — Atlas has no rename
  // tracking (see docs/plugin-system.md §9.6), and provenance must not paper
  // over that by guessing the old call meant the new plugin.
  const dir = workspace(t);
  const pluginsRoot = join(dir, 'plugins');
  const registry = new PluginRegistry({ root: pluginsRoot });
  const installer = new PluginInstaller(registry);

  installer.install(bundleSource(dir, 'old-name', '1.0.0', 'old-name'));
  registry.invalidate();

  const oldWireName = namespaceMcpTool(pluginServerName('old-name', 'old-name'), 'do_thing');
  assert.deepEqual(resolveMcpToolProvenance(oldWireName, registry.snapshot().plugins), {
    pluginName: 'old-name',
    serverKey: 'old-name'
  });

  // The publisher renames the bundle. From Atlas's side this is: the old name
  // is uninstalled, a plugin with a new name is installed separately.
  installer.uninstall('old-name');
  installer.install(bundleSource(dir, 'new-name', '1.0.0', 'new-name'));
  registry.invalidate();

  assert.equal(resolveMcpToolProvenance(oldWireName, registry.snapshot().plugins), null);
});

test('a removed plugin: an approval already in flight resolves to nothing, not the wrong plugin', (t) => {
  const dir = workspace(t);
  const pluginsRoot = join(dir, 'plugins');
  const registry = new PluginRegistry({ root: pluginsRoot });
  const installer = new PluginInstaller(registry);

  installer.install(bundleSource(dir, 'temp', '1.0.0', 'temp'));
  registry.invalidate();

  const wireName = namespaceMcpTool(pluginServerName('temp', 'temp'), 'do_thing');
  assert.ok(resolveMcpToolProvenance(wireName, registry.snapshot().plugins));

  installer.uninstall('temp');
  registry.invalidate();

  assert.equal(resolveMcpToolProvenance(wireName, registry.snapshot().plugins), null);
});
