import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

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
   * Every configured marketplace with its catalogue.
   *
   * One failing marketplace produces an error string and no entries; it never
   * decides whether the others resolve. The same discipline the MCP manager
   * uses for servers, for the same reason.
   */
  resolveAll(): ResolvedMarketplace[] {
    return this.listRecords().map((record) => this.resolve(record));
  }

  resolve(record: MarketplaceRecord): ResolvedMarketplace {
    let root: string;

    try {
      root = this.checkout(record);
    } catch (error) {
      return { record, catalog: null, root: null, error: messageOf(error) };
    }

    const found = readCatalog(root);

    if (!found) {
      return {
        record,
        catalog: null,
        root,
        error: `No catalogue. Expected one of: ${MARKETPLACE_CATALOG_PATHS.join(', ')}.`
      };
    }

    const parsed = parseMarketplaceCatalog(found);

    return parsed.ok
      ? { record, catalog: parsed.catalog, root, error: null }
      : { record, catalog: null, root, error: parsed.error };
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

function readCatalog(root: string): string | null {
  for (const relative of MARKETPLACE_CATALOG_PATHS) {
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

/** Resolves a marketplace-relative path and proves it stayed inside. */
function containedPath(root: string, declared: string): string | null {
  const candidate = resolve(root, declared.replace(/^\.[/\\]/, ''));

  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return null;
  }

  return real === root || real.startsWith(root + sep) ? real : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
