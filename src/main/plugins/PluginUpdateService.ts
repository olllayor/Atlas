import { rmSync } from 'node:fs';
import { join } from 'node:path';

import type { PluginUpdateView } from '../../shared/contracts';
import type { MarketplaceEntry } from '../../shared/marketplace';
import { marketplaceEntryBlocker } from '../../shared/marketplace';
import { comparePluginVersions } from '../../shared/plugins';
import { logger } from '../observability/logger';
import type { MarketplaceRegistry, ResolvedMarketplace } from './MarketplaceRegistry';
import type { PluginBlocklistService } from './PluginBlocklistService';
import type { PluginInstaller } from './PluginInstaller';
import { readPluginVersion } from './PluginLoader';
import type { PluginOriginStore } from './PluginOrigins';
import type { PluginRegistry } from './PluginRegistry';

/**
 * Keeping installed bundles current.
 *
 * Without this an installed plugin is frozen at its install version forever:
 * there is no comparison, no way to ask, and no path to a newer copy short of
 * uninstalling and installing again — which also throws away everything the
 * conversation had activated.
 *
 * The check is deliberately a user action rather than a poll. Resolving a
 * marketplace re-clones it, and a background timer doing that to every git
 * remote the user ever added is both a network cost they did not ask for and a
 * signal to those remotes about when the app is running.
 */

