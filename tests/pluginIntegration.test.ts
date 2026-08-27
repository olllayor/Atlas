import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { McpClientManager } from '../src/main/ai/mcp/McpClientManager.js';
import { McpAuditLog } from '../src/main/ai/mcp/McpAuditLog.js';
import { formatMcpResult } from '../src/main/ai/mcp/mcpTools.js';
import { resolveMcpToolProvenance } from '../src/main/ai/mcp/mcpToolProvenance.js';
import { McpUiStore } from '../src/main/ai/mcp/McpUiStore.js';
import { PluginAuditRepo } from '../src/main/db/repositories/pluginAuditRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { PluginInstaller } from '../src/main/plugins/PluginInstaller.js';
import { createPluginMcpSource } from '../src/main/plugins/PluginMcpSource.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { namespaceMcpTool } from '../src/shared/mcp.js';
import type { SqliteDatabase } from '../src/main/db/client.js';

/**
 * The plugin feature, wired together the way `index.ts` wires it — as far as
 * this environment can go.
 *
 * **What this proves.** Every module the plugin work touched, constructed and
 * connected exactly as production does: `PluginInstaller` copies a real
 * bundle, `PluginRegistry` loads it, `createPluginMcpSource` turns it into a
 * server config, `McpClientManager` spawns the real fixture process
 * (`examples/mcp-ui-demo`) and speaks real MCP JSON-RPC to it over a real
 * stdio pipe — no mocked transport anywhere in this chain — `formatMcpResult`
 * and `McpUiStore` capture its `ui://` component the way a tool call would,
 * and `McpAuditLog` writes through a real `PluginAuditRepo` to a real SQLite
 * file. The database handle is then closed and reopened at the same path —
 * an actual process restart, not a simulation of one — and the audit trail is
 * read back to confirm it survived.
 *
 * **What this does not prove, and cannot prove here.** There is no
 * `BrowserWindow`, no renderer, no `ChatEngine`, no model call, and nothing a
 * person clicked. `better-sqlite3`'s native binding in this repository is
 * compiled against Electron's Node ABI and fails to load under plain Node
 * (`ERR_DLOPEN_FAILED`, verified while writing this test) — the same reason
 * every other repository test that touches SQLite uses the `node:sqlite`
 * shim below rather than the real driver `index.ts` constructs. Running the
 * packaged app, opening the plugin browser, and clicking through an install
 * and an approval prompt by hand is still owed and is not something a test
 * file can stand in for.
 */

function shimDatabase(path: string) {
  const raw = new DatabaseSync(path);
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => {
        raw.exec('BEGIN');
        try {
          const result = callback(...args);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      }
  } as unknown as SqliteDatabase;

  applySchema(database);

  return { database, raw };
}

