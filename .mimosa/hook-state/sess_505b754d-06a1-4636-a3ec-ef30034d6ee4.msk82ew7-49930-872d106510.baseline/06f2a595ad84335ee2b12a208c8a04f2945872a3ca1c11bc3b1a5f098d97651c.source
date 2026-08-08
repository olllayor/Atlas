import type {
  PluginCommandSummary,
  PluginServerSummary,
  PluginSummary,
  PluginsView
} from '../../shared/contracts';
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
  return {
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    // Display metadata is presentation only and never decides anything.
    displayName: plugin.manifest.interface?.displayName ?? null,
    iconUrl: pluginIconUrl(pluginIconPath(plugin.root, plugin.manifest)),
    author: plugin.manifest.author?.name ?? null,
    homepage: plugin.manifest.homepage,
    root: plugin.root,
    enabled,
    skills: plugin.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      implicitInvocation: skill.implicitInvocation,
      compatibility: skill.compatibility,
      allowedTools: skill.allowedTools
    })),
    commands: plugin.commands.map(toCommandSummary),
    servers: plugin.mcpServers.map((server) => toServerSummary(plugin, server)),
    // Listed so the row is honest about what the bundle declares. Every one
    // renders unavailable — Atlas has no connector broker — but "offers
    // something Atlas cannot yet perform" is a different statement from
    // "offers nothing", and the user is entitled to the first one.
    connectors: plugin.connectors.map((connector) => ({
      key: connector.key,
      id: connector.id,
      kind: connector.kind,
      capabilities: connector.capabilities,
      category: connector.category,
      required: connector.required
    })),
    // Parsed and counted so the page can say a bundle carries them. Atlas does
    // not run hooks: they are arbitrary commands fired on session lifecycle
    // events with no model and no approval in the loop, which is the largest
    // privilege in the format and the one with the least visibility.
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

function toServerSummary(plugin: LoadedPlugin, server: LoadedMcpServer): PluginServerSummary {
  return {
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
