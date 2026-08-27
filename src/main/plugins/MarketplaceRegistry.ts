import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

import type { Blocklist } from '../../shared/blocklist';
import { BLOCKLIST_PATHS, parseBlocklist } from '../../shared/blocklist';
import type { MarketplaceCatalog, MarketplaceEntry } from '../../shared/marketplace';
import { MARKETPLACE_CATALOG_PATHS, marketplaceEntryBlocker, parseMarketplaceCatalog } from '../../shared/marketplace';
import { logger } from '../observability/logger';

/**
 * Marketplaces the user has added, and the plugins they list.
 *
 * A marketplace is either a directory on this machine or a git repository. Both
 * reduce to the same thing — a checkout with one catalogue file in it — so the
 * only difference is whether a clone happens first.
 *
 * Nothing here executes anything from a marketplace. `git` is invoked through
 * `execFile` with an argument list and no shell, and the only files read are
 * the catalogue and, later, the bundle the installer validates.
 */

/** Bounded so a hostile or broken remote cannot hold the UI open. */
const GIT_TIMEOUT_MS = 60_000;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

export type MarketplaceSourceConfig =
  | { kind: 'path'; path: string }
  | { kind: 'git'; url: string; ref: string | null };

export type MarketplaceRecord = {
  /** Stable id, and the `@marketplace` suffix on every install from it. */
  name: string;
  source: MarketplaceSourceConfig;
  /** Shipped with the app. Present without being added, and not removable. */
  builtIn?: boolean;
};

export type ResolvedMarketplace = {
  record: MarketplaceRecord;
  catalog: MarketplaceCatalog | null;
  /**
   * Revocations this marketplace publishes.
   *
   * Read alongside the catalogue because it travels with it. Whose revocations
   * are allowed to bind what is not decided here — see `PluginBlocklistService`.
   */
  blocklist: Blocklist | null;
  /** Absolute path to the checkout the catalogue was read from. */
  root: string | null;
  error: string | null;
};

export class MarketplaceRegistry {
  constructor(
    private readonly listRecords: () => MarketplaceRecord[],
    /** Where git marketplaces are checked out. Kept beside the plugins. */
    private readonly checkoutRoot: string
  ) {}

  /**
   * Where throwaway fetches go.
   *
   * Exposed so a URL install lands beside the marketplace clones rather than in
   * a root of its own: `sweepCheckouts()` already collects every `fetch-`
   * temporary here, so an install interrupted halfway is cleaned up by
   * machinery that exists, not by a second copy of it.
   */
  get checkoutDirectory(): string {
    return this.checkoutRoot;
  }

  /**
   * Every configured marketplace with its catalogue.
   *
   * One failing marketplace produces an error string and no entries; it never
   * decides whether the others resolve. The same discipline the MCP manager
   * uses for servers, for the same reason.
   */
  resolveAll(): ResolvedMarketplace[] {
    return this.listRecords().map((record) => this.resolve(record));
  }

  /**
   * Every record whose checkout already exists, resolved.
   *
   * For startup paths that must not pay for a first clone: a built-in git
   * marketplace is app content fetched when the directory is first opened, not
   * something startup should block on. A user-added git marketplace always has
   * a checkout by now — `add` resolved it before saving, and every resolve
   * since re-cloned it.
   */
  resolveAvailable(): ResolvedMarketplace[] {
    return this.listRecords()
      .filter(
        (record) =>
          record.source.kind === 'path' ||
          existsSync(join(this.checkoutRoot, record.name, '.git'))
      )
      .map((record) => this.resolve(record));
  }

  /**
   * Discards the cached checkouts of built-in git marketplaces.
   *
   * The next resolve re-clones them from their remotes. This is how the
   * official catalogue gets fresh: deliberately, from the update check the
   * user pressed — never from a page open, which only reads what is on disk.
   */
  expireBuiltInCheckouts(): number {
    let expired = 0;

    for (const record of this.listRecords()) {
      if (!record.builtIn || record.source.kind !== 'git') {
        continue;
      }

      const target = join(this.checkoutRoot, record.name);

      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        expired += 1;
      }
    }

    if (expired > 0) {
      logger.info('marketplace.builtin_checkouts_expired', { count: expired });
    }