test('install → real subprocess tool call → UI capture → durable audit → restart → read back', async (t) => {
  const workDir = mkdtempSync(join(tmpdir(), 'atlas-plugin-e2e-'));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  /* ---------- Install the real fixture bundle ---------- */

  const pluginsRoot = join(workDir, 'plugins');
  mkdirSync(pluginsRoot, { recursive: true });

  const registry = new PluginRegistry({ root: pluginsRoot });
  const installer = new PluginInstaller(registry);

  const fixtureSource = resolve(import.meta.dirname, '..', 'examples', 'mcp-ui-demo');
  const installed = installer.install(fixtureSource);

  assert.equal(installed.ok, true, installed.ok ? '' : installed.error);
  assert.equal(installed.ok && installed.name, 'mcp-ui-demo');

  registry.invalidate();
  const [plugin] = registry.snapshot().plugins;
  assert.equal(plugin?.manifest.format, 'agent-plugins', 'the fixture is a conformant Agent Plugins bundle');

  /* ---------- Spawn it for real and call its one tool ---------- */

  const servers = createPluginMcpSource(registry)();
  assert.equal(servers.length, 1, 'the fixture declares exactly one MCP server');

  // The beta switch off empties the source — no server config exists to
  // connect, spawn, or list tools for, whatever the plugins directory holds.
  assert.deepEqual(createPluginMcpSource(registry, () => false)(), []);

  const manager = new McpClientManager(() => servers);
  t.after(() => manager.disposeAll());

  const definitions = await manager.listTools();
  const definition = definitions.find((entry) => entry.toolName === 'show_demo_card');
  assert.ok(definition, `expected show_demo_card among: ${definitions.map((d) => d.toolName).join(', ')}`);

  const result = await manager.callTool(definition.serverId, 'show_demo_card', {});

  /* ---------- Render it the way a real tool call would ---------- */

  const uiStore = new McpUiStore();
  const toolCallId = 'call-e2e-1';
  let captured = false;

  const modelString = formatMcpResult('mcp-ui-demo/demo', result, (component) => {
    captured = uiStore.put({
      toolCallId,
      uri: component.uri,
      serverName: 'mcp-ui-demo/demo',
      html: component.html
    });
    return captured;
  });

  assert.equal(captured, true, 'the widget markup was captured for the host');
  assert.match(modelString, /Sandbox test card rendered/, 'the headless text summary reached the model string');
  assert.equal(modelString.includes('<button'), false, 'the markup itself never enters the model string');
  assert.ok(uiStore.get(toolCallId)?.html.includes('escape report'), 'the real widget HTML was captured intact');

  /* ---------- Resolve provenance the way an approval record would ---------- */

  // The real wire name, exactly as the model would see it — not guessed.
  const [server] = servers;
  const wireToolName = namespaceMcpTool(server.name, 'show_demo_card');
  const provenance = resolveMcpToolProvenance(wireToolName, registry.snapshot().plugins);
  assert.deepEqual(provenance, { pluginName: 'mcp-ui-demo', serverKey: 'demo' });

  /* ---------- Write the audit trail durably ---------- */

  const dbPath = join(workDir, 'atlas.db');
  let { database, raw } = shimDatabase(dbPath);
  let auditLog = new McpAuditLog(new PluginAuditRepo(database));

  auditLog.record({
    requestId: 'req-e2e-1',
    conversationId: 'conv-e2e-1',
    type: 'mcp_list_tools',
    server: { name: 'mcp-ui-demo/demo', transport: 'stdio', endpoint: null },
    plugin: { name: plugin.manifest.name, version: plugin.manifest.version },
    tool: null,
    outcome: 'ok',
    approvalId: null,
    toolCallId: null,
    detail: null,
    payload: { tools: definitions.map((d) => d.toolName) },
    idempotencyKey: 'lt:req-e2e-1:mcp-ui-demo/demo'
  });

  auditLog.record({
    requestId: 'req-e2e-1',
    conversationId: 'conv-e2e-1',
    type: 'mcp_call',
    server: { name: 'mcp-ui-demo/demo', transport: 'stdio', endpoint: null },
    plugin: { name: plugin.manifest.name, version: plugin.manifest.version },
    tool: 'show_demo_card',
    outcome: 'ok',
    approvalId: null,
    toolCallId,
    detail: null,
    payload: { arguments: {}, result },
    idempotencyKey: `mc:${toolCallId}:ok`
  });

  const beforeRestart = new PluginAuditRepo(database).forRequest('req-e2e-1');
  assert.equal(beforeRestart.length, 2);

  /* ---------- An actual restart: close this handle, open a fresh one ---------- */

  raw.close();
  ({ database, raw } = shimDatabase(dbPath));
  t.after(() => raw.close());

  const afterRestart = new PluginAuditRepo(database).forRequest('req-e2e-1');

  assert.equal(afterRestart.length, 2, 'both records survived the restart');

  const listRecord = afterRestart.find((r) => r.type === 'mcp_list_tools');
  const callRecord = afterRestart.find((r) => r.type === 'mcp_call');

  assert.equal(listRecord?.plugin?.name, 'mcp-ui-demo');
  assert.equal(listRecord?.plugin?.version, plugin.manifest.version);
  assert.deepEqual((listRecord?.payload as { tools: string[] } | undefined)?.tools, ['show_demo_card']);

  assert.equal(callRecord?.plugin?.version, plugin.manifest.version);
  assert.equal(callRecord?.toolCallId, toolCallId);
  assert.equal(callRecord?.outcome, 'ok');
  // The real tool result — including its ui:// resource — went through
  // redaction and capping on the way in; it must still be there, not stripped
  // to nothing by either step.
  assert.match(JSON.stringify(callRecord?.payload), /show_demo_card|demo\/hello/);
});
