import { rmSync } from 'node:fs';
import { join } from 'node:path';

import type { MarketplaceEntryView, MarketplaceView, MarketplacesView } from '../../shared/contracts';
import type { MarketplaceEntry } from '../../shared/marketplace';
import { BUNDLED_MARKETPLACE_NAME, marketplaceEntryBlocker } from '../../shared/marketplace';
import { logger } from '../observability/logger';
import { readPluginCapability, readPluginIconPath } from './PluginLoader';
import { pluginIconUrl } from './pluginIconUrl';
import type { PluginInstaller } from './PluginInstaller';
import type { MarketplaceRecord, MarketplaceRegistry, ResolvedMarketplace } from './MarketplaceRegistry';
import type { PluginRegistry } from './PluginRegistry';

/**
 * The write side of marketplaces.
 *
 * Sits between IPC and the two registries: one knows what catalogues list, the
 * other knows what is installed. Everything a user can do to a marketplace goes
 * through here so the validation lives in one place rather than in each handler.
 */

/** Used as a checkout directory name and as the `@marketplace` suffix. */
const NAME_PATTERN = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i;
const MAX_NAME_LENGTH = 64;

export class PluginMarketplaceService {
  constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly plugins: PluginRegistry,
    private readonly installer: PluginInstaller,
    private readonly readRecords: () => MarketplaceRecord[],
    private readonly writeRecords: (records: MarketplaceRecord[]) => void
  ) {}

  add(record: MarketplaceRecord): void {
    const name = record.name.trim();

    if (!name || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
      // The name becomes a directory under the checkout root, so anything
      // carrying a separator would be choosing where Atlas clones to.
      throw new Error('A marketplace name may only contain letters, digits, and separators.');
    }

    if (name.toLowerCase() === BUNDLED_MARKETPLACE_NAME) {
      // Reserved: a user marketplace under this name would shadow the one the
      // app ships, and its plugins would quietly vanish.
      throw new Error(`"${BUNDLED_MARKETPLACE_NAME}" is reserved for the plugins Atlas ships with.`);
    }

    const existing = this.readRecords();

    if (existing.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A marketplace called "${name}" is already added.`);
    }

    if (record.source.kind === 'git' && !/^https:\/\//i.test(record.source.url)) {
      // Plain http would mean fetching executable code over a channel nobody
      // can authenticate.
      throw new Error('A marketplace URL must use https.');
    }

    if (record.source.kind === 'path' && !record.source.path.trim()) {
      throw new Error('A marketplace folder needs a path.');
    }

    const normalized: MarketplaceRecord = { ...record, name };

    // Resolved before it is saved, so a marketplace that cannot be read is
    // rejected at the moment the user can still fix what they typed.
    const resolved = this.marketplaces.resolve(normalized);

    if (resolved.error) {
      throw new Error(resolved.error);
    }

    this.writeRecords([...existing, normalized]);
  }

  remove(name: string): void {
    if (name === BUNDLED_MARKETPLACE_NAME) {
      throw new Error('The plugins Atlas ships with cannot be removed.');
    }

    this.writeRecords(this.readRecords().filter((entry) => entry.name !== name));
  }

  /** Every marketplace with its catalogue, and what is already installed. */
  view(): MarketplacesView {
    const installed = new Set(
      [...this.plugins.snapshot().plugins, ...this.plugins.snapshot().disabled].map(
        (plugin) => plugin.manifest.name
      )
    );

    return {
      marketplaces: this.marketplaces.resolveAll().map((resolved) => toView(resolved, installed))
    };
  }

  /**
   * Installs anything the app ships that asks to be present, once.
   *
   * Only built-in marketplaces are honoured here. `INSTALLED_BY_DEFAULT` in a
   * third-party catalogue is a request from a stranger to run their code
   * without being asked, and no catalogue gets to decide that — for those it
   * stays an ordinary listing the user installs deliberately.
   *
   * Idempotent: an entry already installed is skipped, so a plugin the user
   * removed on purpose stays removed rather than coming back every launch.
   */
  installDefaults(): void {
    for (const resolved of this.marketplaces.resolveAll()) {
      if (!resolved.record.builtIn || !resolved.catalog || !resolved.root) {
        continue;
      }

      const installed = new Set(
        this.plugins.snapshot().plugins.concat(this.plugins.snapshot().disabled).map(
          (plugin) => plugin.manifest.name
        )
      );

      for (const entry of resolved.catalog.entries) {
        if (entry.installPolicy !== 'INSTALLED_BY_DEFAULT' || installed.has(entry.name)) {
          continue;
        }

        try {
          this.install(resolved.record.name, entry.name);
        } catch (error) {
          // A bundled plugin that will not install is a packaging fault, not
          // something to fail startup over.
          logger.warn('plugins.default_install_failed', {
            plugin: entry.name,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  /**
   * Fetches one catalogue entry and installs it.
   *
   * The bundle is materialised into a directory and then handed to the same
   * installer a local folder goes through — validated, staged, checked for
   * links out of itself, and published by one atomic rename. A marketplace
   * gets no shortcut past any of that.
   */
  install(marketplaceName: string, pluginName: string): void {
    const resolved = this.marketplaces
      .resolveAll()
      .find((entry) => entry.record.name === marketplaceName);

    if (!resolved) {
      throw new Error(`"${marketplaceName}" is not an added marketplace.`);
    }

    if (resolved.error || !resolved.catalog || !resolved.root) {
      throw new Error(resolved.error ?? `"${marketplaceName}" has no catalogue.`);
    }

    const entry = resolved.catalog.entries.find((candidate) => candidate.name === pluginName);

    if (!entry) {
      throw new Error(`"${pluginName}" is not listed by ${marketplaceName}.`);
    }

    const blocker = marketplaceEntryBlocker(entry);

    if (blocker) {
      throw new Error(blocker);
    }

    const materialized = this.marketplaces.materialize(resolved.root, entry);

    try {
      const result = this.installer.install(materialized.path);

      if (!result.ok) {
        throw new Error(result.error);
      }
    } finally {
      // A git entry is fetched into a throwaway checkout. Leaving those behind
      // is how a plugins directory fills up with copies nobody asked for.
      if (materialized.disposable) {
        rmSync(materialized.path, { recursive: true, force: true });
      }
    }
  }
}

function toView(resolved: ResolvedMarketplace, installed: Set<string>): MarketplaceView {
  return {
    name: resolved.record.name,
    builtIn: resolved.record.builtIn === true,
    displayName: resolved.catalog?.displayName ?? null,
    description: resolved.catalog?.description ?? null,
    owner: resolved.catalog?.owner ?? null,
    sourceLabel:
      resolved.record.source.kind === 'git'
        ? resolved.record.source.url
        : resolved.record.source.path,
    error: resolved.error,
    entries: (resolved.catalog?.entries ?? []).map((entry) =>
      toEntryView(entry, installed, resolved.root, resolved.record.builtIn === true)
    )
  };
}

function toEntryView(
  entry: MarketplaceEntry,
  installed: Set<string>,
  marketplaceRoot: string | null,
  builtIn: boolean
): MarketplaceEntryView {
  return {
    name: entry.name,
    description: entry.description,
    // Only a `local` entry has artwork on disk before it is installed: a git
    // entry's bundle has not been fetched yet, so the grid draws a monogram.
    iconUrl:
      entry.source.kind === 'local' && marketplaceRoot
        ? pluginIconUrl(readPluginIconPath(join(marketplaceRoot, entry.source.path)))
        : null,
    category: entry.category,
    version: entry.version,
    // Said plainly rather than as a source kind: "from GitHub" is what the
    // decision actually turns on.
    origin: builtIn ? 'Atlas' : describeOrigin(entry),
    builtIn,
    installed: installed.has(entry.name),
    // Non-null means Atlas refuses it. Shown rather than filtered out, so a
    // catalogue is not silently shorter than the one the publisher wrote.
    blocked: marketplaceEntryBlocker(entry) ?? unusableReason(entry, marketplaceRoot),
    authOnInstall: entry.authPolicy === 'ON_INSTALL'
  };
}

/**
 * Why an otherwise-valid entry would do nothing if installed.
 *
 * Only answerable for a `local` entry, whose bundle is already on disk. A git
 * entry is not fetched until install, so it is listed without this judgement
 * rather than guessed at.
 */
function unusableReason(entry: MarketplaceEntry, marketplaceRoot: string | null): string | null {
  if (entry.source.kind !== 'local' || !marketplaceRoot) {
    return null;
  }

  return readPluginCapability(join(marketplaceRoot, entry.source.path)).usable
    ? null
    : 'This plugin provides no skills or tools that Atlas can run.';
}

function describeOrigin(entry: MarketplaceEntry): string {
  if (entry.source.kind === 'local') {
    return 'this marketplace';
  }

  if (entry.source.kind === 'git') {
    const host = hostOf(entry.source.url);
    // Whether the code is pinned is the part worth surfacing: an unpinned entry
    // installs whatever the branch points at today.
    return entry.source.sha ? `${host}, pinned` : `${host}, unpinned`;
  }

  return entry.source.detail;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'a git repository';
  }
}
