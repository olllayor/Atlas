import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

import { logger } from '../observability/logger';
import { toConnectorDeclaration } from '../../shared/pluginConnectors';
import { loadPlugin } from './PluginLoader';
import type { PluginOrigin, PluginOriginStore } from './PluginOrigins';
import type { PluginRegistry } from './PluginRegistry';

/**
 * Installing and removing bundles.
 *
 * A bundle is third-party code, so the install path is written as if it will be
 * handed a hostile directory: nothing inside it is executed, the manifest is
 * validated twice — once at the source and again at what actually landed — and
 * the bundle only becomes visible to the registry through a single atomic
 * rename. A crash at any point leaves either the old state or the new one,
 * never a directory the loader can see half of.
 */

const STAGING_PREFIX = '.staging-';

export type InstallResult =
  | {
      ok: true;
      name: string;
      version: string;
      /** The version that was overwritten, when this replaced an install. */
      replaced: string | null;
    }
  | { ok: false; error: string };

export type InstallOptions = {
  /**
   * Whether an existing install of the same name may be overwritten.
   *
   * Off by default, and deliberately: a plain install that silently replaced
   * something would be a way to swap out a bundle the user already reviewed.
   * The update path opts in, having decided that the replacement comes from the
   * same catalogue entry the original did.
   */
  replaceExisting?: boolean;
  /**
   * The name the bundle must turn out to have.
   *
   * An update re-fetches a catalogue entry, and an entry is free to have been
   * rewritten since: without this, a catalogue could answer "update `foo`" with
   * a bundle called `bar` and get a second plugin installed rather than the
   * first one replaced.
   */
  expectName?: string;
  /** Provenance to record once the bundle is in place. */
  origin?: Omit<PluginOrigin, 'installedAt' | 'version'>;
};

export class PluginInstaller {
  constructor(
    private readonly registry: PluginRegistry,
    /** Optional so tests can build an installer without a settings store. */
    private readonly origins?: PluginOriginStore
  ) {}

  /**
   * Copies a bundle into the plugins directory.
   *
   * Validation happens before the copy so an obviously broken bundle costs
   * nothing, and again afterwards because the thing being validated the first
   * time is not the thing that will be loaded — a source directory can change
   * under a copy, and symlinks resolve differently once relocated.
   */
  install(sourceDir: string, options: InstallOptions = {}): InstallResult {
    const source = loadPlugin(sourceDir);

    if (!source.ok) {
      return { ok: false, error: source.error };
    }

    const name = source.plugin.manifest.name;

    if (options.expectName && options.expectName !== name) {
      return {
        ok: false,
        error: `This bundle is now called "${name}" rather than "${options.expectName}". Install it as a new plugin if that is what you want.`
      };
    }

    const destination = join(this.registry.root, name);
    const existing = this.resolveInstalled(name);

    if (existing && !options.replaceExisting) {
      return { ok: false, error: `"${name}" is already installed. Remove it first to reinstall.` };
    }

    const replaced = existing ? readInstalledVersion(existing) : null;

    // Scanned before anything is copied, not after: the failure mode this
    // guards is a source that is too large or too confusing to copy safely,
    // and finding that out post-copy means having already spent the disk I/O
    // and the space the check exists to avoid spending.
    const scan = scanBundleForInstall(source.plugin.root);

    if (!scan.ok) {
      return { ok: false, error: scan.error };
    }

    mkdirSync(this.registry.root, { recursive: true });
    const staging = join(this.registry.root, `${STAGING_PREFIX}${randomUUID()}`);

    try {
      // `verbatimSymlinks` keeps link targets exactly as written. Without it
      // Node resolves them during the copy, so a bundle's own relative link
      // like `../pkg/cli.js` is rewritten to an absolute path back into the
      // source directory — which both leaves the installed copy depending on a
      // folder the user may delete, and makes every internal link look like an
      // escape to the check below.
      cpSync(source.plugin.root, staging, { recursive: true, verbatimSymlinks: true });

      // Symlinks are preserved rather than dereferenced, because real bundles
      // depend on them: an npm-installed bundle carries `node_modules/.bin`
      // links, and flattening those breaks it. What is not allowed is a link
      // that leaves the bundle — that is a file the review never covered and
      // whose contents can change afterwards.
      //
      // Checked here rather than relying on `cpSync`'s `dereference` option,
      // which only applies to the top-level source and leaves nested links
      // intact.
      const escape = findEscapingSymlink(staging);

      if (escape) {
        rmSync(staging, { recursive: true, force: true });
        return {
          ok: false,
          error: `The bundle contains a link that points outside itself: ${escape}`
        };
      }

      const staged = loadPlugin(staging);

      if (!staged.ok) {
        rmSync(staging, { recursive: true, force: true });
        return { ok: false, error: staged.error };
      }

      if (staged.plugin.manifest.name !== name) {
        rmSync(staging, { recursive: true, force: true });
        return { ok: false, error: 'The bundle changed while it was being copied.' };
      }

      // The one step that makes the plugin visible. Rename is atomic within a
      // filesystem, and staging is a sibling of the destination so it always
      // is one.
      if (existing) {
        swap(staging, destination, this.registry.root);
      } else {
        renameSync(staging, destination);
      }
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      return { ok: false, error: `Could not install the plugin: ${messageOf(error)}` };
    }

    const version = source.plugin.manifest.version;

    if (options.origin) {
      // Filled here rather than by each caller: this is the one place that has
      // already loaded the bundle, so it is the only place that knows what the
      // installed copy actually declares. A caller passing its own list would
      // be recording what it expected rather than what landed.
      this.origins?.record(name, {
        ...options.origin,
        version,
        connectors: toConnectorDeclaration(
          source.plugin.connectors,
          version,
          new Date().toISOString()
        )
      });
    }

    this.registry.invalidate();
    logger.info(existing ? 'plugins.updated' : 'plugins.installed', { name, version, replaced });

    return { ok: true, name, version, replaced };
  }

