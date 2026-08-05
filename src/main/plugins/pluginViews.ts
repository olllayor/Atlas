import type { PluginServerSummary, PluginSummary, PluginsView } from '../../shared/contracts';
import { pluginServerName } from '../../shared/plugins';
import { pluginIconPath } from './PluginLoader';
import type { LoadedMcpServer, LoadedPlugin } from './PluginLoader';
import { pluginIconUrl } from './pluginIconUrl';
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
export function buildPluginsView(registry: PluginRegistry): PluginsView {
  const snapshot = registry.snapshot();

  return {
    root: registry.root,
    plugins: [
      ...snapshot.plugins.map((plugin) => toSummary(plugin, true)),
      ...snapshot.disabled.map((plugin) => toSummary(plugin, false))
    ].sort((left, right) => left.name.localeCompare(right.name)),
    failures: snapshot.failures
  };
}

function toSummary(plugin: LoadedPlugin, enabled: boolean): PluginSummary {
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
      implicitInvocation: skill.implicitInvocation
    })),
    servers: plugin.mcpServers.map((server) => toServerSummary(plugin, server)),
    // Parsed and counted so the page can say a bundle carries them. Atlas does
    // not run hooks: they are arbitrary commands fired on session lifecycle
    // events with no model and no approval in the loop, which is the largest
    // privilege in the format and the one with the least visibility.
    hooksDeclared: plugin.manifest.paths.hooks != null || 'hooks' in plugin.manifest.unknown,
    warnings: plugin.warnings
  };
}

function toServerSummary(plugin: LoadedPlugin, server: LoadedMcpServer): PluginServerSummary {
  return {
    name: pluginServerName(plugin.manifest.name, server.key),
    transport: server.transport,
    // The exact thing that runs, or the exact host that is reached. A user
    // deciding whether to trust a bundle is entitled to the literal string.
    detail:
      server.transport === 'http'
        ? (server.url ?? '')
        : [server.command, ...server.args].filter(Boolean).join(' '),
    envVars: server.envVars,
    envKeys: Object.keys(server.env),
    bearerTokenEnvVar: server.bearerTokenEnvVar
  };
}
