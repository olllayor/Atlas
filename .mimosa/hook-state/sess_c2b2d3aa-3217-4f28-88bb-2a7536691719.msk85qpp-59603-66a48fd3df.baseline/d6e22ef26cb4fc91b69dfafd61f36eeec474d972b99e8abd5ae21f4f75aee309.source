import { sanitizeToolNamePart, splitMcpToolName } from '../../../shared/mcp';
import { pluginServerName } from '../../../shared/plugins';
import type { LoadedPlugin } from '../../plugins/PluginLoader';

/**
 * Which installed plugin and server a wire tool name came from, exactly.
 *
 * `describeMcpToolName` (in `shared/mcp.ts`) answers the *display* question —
 * a readable label, collapsing `github_github` to `github` — and is
 * deliberately lossy about it. An approval record needs the opposite: it only
 * has the wire name (the model never learns the configured `plugin/server`
 * form), and it has to attribute that name to a real installed bundle rather
 * than a guessed label. This does that by exact comparison — reconstructing
 * the sanitised segment for every installed server and matching it byte for
 * byte — rather than by re-deriving a plugin name from string shape.
 *
 * Returns `null` when no installed server produces that exact segment: a
 * plugin that was uninstalled after the call was made, or a name long enough
 * to have been truncated around a hash at the point the segment itself was
 * cut. `null` is the honest answer in both cases — a guessed plugin in an
 * audit record is worse than an absent one, because it would be believed.
 */
export function resolveMcpToolProvenance(
  toolName: string,
  plugins: readonly LoadedPlugin[]
): { pluginName: string; serverKey: string } | null {
  const split = splitMcpToolName(toolName);

  if (!split) {
    return null;
  }

  for (const plugin of plugins) {
    for (const server of plugin.mcpServers) {
      if (sanitizeToolNamePart(pluginServerName(plugin.manifest.name, server.key)) === split.serverSegment) {
        return { pluginName: plugin.manifest.name, serverKey: server.key };
      }
    }
  }

  return null;
}