  /**
   * Removes an installed bundle.
   *
   * The path is rebuilt from the plugins root and the name rather than taken
   * from the caller, and then proven to still be directly inside that root.
   * This function deletes a directory tree; a name carrying `..` reaching it
   * would be the worst bug in the system.
   */
  uninstall(name: string): InstallResult {
    const target = this.resolveInstalled(name);

    if (!target) {
      return { ok: false, error: `"${name}" is not installed.` };
    }

    const version = readInstalledVersion(target);

    try {
      rmSync(target, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, error: `Could not remove the plugin: ${messageOf(error)}` };
    }

    // Dropped with the bundle, so a later folder install of the same name does
    // not inherit the marketplace this copy came from.
    this.origins?.forget(name.trim());

    this.registry.invalidate();
    logger.info('plugins.uninstalled', { name });

    return { ok: true, name, version: version ?? '', replaced: null };
  }

  /**
   * Deletes staging directories left behind by an interrupted install.
   *
   * Called at startup. Upstream implementations document this and do not do it,
   * which is why a machine surveyed for this work had three abandoned staging
   * directories from a month earlier still on disk.
   */
  sweepStaging(): number {
    let entries;

    try {
      entries = readdirSync(this.registry.root, { withFileTypes: true });
    } catch {
      return 0;
    }

    let swept = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(STAGING_PREFIX)) {
        continue;
      }

      try {
        rmSync(join(this.registry.root, entry.name), { recursive: true, force: true });
        swept += 1;
      } catch {
        // A staging directory that will not delete is worth neither a crash nor
        // a retry loop; the next launch tries again.
      }
    }

    if (swept > 0) {
      logger.info('plugins.staging_swept', { count: swept });
    }

    return swept;
  }

  /** The install directory for a name, or `null` if it is not one. */
  private resolveInstalled(name: string): string | null {
    const trimmed = name.trim();

    // Rejected before it can become a path at all. `resolve` would happily
    // normalise `../../etc` into something outside the root.
    if (!trimmed || trimmed.startsWith('.') || /[/\\]/.test(trimmed)) {
      return null;
    }

    let root: string;
    let target: string;

    try {
      root = realpathSync(this.registry.root);
      target = realpathSync(resolve(root, trimmed));
    } catch {
      return null;
    }

    // The separator matters: without it `/plugins/foo-evil` reads as inside
    // `/plugins/foo`.
    return target.startsWith(root + sep) ? target : null;
  }
}

/**
 * Replaces an installed bundle with a staged one.
 *
 * Two renames, because there is no atomic directory swap: the old bundle is
 * moved aside under the staging prefix, the new one takes its place, and only
 * then is the old one deleted. Every intermediate state is one the system
 * already knows how to survive — a crash between the renames leaves a staging
 * directory the startup sweep collects, and the worst case is the plugin being
 * briefly absent rather than briefly half-written.
 *
 * The retired directory is restored if the second rename fails, so a failure
 * here costs the update rather than the plugin.
 */
function swap(staging: string, destination: string, root: string): void {
  const retired = join(root, `${STAGING_PREFIX}${randomUUID()}`);

  renameSync(destination, retired);

  try {
    renameSync(staging, destination);
  } catch (error) {
    renameSync(retired, destination);
    throw error;
  }

  rmSync(retired, { recursive: true, force: true });
}

/**
 * The version of the bundle at a path, without loading it.
 *
 * Reported so an update can say what it replaced. A bundle whose manifest has
 * become unreadable still gets replaced — that is a reason to update it, not a
 * reason to refuse.
 */