    return expired;
  }

  resolve(record: MarketplaceRecord): ResolvedMarketplace {
    let root: string;

    try {
      root = this.checkout(record);
    } catch (error) {
      return { record, catalog: null, blocklist: null, root: null, error: messageOf(error) };
    }

    const blocklist = readBlocklist(root);
    const found = readFirst(root, MARKETPLACE_CATALOG_PATHS);

    if (!found) {
      return {
        record,
        catalog: null,
        blocklist,
        root,
        error: `No catalogue. Expected one of: ${MARKETPLACE_CATALOG_PATHS.join(', ')}.`
      };
    }

    const parsed = parseMarketplaceCatalog(found);

    return parsed.ok
      ? { record, catalog: parsed.catalog, blocklist, root, error: null }
      : { record, catalog: null, blocklist, root, error: parsed.error };
  }

  /**
   * Deletes checkouts no configured marketplace still needs.
   *
   * Called at startup, and after a marketplace is removed. Every git
   * marketplace clones into a directory named after it and every fetch creates
   * a `fetch-` temporary beside those, so anything not named by a current
   * record is either a marketplace the user dropped or an interrupted install.
   *
   * Path marketplaces are deliberately not represented here: they are read in
   * place and have no checkout to collect.
   */
  sweepCheckouts(): number {
    let entries;

    try {
      entries = readdirSync(this.checkoutRoot, { withFileTypes: true });
    } catch {
      return 0;
    }

    const wanted = new Set(
      this.listRecords()
        .filter((record) => record.source.kind === 'git')
        .map((record) => record.name)
    );

    let swept = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || wanted.has(entry.name)) {
        continue;
      }

      try {
        rmSync(join(this.checkoutRoot, entry.name), { recursive: true, force: true });
        swept += 1;
      } catch {
        // Worth neither a crash nor a retry loop; the next launch tries again.
      }
    }

    if (swept > 0) {
      logger.info('marketplace.checkouts_swept', { count: swept });
    }

    return swept;
  }

  /**
   * The directory a catalogue entry's bundle lives in, cloning if needed.
   *
   * The returned path is a directory the installer can validate and copy. For a
   * git entry it is a throwaway checkout the caller is responsible for removing
   * — `disposable` says which.
   */
  materialize(
    marketplaceRoot: string,
    entry: MarketplaceEntry
  ): { path: string; disposable: boolean } {
    const blocker = marketplaceEntryBlocker(entry);

    if (blocker) {
      throw new Error(blocker);
    }

    if (entry.source.kind === 'local') {
      const path = containedPath(marketplaceRoot, entry.source.path);

      if (!path) {
        throw new Error(`"${entry.name}" points outside its marketplace.`);
      }

      return { path, disposable: false };
    }

    if (entry.source.kind !== 'git') {
      throw new Error(`Atlas cannot fetch "${entry.name}".`);
    }

    const { url, sha, ref, subdir } = entry.source;
    const temp = mkdtempSync(join(this.ensureCheckoutRoot(), 'fetch-'));

    try {
      // The pinned commit is what gets checked out. `ref` is only a fallback
      // for catalogues that publish no sha, and it is worth saying plainly that
      // such an entry is not reproducible: whatever the branch points at when
      // the clone happens is what the user gets.
      cloneAt(url, temp, sha, ref);

      const path = subdir ? containedPath(temp, subdir) : temp;

      if (!path) {
        throw new Error(`"${entry.name}" names a subdirectory outside its repository.`);
      }

      return { path, disposable: true };
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      throw error;
    }
  }

  /** Checks out a git marketplace, or returns a path marketplace as-is. */
  private checkout(record: MarketplaceRecord): string {
    if (record.source.kind === 'path') {
      const path = resolve(record.source.path);

      if (!existsSync(path)) {
        throw new Error(`${path} does not exist.`);
      }

      return realpathSync(path);
    }

    const target = join(this.ensureCheckoutRoot(), record.name);

    // A built-in git marketplace is cached app content, not a live remote the
    // user chose to track: cloned once, then served from disk until the update
    // check expires it. The official catalogue's checkout is tens of
    // megabytes — re-fetching that on every page open would turn browsing the
    // directory into a download.
    if (record.builtIn === true && existsSync(join(target, '.git'))) {
      return realpathSync(target);
    }

    // Re-cloned rather than pulled. A clone into a fresh directory cannot be
    // affected by whatever state a previous fetch left behind, and a
    // marketplace catalogue is small enough that the cost is not worth the
    // extra states a pull would introduce.
    rmSync(target, { recursive: true, force: true });
    cloneAt(record.source.url, target, null, record.source.ref);

    logger.info('marketplace.fetched', { name: record.name, url: record.source.url });
    return realpathSync(target);
  }

  private ensureCheckoutRoot(): string {
    mkdirSync(this.checkoutRoot, { recursive: true });
    return this.checkoutRoot;
  }
}

