import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where Atlas keeps everything a user could reasonably want to look at.
 *
 * Installed bundles, marketplace checkouts and per-plugin data live together
 * under one visible directory rather than split between here and Electron's
 * `userData`. A plugin is a folder someone may want to open, edit, or copy;
 * burying half of that under Application Support makes it findable only by
 * someone who already knows where to look.
 *
 * Split out of `bundledMarketplace.ts` for the reason `pluginIconUrl.ts` states
 * about itself: that module imports `electron/main`, which makes it unloadable
 * outside an Electron process, and `PluginLoader` is imported directly by the
 * tests. A path helper has no business dragging a runtime in behind it.
 */
export function atlasHome(): string {
  return join(homedir(), '.atlas');
}

export function marketplaceCheckoutRoot(): string {
  return join(atlasHome(), 'marketplaces');
}

/**
 * The client-managed writable directory for one plugin.
 *
 * Deliberately **outside** `~/.atlas/plugins/`, and that placement is the whole
 * design. The Agent Plugins spec requires this directory to survive updates,
 * and an update is a directory swap: the old bundle is renamed aside and
 * deleted. Anything living inside it would be destroyed by exactly the
 * operation the spec says it must survive. A sibling root also keeps the
 * registry scan from mistaking a plugin's cache for an installed plugin.
 */
export function pluginDataDir(pluginName: string): string {
  return join(atlasHome(), 'plugin-data', pluginName);
}