function readInstalledVersion(root: string): string | null {
  const loaded = loadPlugin(root);

  return loaded.ok ? loaded.plugin.manifest.version : null;
}

/** Bound on the containment walk, so a bundle cannot make installing it expensive. */
const MAX_WALK_ENTRIES = 50_000;

/** Ceiling on total bundle size. A plugin is skills and server code, not a dataset. */
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;

/**
 * Refuses a bundle before it is copied: too large, too many entries, or
 * carrying two names that collide once case stops distinguishing them.
 *
 * The case check exists because Atlas cannot assume the source and
 * destination volumes agree about case sensitivity. A source checked out on a
 * case-sensitive filesystem (or an archive extracted from one) can legally
 * contain both `SKILL.md` and `skill.md` as two different files; copied onto
 * the case-insensitive volume most desktop installs use, the second write
 * silently clobbers the first. `cpSync` would not warn — it would just
 * produce a plugin whose bytes on disk depend on directory-iteration order,
 * which is not something a manifest review can have covered. Caught here,
 * before the copy, rather than left to manifest first and confuse whoever
 * reads the review afterwards.
 *
 * Symlinks are walked for entry-count and collision purposes but excluded from
 * the byte total: `cpSync` with `verbatimSymlinks` copies the link itself, not
 * its target's contents, so a link's target size is not what installing this
 * bundle actually costs in bytes. Escape-checking a link is `findEscapingSymlink`'s
 * job, run after the copy on the staged result — this function only bounds the
 * copy itself.
 */
function scanBundleForInstall(
  bundleRoot: string
): { ok: true; totalBytes: number; fileCount: number } | { ok: false; error: string } {
  let root: string;

  try {
    root = realpathSync(bundleRoot);
  } catch (error) {
    return { ok: false, error: `Could not read the plugin: ${messageOf(error)}` };
  }

  const stack = [root];
  let visited = 0;
  let totalBytes = 0;

  while (stack.length > 0) {
    const dir = stack.pop()!;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return { ok: false, error: `Could not read "${relative(root, dir) || '.'}": ${messageOf(error)}` };
    }

    // Scoped to this directory: a name may repeat once per level (every
    // plugin has more than one `SKILL.md`, one per skill folder), so the
    // collision that matters is two entries in the *same* directory, not two
    // anywhere in the tree.
    const lowercaseNames = new Set<string>();

    for (const entry of entries) {
      if ((visited += 1) > MAX_WALK_ENTRIES) {
        return { ok: false, error: `The bundle has more than ${MAX_WALK_ENTRIES} entries.` };
      }

      const lower = entry.name.toLowerCase();

      if (lowercaseNames.has(lower)) {
        return {
          ok: false,
          error:
            `The bundle has two entries that differ only by case in ` +
            `"${relative(root, dir) || '.'}" — installing it would silently keep only one.`
        };
      }

      lowercaseNames.add(lower);

      const path = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let size: number;

      try {
        size = statSync(path).size;
      } catch (error) {
        return { ok: false, error: `Could not read "${relative(root, path)}": ${messageOf(error)}` };
      }

      totalBytes += size;

      if (totalBytes > MAX_BUNDLE_BYTES) {
        return {
          ok: false,
          error: `The bundle is larger than ${Math.floor(MAX_BUNDLE_BYTES / (1024 * 1024))} MB.`
        };
      }
    }
  }

  return { ok: true, totalBytes, fileCount: visited };
}

/**
 * The first symlink in the tree whose target leaves it, as a relative path.
 *
 * Fails closed: an entry that cannot be resolved, and a tree too large to walk,
 * are both reported as escapes. This runs on a directory that is about to
 * become executable content, and "could not check" is not a reason to allow.
 */
function findEscapingSymlink(bundleRoot: string): string | null {
  let root: string;

  try {
    // Resolved first: link targets come back realpath-resolved, and comparing
    // those against an unresolved root reports every link as an escape on any
    // system where a parent directory is itself a link — /var on macOS, for one.
    root = realpathSync(bundleRoot);
  } catch {
    return '.';
  }

  const stack = [root];
  let visited = 0;

  while (stack.length > 0) {
    const dir = stack.pop()!;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return relative(root, dir) || '.';
    }

    for (const entry of entries) {
      if ((visited += 1) > MAX_WALK_ENTRIES) {
        return `more than ${MAX_WALK_ENTRIES} entries`;
      }

      const path = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(path);
        } catch {
          // A dangling link points at nothing today and at whatever is created
          // there tomorrow.
          return relative(root, path);
        }

        if (target !== root && !target.startsWith(root + sep)) {
          return relative(root, path);
        }

        continue;
      }

      if (entry.isDirectory()) {
        stack.push(path);
      }
    }
  }

  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