/**
 * Clones a repository, at a specific commit when one is given.
 *
 * `execFileSync` with an argument array: nothing here reaches a shell, so a
 * catalogue cannot smuggle a command through a URL or a ref. Submodules are
 * deliberately not initialised — a submodule is a second repository the
 * catalogue never named and the user never reviewed.
 */
/**
 * Fetches a repository into a throwaway checkout and says which commit landed.
 *
 * The resolved sha is the return value because it is the only identifier in the
 * chain the publisher does not choose. A ref moves; a tag can be repointed; a
 * version string is whatever the manifest says. Recording what was *actually*
 * fetched is what makes "this republished at a different commit" answerable
 * later, and it is why a URL install is provenance-bearing rather than a
 * one-way door.
 */
export function fetchRepository(
  checkoutRoot: string,
  target: { url: string; ref: string | null; subdir: string | null }
): { path: string; root: string; sha: string | null } {
  mkdirSync(checkoutRoot, { recursive: true });
  const temp = mkdtempSync(join(checkoutRoot, 'fetch-'));

  try {
    cloneAt(target.url, temp, null, target.ref);

    const path = target.subdir ? containedPath(temp, target.subdir) : temp;

    if (!path) {
      throw new Error('That link points outside the repository.');
    }

    return { path, root: temp, sha: resolveHead(temp) };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

/** The commit a checkout is sitting on, or `null` if git will not say. */
function resolveHead(checkout: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: checkout,
      timeout: GIT_TIMEOUT_MS,
      stdio: 'pipe',
      windowsHide: true
    })
      .toString()
      .trim() || null;
  } catch {
    // Not fatal. A checkout whose commit cannot be read still installs; it just
    // cannot participate in the republished-at-a-different-commit check.
    return null;
  }
}

function cloneAt(url: string, target: string, sha: string | null, ref: string | null): void {
  const options = { timeout: GIT_TIMEOUT_MS, stdio: 'pipe' as const, windowsHide: true };

  if (sha) {
    // Fetching one object rather than cloning the history: the pin is the whole
    // point, and a shallow fetch of exactly it is both smaller and unambiguous.
    mkdirSync(target, { recursive: true });
    execFileSync('git', ['init', '--quiet'], { ...options, cwd: target });
    execFileSync('git', ['remote', 'add', 'origin', url], { ...options, cwd: target });
    execFileSync('git', ['fetch', '--quiet', '--depth', '1', 'origin', sha], { ...options, cwd: target });
    execFileSync('git', ['checkout', '--quiet', 'FETCH_HEAD'], { ...options, cwd: target });
    return;
  }

  execFileSync(
    'git',
    ['clone', '--quiet', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', url, target],
    options
  );
}

/**
 * The revocations a marketplace publishes, if any.
 *
 * A missing file is the ordinary case and means nothing is revoked. A file that
 * will not parse is logged and treated as empty rather than as a reason to fail
 * the marketplace: the catalogue is still readable, and refusing to show it
 * would turn a malformed blocklist into a denial of the whole storefront.
 */
function readBlocklist(root: string): Blocklist | null {
  const text = readFirst(root, BLOCKLIST_PATHS);

  if (text == null) {
    return null;
  }

  const parsed = parseBlocklist(text);

  if (!parsed.ok) {
    logger.warn('marketplace.blocklist_unreadable', { root, error: parsed.error });
    return null;
  }

  return parsed.blocklist;
}

function readFirst(root: string, paths: readonly string[]): string | null {
  for (const relative of paths) {
    const path = join(root, ...relative.split('/'));

    try {
      const text = readFileSync(path, 'utf8');

      if (text.length <= MAX_CATALOG_BYTES) {
        return text;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Resolves a marketplace-relative path and proves it stayed inside.
 *
 * Both sides are realpath-resolved before they are compared, and the root side
 * is the part that is easy to get wrong. A checkout lives under a temporary
 * directory, and on macOS `/var` is a symlink to `/private/var` — so the
 * candidate resolves to `/private/var/…` while an unresolved root is still
 * `/var/…`, and every containment check fails against a path that never left.
 * The symptom is a catalogue entry with a `subdir` refusing to install with
 * "points outside its marketplace", which is both wrong and alarming.
 */
function containedPath(root: string, declared: string): string | null {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null;
  }

  const candidate = resolve(realRoot, declared.replace(/^\.[/\\]/, ''));

  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return null;
  }

  return real === realRoot || real.startsWith(realRoot + sep) ? real : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
