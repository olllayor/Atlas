import type { McpServerConfig } from '../../shared/mcp';
import { MCP_DEFAULT_STARTUP_TIMEOUT_MS, MCP_DEFAULT_TOOL_TIMEOUT_MS } from '../../shared/mcp';
import { PLUGIN_SERVER_APPROVAL_MODE, pluginServerName } from '../../shared/plugins';
import type { LoadedMcpServer, LoadedPlugin } from './PluginLoader';
import { pluginDataDir } from './PluginLoader';
import type { PluginRegistry } from './PluginRegistry';

/**
 * Installed plugins, as the server list `McpClientManager` consumes.
 *
 * This is the only way an MCP server enters Atlas. There is no hand-add path
 * any more, so everything the manager already does — connection dedupe, catalog
 * TTL, `onclose` eviction, prewarm, per-server failure isolation, the approval
 * ladder — applies to plugin servers without any of it knowing that plugins
 * exist.
 */
export function createPluginMcpSource(
  registry: PluginRegistry,
  /**
   * The beta switch, read live on every server-list build.
   *
   * Off means the list is empty — no plugin server exists to connect, spawn or
   * list tools for, whatever the plugins directory contains.
   */
  isEnabled: () => boolean = () => true
): () => McpServerConfig[] {
  const source = () => registry.snapshot().plugins.flatMap(toServerConfigs);

  return () => (isEnabled() ? source() : []);
}

function toServerConfigs(plugin: LoadedPlugin): McpServerConfig[] {
  return plugin.mcpServers.map((server) => toServerConfig(plugin, server));
}

function toServerConfig(plugin: LoadedPlugin, server: LoadedMcpServer): McpServerConfig {
  return {
    // Stable across rescans, and that matters: the manager keys live
    // connections by id, so an id derived from scan order would drop every
    // connection every five seconds.
    id: `plugin:${plugin.manifest.name}:${server.key}`,
    name: pluginServerName(plugin.manifest.name, server.key),
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    envVars: server.envVars,
    cwd: server.cwd,
    url: server.url,
    headers: server.headers,
    // The two variables the Agent Plugins spec requires every plugin subprocess
    // to receive. Carried on the config rather than looked up at spawn time so
    // that the manager stays ignorant of plugins, which is the property that
    // lets everything downstream apply unchanged.
    pluginRoot: plugin.root,
    pluginDataDir: pluginDataDir(plugin.manifest.name),
    // A bundle ships servers as part of itself; disabling one individually is
    // an install-level decision that does not exist yet.
    enabled: true,
    startupTimeoutMs: MCP_DEFAULT_STARTUP_TIMEOUT_MS,
    toolTimeoutMs: MCP_DEFAULT_TOOL_TIMEOUT_MS,
    approvalMode: PLUGIN_SERVER_APPROVAL_MODE,
    bearerTokenEnvVar: server.bearerTokenEnvVar,
    // Derived from files, not rows: a plugin server has no independent
    // lifecycle, so it has no timestamps of its own.
    createdAt: '',
    updatedAt: ''
  };
}
