import { rmSync } from 'node:fs';
import { join } from 'node:path';

import type {
  MarketplaceEntryView,
  MarketplaceView,
  MarketplacesView,
  PluginUrlPreview
} from '../../shared/contracts';
import type { MarketplaceEntry } from '../../shared/marketplace';
import { BUNDLED_MARKETPLACE_NAME, marketplaceEntryBlocker } from '../../shared/marketplace';
import { describePluginUrl, parsePluginUrl } from '../../shared/pluginUrl';
import { logger } from '../observability/logger';
import { loadPlugin, readPluginCapability, readPluginIconPath } from './PluginLoader';
import { fetchRepository } from './MarketplaceRegistry';
import { pluginIconUrl } from './pluginIconUrl';
import type { PluginBlocklistService } from './PluginBlocklistService';
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
    private readonly writeRecords: (records: MarketplaceRecord[]) => void,
    /**
     * Optional so the tests can build a service without one.
     *
     * Present in production: resolving marketplaces is the only moment
     * revocations are readable, so every path that resolves them refreshes the
     * list rather than leaving it to a fetch of its own.
     */
    private readonly blocklist?: PluginBlocklistService
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
    // Its checkout is now something nothing refers to. Collected here rather
    // than only at startup so removing a marketplace reclaims the disk it used.
    this.marketplaces.sweepCheckouts();
  }

  /** Every marketplace with its catalogue, and what is already installed. */
  view(): MarketplacesView {
    const snapshot = this.plugins.snapshot();
    const installed = new Set(
      [...snapshot.plugins, ...snapshot.disabled, ...snapshot.blocked.map((entry) => entry.plugin)].map(
        (plugin) => plugin.manifest.name
      )
    );

    const resolved = this.marketplaces.resolveAll();

    // Opening the plugins page already re-reads every marketplace, so the
    // revocation list is refreshed from that fetch rather than a second one.
    this.blocklist?.refresh(resolved);
    this.plugins.invalidate();

    return {
      marketplaces: resolved.map((entry) => toView(entry, installed, this.blocklist))
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
    // Available checkouts only: a built-in git marketplace whose checkout has
    // never been fetched must not turn startup into a 77 MB clone. It has no
    // defaults to install until the user has opened the directory anyway.
    const resolvedAll = this.marketplaces.resolveAvailable();

    // Startup already resolves every marketplace here, so this is where the
    // revocation list is picked up for the session — before anything installs.
    this.blocklist?.refresh(resolvedAll);
    this.plugins.invalidate();

    for (const resolved of resolvedAll) {
      if (!resolved.record.builtIn || !resolved.catalog || !resolved.root) {
        continue;
      }

      const snapshot = this.plugins.snapshot();
      const installed = new Set(
        [...snapshot.plugins, ...snapshot.disabled, ...snapshot.blocked.map((e) => e.plugin)].map(
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

    const revoked = this.blocklist?.checkEntry(marketplaceName, pluginName, entry.version);

    if (revoked) {
      // Refused at install as well as at load, or a revoked plugin would be one
      // click away from running again.
      throw new Error(revoked.message);
    }

    const materialized = this.marketplaces.materialize(resolved.root, entry);

    try {
      // The directory card refuses this earlier for a `local` entry, but the
      // card's judgement cannot see a git entry's bundle — it has not been
      // fetched yet. The install is the place the refusal must bind for every
      // source kind, or a connector-only bundle lands as a row that can never
      // do anything.
      if (!readPluginCapability(materialized.path).usable) {
        throw new Error('This plugin provides no skills or tools that Atlas can run.');
      }

      const result = this.installer.install(materialized.path, {
        // Recorded so the update check knows what to re-fetch, and so a scoped
        // revocation can tell this copy from one installed elsewhere.
        origin: {
          marketplace: marketplaceName,
          entry: pluginName,
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
    } finally {
      // A git entry is fetched into a throwaway checkout. Leaving those behind
      // is how a plugins directory fills up with copies nobody asked for.
      if (materialized.disposable) {
        rmSync(materialized.path, { recursive: true, force: true });
      }
    }
  }

  /**
   * Installs a bundle from a link the user pasted.
   *
   * The gap this closes: an Agent Plugins bundle is a directory in somebody's
   * repository, and people find them on a forge. Before this, the only ways in
   * were a native folder picker — which means clone it yourself first — or
   * adding a whole marketplace for one plugin. Neither is what a person means
   * when they say "install this".
   *
   * It is the same install as every other, with the same validation, staging
   * and containment checks. The only new thing is where the directory came
   * from, and that is recorded rather than forgotten so the plugin stays
   * updatable.
   */
  installFromUrl(input: string): { name: string; version: string } {
    const parsed = parsePluginUrl(input);

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    const fetched = fetchRepository(this.marketplaces.checkoutDirectory, parsed.target);

    try {
      // Refused before the install, not after. A revoked bundle reachable by
      // pasting its repository URL would make the blocklist a formality — the
      // catalogue path already refuses it, and this is the same decision.
      const probe = loadPlugin(fetched.path);

      if (!probe.ok) {
        throw new Error(probe.error);
      }

      // Same refusal a catalogue install makes: a bundle whose only component
      // is a connector installs cleanly and then sits there forever, because
      // Atlas has no connector broker. Refused while the checkout is still at
      // hand rather than published and stranded.
      if (!readPluginCapability(fetched.path).usable) {
        throw new Error('This plugin provides no skills or tools that Atlas can run.');
      }

      const revoked = this.blocklist?.check(probe.plugin.manifest.name, probe.plugin.manifest.version);

      if (revoked) {
        throw new Error(revoked.message);
      }

      const result = this.installer.install(fetched.path, {
        origin: {
          // No marketplace: nobody vouched for this, the user did. That
          // distinction matters for scoped revocations, which may only bind
          // what their own catalogue published.
          marketplace: null,
          entry: null,
          sha: fetched.sha,
          url: parsed.target.url,
          ref: parsed.target.ref,
          subdir: parsed.target.subdir,
          connectors: null
        }
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      logger.info('plugins.installed_from_url', {
        name: result.name,
        url: parsed.target.url,
        sha: fetched.sha
      });

      return { name: result.name, version: result.version };
    } finally {
      rmSync(fetched.root, { recursive: true, force: true });
    }
  }

  /**
   * What a link would install, without installing it.
   *
   * Fetches, reads the bundle, throws the checkout away. This is what makes the
   * confirmation honest: the capability summary is built from the *resolved*
   * manifest — the literal commands, endpoints and variables — rather than from
   * a description the author wrote. A summary derived from anything the author
   * controls is a summary the author can lie in.
   */
  previewUrl(input: string): PluginUrlPreview {
    const parsed = parsePluginUrl(input);

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    const fetched = fetchRepository(this.marketplaces.checkoutDirectory, parsed.target);

    try {
      const probe = loadPlugin(fetched.path);

      if (!probe.ok) {
        throw new Error(probe.error);
      }

      const plugin = probe.plugin;
      const revoked = this.blocklist?.check(plugin.manifest.name, plugin.manifest.version);

      return {
        source: describePluginUrl(parsed.target),
        sha: fetched.sha,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        format: plugin.manifest.format,
        installed: this.plugins.snapshot().plugins.some((p) => p.manifest.name === plugin.manifest.name),
        blockedReason: revoked?.message ?? null,
        skills: plugin.skills.map((skill) => skill.name),
        commands: plugin.commands.map((command) => command.name),
        servers: plugin.mcpServers.map((server) => ({
          key: server.key,
          transport: server.transport,
          detail:
            server.transport === 'stdio'
              ? [server.command, ...server.args].filter(Boolean).join(' ')
              : (server.url ?? ''),
          envKeys: Object.keys(server.env),
          envVars: server.envVars,
          headerNames: Object.keys(server.headers)
        })),
        connectors: plugin.connectors.map((connector) => ({
          key: connector.key,
          id: connector.id,
          kind: connector.kind,
          capabilities: connector.capabilities,
          category: connector.category,
          required: connector.required
        })),
        hooksDeclared: plugin.manifest.paths.hooks != null || 'hooks' in plugin.manifest.unknown,
        warnings: plugin.warnings
      };
    } finally {
      rmSync(fetched.root, { recursive: true, force: true });
    }
  }
}

function toView(
  resolved: ResolvedMarketplace,
  installed: Set<string>,
  blocklist: PluginBlocklistService | undefined
): MarketplaceView {
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
      toEntryView(
        entry,
        installed,
        resolved.root,
        resolved.record.builtIn === true,
        blocklist?.checkEntry(resolved.record.name, entry.name, entry.version)?.message ?? null
      )
    )
  };
}

function toEntryView(
  entry: MarketplaceEntry,
  installed: Set<string>,
  marketplaceRoot: string | null,
  builtIn: boolean,
  revoked: string | null
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
    // catalogue is not silently shorter than the one the publisher wrote. A
    // revocation leads: it is the reason that outranks every other.
    blocked: revoked ?? marketplaceEntryBlocker(entry) ?? unusableReason(entry, marketplaceRoot),
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
