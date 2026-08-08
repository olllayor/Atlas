import type { Blocklist, BlocklistEntry } from '../../shared/blocklist';
import { EMPTY_BLOCKLIST, describeBlock, findBlock } from '../../shared/blocklist';
import { comparePluginVersions } from '../../shared/plugins';
import { logger } from '../observability/logger';
import type { ResolvedMarketplace } from './MarketplaceRegistry';
import type { PluginOriginStore } from './PluginOrigins';

/**
 * Un-trusting code that is already installed.
 *
 * Atlas can install a third-party bundle and, until now, could never take that
 * back: an install was permanent until the user happened to remove it. A
 * blocklist is the missing half — a marketplace can withdraw what it published,
 * and Atlas can withdraw anything at all.
 *
 * Two rules make this safe to build out of files fetched from strangers:
 *
 * 1. **A marketplace may only revoke what it published.** An entry from a
 *    third-party catalogue is narrowed to that marketplace, so nobody can
 *    revoke a rival's plugin, and nobody can revoke a plugin installed from a
 *    folder. The marketplace Atlas ships with is exempt, because that one is
 *    the app speaking about its own users.
 * 2. **The answer is cached and persisted.** The plugin scan runs on the
 *    turn-setup path and must never reach the network, and a revocation that
 *    only applies while a remote is reachable is one an attacker defeats by
 *    unplugging a cable.
 */

export type PluginBlock = { reason: BlocklistEntry['reason']; message: string };

export class PluginBlocklistService {
  private cache: Blocklist | null = null;

  constructor(
    private readonly read: () => Blocklist,
    private readonly write: (value: Blocklist) => void,
    private readonly origins: PluginOriginStore
  ) {}

  /**
   * Recomputes the aggregate from whatever the marketplaces currently publish.
   *
   * Called wherever marketplaces are resolved anyway — startup and the plugins
   * page — rather than on a timer of its own. The result replaces the stored
   * one outright: a revocation the publisher has withdrawn should stop applying,
   * and keeping a union of everything ever seen would make that impossible.
   */
  refresh(resolved: ResolvedMarketplace[]): Blocklist {
    const entries: BlocklistEntry[] = [];

    for (const marketplace of resolved) {
      if (!marketplace.blocklist) {
        continue;
      }

      const trusted = marketplace.record.builtIn === true;

      for (const entry of marketplace.blocklist.entries) {
        // What the app ships may revoke anything, including a bundle installed
        // from a folder. Everyone else is confined to their own storefront.
        if (trusted) {
          entries.push(entry);
          continue;
        }

        if (entry.marketplace && entry.marketplace !== marketplace.record.name) {
          logger.warn('plugins.blocklist_out_of_scope', {
            marketplace: marketplace.record.name,
            claimed: entry.marketplace,
            plugin: entry.plugin
          });
          continue;
        }

        entries.push({ ...entry, marketplace: marketplace.record.name });
      }
    }

    const blocklist: Blocklist = { entries };

    this.cache = blocklist;
    this.write(blocklist);

    if (entries.length > 0) {
      logger.info('plugins.blocklist_refreshed', { count: entries.length });
    }

    return blocklist;
  }

  /** The stored aggregate, read once and held for the process's lifetime. */
  current(): Blocklist {
    if (!this.cache) {
      this.cache = normalize(this.read());
    }

    return this.cache;
  }

  /**
   * Why a plugin may not run, or `null`.
   *
   * Matched against the recorded provenance, so `foo@some-market` does not
   * silence a different `foo` the user installed from elsewhere.
   */
  check(name: string, version: string | null): PluginBlock | null {
    const entry = findBlock(
      this.current(),
      { name, version, origin: this.origins.get(name)?.marketplace ?? null },
      comparePluginVersions
    );

    return entry ? { reason: entry.reason, message: describeBlock(entry) } : null;
  }

  /**
   * Whether a catalogue entry may be installed, and why not.
   *
   * The install-time half: an entry under revocation must not be installable in
   * the first place, or a blocked plugin is one reinstall away from running.
   */
  checkEntry(marketplace: string, plugin: string, version: string | null): PluginBlock | null {
    const entry = findBlock(
      this.current(),
      { name: plugin, version, origin: marketplace },
      comparePluginVersions
    );

    return entry ? { reason: entry.reason, message: describeBlock(entry) } : null;
  }
}

/** Tolerates whatever an older build, or a hand-edited settings row, left. */
function normalize(value: unknown): Blocklist {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as Blocklist).entries)) {
    return EMPTY_BLOCKLIST;
  }

  return {
    entries: (value as Blocklist).entries.filter(
      (entry) => entry && typeof entry.plugin === 'string' && entry.plugin.length > 0
    )
  };
}
