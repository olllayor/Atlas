import type {
  AuthConfig,
  PluginCommandSummary,
  PluginHealthView,
  PluginLifecycleState,
  PluginServerHealth,
  PluginServerSummary,
  PluginSummary,
  PluginsView
} from '../../shared/contracts';
import type { McpServerHealth } from '../ai/mcp/McpClientManager';
import { pluginServerName } from '../../shared/plugins';
import { pluginIconPath } from './PluginLoader';
import type { LoadedCommand, LoadedMcpServer, LoadedPlugin } from './PluginLoader';
import { pluginIconUrl } from './pluginIconUrl';
import type { PluginOriginStore } from './PluginOrigins';
import type { PluginRegistry } from './PluginRegistry';

/**
 * What the settings page is shown.
 *
 * Every field here is derived from the validated manifest and the resolved
 * paths. Nothing is taken from `description` or `interface`, which the plugin
 * author controls and can write anything into — a bundle must not be able to
 * describe itself as harmless. `detail` in particular is the literal command
 * that will run, or the literal endpoint that will be reached.
 */
export function buildPluginsView(
  registry: PluginRegistry,
  origins?: PluginOriginStore
): PluginsView {
  const snapshot = registry.snapshot();
  const where = (name: string) => origins?.get(name)?.marketplace ?? null;

  return {
    root: registry.root,
    plugins: [
      ...snapshot.plugins.map((plugin) => toSummary(plugin, true, null, where(plugin.manifest.name))),
      ...snapshot.disabled.map((plugin) => toSummary(plugin, false, null, where(plugin.manifest.name))),
      // Shown alongside the rest rather than hidden: a plugin that has stopped
      // working needs to be findable, and the reason is on the row itself.
      ...snapshot.blocked.map((entry) =>
        toSummary(entry.plugin, false, entry.reason, where(entry.plugin.manifest.name))
      )
    ].sort((left, right) => left.name.localeCompare(right.name)),
    failures: snapshot.failures
  };
}

function toSummary(
  plugin: LoadedPlugin,
  enabled: boolean,
  blockedReason: string | null,
  marketplace: string | null
): PluginSummary {
  const credentials: AuthConfig[] = [];
  for (const server of plugin.mcpServers) {
    if (server.credentials) {
      credentials.push(...server.credentials);
    }
    if (server.bearerTokenEnvVar) {
      credentials.push({
        type: 'api_key',
        secretName: server.bearerTokenEnvVar,
        label: server.bearerTokenEnvVar.replace(/_/g, ' ').toLowerCase()
      });
    }
    if (server.envVars && server.envVars.length > 0) {
      for (const envVar of server.envVars) {
        credentials.push({
          type: envVar.toLowerCase().includes('url') ? 'database_url' : 'api_key',
          secretName: envVar,
          label: envVar.replace(/_/g, ' ')
        });
      }
    }
  }

  const uniqueCredentials = Array.from(
    new Map(credentials.map((c) => ['secretName' in c ? c.secretName : c.type, c])).values()
  );

  let state: PluginLifecycleState = 'installed';
  if (blockedReason) {
    state = 'disabled';
  } else if (!enabled) {
    state = 'disabled';
  } else {
    state = 'enabled';
  }

  return {
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    displayName: plugin.manifest.interface?.displayName ?? null,
    iconUrl: pluginIconUrl(pluginIconPath(plugin.root, plugin.manifest)),
    author: plugin.manifest.author?.name ?? null,
    homepage: plugin.manifest.homepage,
    root: plugin.root,
    enabled,
    state,
    credentials: uniqueCredentials,
    hasCredentials: uniqueCredentials.length === 0,
    skills: plugin.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      implicitInvocation: skill.implicitInvocation,
      compatibility: skill.compatibility,
      allowedTools: skill.allowedTools
    })),
    commands: plugin.commands.map(toCommandSummary),
    servers: plugin.mcpServers.map((server) => toServerSummary(plugin, server)),
    connectors: plugin.connectors.map((connector) => ({
      key: connector.key,
      id: connector.id,
      kind: connector.kind,
      capabilities: connector.capabilities,
      category: connector.category,
      required: connector.required
    })),
    hooksDeclared: plugin.manifest.paths.hooks != null || 'hooks' in plugin.manifest.unknown,
    atlas: plugin.manifest.atlas,
    blockedReason,
    marketplace,
    warnings: plugin.warnings
  };
}

/**
 * Every command the enabled plugins offer, for the composer's picker.
 *
 * Only enabled plugins: `snapshot().plugins` already excludes the disabled and
 * the revoked, so a withdrawn bundle's templates cannot be invoked either.
 */
export function buildCommandList(registry: PluginRegistry): PluginCommandSummary[] {
  return registry
    .snapshot()
    .plugins.flatMap((plugin) => plugin.commands.map(toCommandSummary))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function toCommandSummary(command: LoadedCommand): PluginCommandSummary {
  return {
    qualifiedName: command.qualifiedName,
    pluginName: command.pluginName,
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint
  };
}

/**
 * One plugin's health, from the manager's report.
 *
 * The manager answers for every configured server; this narrows to the ones
 * this plugin owns by its `plugin:<name>:<key>` id prefix and reshapes into
 * the view the detail panel renders. Pure, so the IPC layer stays a thin
 * adapter and the mapping stays testable without Electron.
 */
export function buildPluginHealth(
  plugin: LoadedPlugin | undefined,
  health: McpServerHealth[]
): PluginHealthView {
  if (!plugin) {
    return { ok: false, servers: [], error: 'Plugin not found.' };
  }

  // A plugin without servers has nothing to connect to, which is health
  // rather than failure: its skills work with no subprocess at all.
  if (plugin.mcpServers.length === 0) {
    return { ok: true, servers: [], error: null };
  }

  const prefix = `plugin:${plugin.manifest.name}:`;
  const servers: PluginServerHealth[] = health
    .filter((server) => server.serverId.startsWith(prefix))
    .map((server) => ({
      key: server.serverId.slice(prefix.length),
      name: server.name,
      status: server.status,
      toolCount: server.toolCount,
      error: server.error
    }));

  return {
    ok: servers.length > 0 && servers.every((server) => server.status === 'ready'),
    servers,
    error: null
  };
}

function toServerSummary(plugin: LoadedPlugin, server: LoadedMcpServer): PluginServerSummary {
  return {
    key: server.key,
    name: pluginServerName(plugin.manifest.name, server.key),
    transport: server.transport,
    // The exact thing that runs, or the exact host that is reached. A user
    // deciding whether to trust a bundle is entitled to the literal string.
    detail:
      server.transport === 'http' || server.transport === 'sse'
        ? (server.url ?? '')
        : [server.command, ...server.args].filter(Boolean).join(' '),
    envVars: server.envVars,
    envKeys: Object.keys(server.env),
    // Names only. A value is the plugin author's string and could be anything;
    // the install confirmation exists to say what will be *sent*, and the
    // header names are that without quoting a payload back at the user.
    headerNames: Object.keys(server.headers),
    bearerTokenEnvVar: server.bearerTokenEnvVar
  };
}
