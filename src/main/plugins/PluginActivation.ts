import type { LoadedPlugin } from './PluginLoader';
import type { PluginRegistry } from './PluginRegistry';

/**
 * Which plugin servers a conversation may use.
 *
 * Installing twenty plugins should not cost twenty plugins' worth of tool
 * schemas on every message. Codex and Claude both put every installed server's
 * tools in every request; here a bundle's servers stay unconnected and unlisted
 * until the conversation gives a reason to want them.
 *
 * The reason is almost always a skill. Every one of the nine server-carrying
 * bundles surveyed also ships skills, so the skill index is a route to every
 * real server — which is what makes gating safe rather than a way to strand
 * tools nobody can reach.
 */

/**
 * A bundle whose servers are gated, and one whose servers are always on.
 *
 * A plugin with servers but no skills has no route: nothing would ever mention
 * it, so gating it would hide it forever. Those stay eager. The rule is
 * deliberately about reachability, not about trust.
 */
export function isGated(plugin: LoadedPlugin): boolean {
  return plugin.mcpServers.length > 0 && plugin.skills.length > 0;
}

export type ActivationRecord = {
  /** Plugin names whose servers this conversation has activated. */
  plugins: string[];
};

export class PluginActivationStore {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly read: () => Record<string, ActivationRecord>,
    private readonly write: (value: Record<string, ActivationRecord>) => void,
    /**
     * Plugins the user wants available everywhere.
     *
     * The escape hatch from gating: someone who always wants their GitHub tools
     * should not have to open a skill first in every new conversation. A plugin
     * listed here behaves as though it were never gated.
     */
    private readonly alwaysOn: () => Set<string> = () => new Set(),
    /** Conversations kept before the oldest are pruned. */
    private readonly maxConversations = 200
  ) {}

  /** Gated plugins and whether this conversation has woken each one. */
  status(conversationId: string): Array<{ name: string; active: boolean; alwaysOn: boolean }> {
    const active = this.activated(conversationId);
    const always = this.alwaysOn();

    return this.registry
      .snapshot()
      .plugins.filter((plugin) => plugin.mcpServers.length > 0)
      .map((plugin) => ({
        name: plugin.manifest.name,
        active: always.has(plugin.manifest.name) || !isGated(plugin) || active.has(plugin.manifest.name),
        alwaysOn: always.has(plugin.manifest.name)
      }));
  }

  /**
   * Turns on the servers a skill implies.
   *
   * Two routes, and both are needed. The plugin that owns the skill is the
   * common one — loading `github:pr-review` should make the github server
   * usable. A skill may also name servers in other plugins through its
   * `dependencies.tools` sidecar, which is the only cross-plugin route and the
   * reason that key is parsed at all.
   */
  activateForSkill(conversationId: string, pluginName: string, requiredServers: string[]): boolean {
    const owners = new Set<string>([pluginName]);

    if (requiredServers.length > 0) {
      for (const plugin of this.registry.snapshot().plugins) {
        if (plugin.mcpServers.some((server) => requiredServers.includes(server.key))) {
          owners.add(plugin.manifest.name);
        }
      }
    }

    return this.activate(conversationId, [...owners]);
  }

  /** Returns whether this changed anything, so a caller can say so. */
  activate(conversationId: string, pluginNames: string[]): boolean {
    const all = this.read();
    const current = new Set(all[conversationId]?.plugins ?? []);
    const before = current.size;

    for (const name of pluginNames) {
      current.add(name);
    }

    if (current.size === before) {
      return false;
    }

    all[conversationId] = { plugins: [...current] };
    this.write(prune(all, this.maxConversations));
    return true;
  }

  deactivate(conversationId: string, pluginName: string): void {
    const all = this.read();
    const current = all[conversationId]?.plugins ?? [];

    if (!current.includes(pluginName)) {
      return;
    }

    all[conversationId] = { plugins: current.filter((name) => name !== pluginName) };
    this.write(all);
  }

  activated(conversationId: string): Set<string> {
    return new Set(this.read()[conversationId]?.plugins ?? []);
  }

  /**
   * Whether a server may be offered to this conversation.
   *
   * Servers from ungated plugins always pass. This is the predicate the tool
   * set is built through, so a `false` here means the server is neither
   * connected nor described to the model — the token saving and the process
   * saving are the same decision.
   */
  serverFilter(conversationId: string): (serverId: string) => boolean {
    const active = this.activated(conversationId);
    const always = this.alwaysOn();
    const gatedServerIds = new Set<string>();

    for (const plugin of this.registry.snapshot().plugins) {
      if (isGated(plugin) && !always.has(plugin.manifest.name) && !active.has(plugin.manifest.name)) {
        for (const server of plugin.mcpServers) {
          gatedServerIds.add(`plugin:${plugin.manifest.name}:${server.key}`);
        }
      }
    }

    return (serverId: string) => !gatedServerIds.has(serverId);
  }

  /** The filter used outside a conversation — prewarm, health. Gated servers never warm. */
  eagerOnlyFilter(): (serverId: string) => boolean {
    const always = this.alwaysOn();
    const gated = new Set<string>();

    for (const plugin of this.registry.snapshot().plugins) {
      if (isGated(plugin) && !always.has(plugin.manifest.name)) {
        for (const server of plugin.mcpServers) {
          gated.add(`plugin:${plugin.manifest.name}:${server.key}`);
        }
      }
    }

    return (serverId: string) => !gated.has(serverId);
  }
}

/**
 * Keeps the stored map bounded.
 *
 * Activation is written per conversation and a long-lived install would
 * otherwise accumulate a row per conversation forever. Insertion order is the
 * proxy for age: the map is rebuilt in the order keys were added, so dropping
 * from the front drops the oldest.
 */
function prune(
  all: Record<string, ActivationRecord>,
  max: number
): Record<string, ActivationRecord> {
  const keys = Object.keys(all);

  if (keys.length <= max) {
    return all;
  }

  return Object.fromEntries(keys.slice(keys.length - max).map((key) => [key, all[key]!]));
}