export class PluginUpdateService {
  constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly plugins: PluginRegistry,
    private readonly installer: PluginInstaller,
    private readonly origins: PluginOriginStore,
    private readonly blocklist: PluginBlocklistService
  ) {}

  /**
   * What every installed plugin's marketplace currently offers.
   *
   * Reports one row per installed bundle, including the ones with no answer.
   * A plugin Atlas cannot check is the case a user most needs told about — it
   * is the one that will silently never update — so `unknown` is a status here
   * rather than an omission.
   */
  check(): PluginUpdateView[] {
    const resolved = this.marketplaces.resolveAll();

    // The check already paid for resolving every marketplace, so the revocation
    // list is refreshed from the same fetch rather than a second one.
    this.blocklist.refresh(resolved);
    this.plugins.invalidate();

    const snapshot = this.plugins.snapshot();
    const installed = [
      ...snapshot.plugins,
      ...snapshot.disabled,
      ...snapshot.blocked.map((entry) => entry.plugin)
    ];

    return installed
      .map((plugin) => this.checkOne(plugin.manifest.name, plugin.manifest.version, resolved))
      .sort((left, right) => left.plugin.localeCompare(right.plugin));
  }

  /**
   * Re-fetches one plugin's catalogue entry and replaces what is installed.
   *
   * The new bundle goes through the same installer a first install does —
   * validated, staged, checked for links out of itself — and only then replaces
   * the old one. An update is not a shortcut past any of that; it is the same
   * install with permission to overwrite.
   */
  update(name: string): void {
    const origin = this.origins.get(name);

    if (!origin?.marketplace) {
      throw new Error(
        `Atlas does not know where "${name}" came from, so it cannot fetch a newer copy. Install it from a marketplace to enable updates.`
      );
    }

    // Resolved once and reused: every call re-clones each git marketplace, so a
    // second `resolveAll` here would double the network cost of one update.
    const all = this.marketplaces.resolveAll();
    // Refreshed from this fetch, then consulted below: a plugin revoked since
    // it was installed must not be reinstallable through the update button.
    this.blocklist.refresh(all);

    const resolved = all.find((candidate) => candidate.record.name === origin.marketplace);

    if (!resolved) {
      throw new Error(`"${origin.marketplace}" is no longer an added marketplace.`);
    }

    if (resolved.error || !resolved.catalog || !resolved.root) {
      throw new Error(resolved.error ?? `"${origin.marketplace}" has no catalogue.`);
    }

    const entryName = origin.entry ?? name;
    const entry = resolved.catalog.entries.find((candidate) => candidate.name === entryName);

    if (!entry) {
      throw new Error(`"${entryName}" is no longer listed by ${origin.marketplace}.`);
    }

    const blocker = marketplaceEntryBlocker(entry);

    if (blocker) {
      throw new Error(blocker);
    }

    const revoked = this.blocklist.checkEntry(origin.marketplace, entryName, entry.version);

    if (revoked) {
      throw new Error(revoked.message);
    }

    const materialized = this.marketplaces.materialize(resolved.root, entry);

    try {
      const result = this.installer.install(materialized.path, {
        replaceExisting: true,
        // The name is the identity everything else is keyed by — the enabled
        // switch, the activations, the qualified skill names. An entry that now
        // ships something else is a new plugin, not a newer one.
        expectName: name,
        origin: {
          marketplace: origin.marketplace,
          entry: entryName,
          sha: entry.source.kind === 'git' ? entry.source.sha : null,
          // A catalogue install is identified by its marketplace and entry, so
          // the URL fields stay empty. They are how a *pasted-link* install is
          // found again; see `installFromUrl`.
          url: null,
          ref: null,
          subdir: null,
          // Filled by the installer, which is the only place that has read the
          // bundle that actually landed.
          connectors: null
        }
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      logger.info('plugins.update_applied', {
        name,
        from: result.replaced,
        to: result.version
      });
    } finally {
      if (materialized.disposable) {
        rmSync(materialized.path, { recursive: true, force: true });
      }
    }
  }

  private checkOne(
    name: string,
    installed: string,
    resolved: ResolvedMarketplace[]
  ): PluginUpdateView {
    const origin = this.origins.get(name);
    const base = {
      plugin: name,
      installed,
      available: null,
      installedSha: origin?.sha ?? null,
      availableSha: null,
      detail: null
    };

    if (!origin?.marketplace) {
      return {
        ...base,
        marketplace: null,
        status: 'unknown',
        detail: 'Installed from a folder, so there is nothing to check against.'
      };
    }

    const marketplace = resolved.find((candidate) => candidate.record.name === origin.marketplace);

    if (!marketplace || marketplace.error || !marketplace.catalog || !marketplace.root) {
      return {
        ...base,
        marketplace: origin.marketplace,
        status: 'unavailable',
        detail: marketplace
          ? (marketplace.error ?? 'Its marketplace has no catalogue.')
          : 'Its marketplace is no longer added.'
      };
    }

    const entryName = origin.entry ?? name;
    const entry = marketplace.catalog.entries.find((candidate) => candidate.name === entryName);

    if (!entry) {
      return {
        ...base,
        marketplace: origin.marketplace,
        status: 'unavailable',
        detail: 'It is no longer listed by that marketplace.'
      };
    }

    const sha = entry.source.kind === 'git' ? entry.source.sha : null;
    const movedCommit = Boolean(sha && origin.sha && sha !== origin.sha);
    const withSha = { ...base, marketplace: origin.marketplace, availableSha: sha };

    const available = offeredVersion(entry, marketplace.root);

    if (available) {
      const order = comparePluginVersions(available, installed);

      if (order == null) {
        // An ordering this cannot compute is reported as unknown rather than as
        // an update: offering to replace working code on a version string
        // nobody can rank is how an update button loses a user's trust.
        return {
          ...withSha,
          available,
          status: 'unknown',
          detail: 'Its version cannot be compared with the installed one.'
        };
      }

      if (order > 0) {
        return { ...withSha, available, status: 'update-available' };
      }

      // The case this function used to answer wrong. Same version, different
      // commit: the catalogue is offering *different code under the same name*.
      // Reporting it as up-to-date meant a moved tag or a force-pushed release
      // reached users through the update button with nothing said.
      if (movedCommit) {
        return {
          ...withSha,
          available,
          status: 'republished',
          detail:
            `Version ${available} was republished at a different commit ` +
            `(${origin.sha!.slice(0, 7)} → ${sha!.slice(0, 7)}). The code changed without the version changing.`
        };
      }

      return { ...withSha, available, status: 'up-to-date' };
    }

    // No version anywhere, but a pinned commit that moved is still an answer:
    // the catalogue is offering different code than the copy on disk.
    if (movedCommit) {
      return {
        ...withSha,
        status: 'update-available',
        detail: `Its marketplace now pins a different commit (${sha!.slice(0, 7)}).`
      };
    }

    if (sha && origin.sha) {
      return { ...withSha, status: 'up-to-date' };
    }

    return {
      ...withSha,
      status: 'unknown',
      detail: 'Its marketplace publishes no version for this plugin.'
    };
  }
}

/**
 * The version a catalogue is offering, if it says.
 *
 * The catalogue's own `version` leads, because that is what the publisher chose
 * to advertise. When it is silent and the bundle is a directory in the
 * marketplace, the manifest beside the code answers instead — most local
 * entries carry no version at all, so without this fallback the common case is
 * the uncheckable one.
 */
function offeredVersion(entry: MarketplaceEntry, marketplaceRoot: string): string | null {
  if (entry.version) {
    return entry.version;
  }

  return entry.source.kind === 'local'
    ? readPluginVersion(join(marketplaceRoot, entry.source.path))
    : null;
}
