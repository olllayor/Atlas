import { cpSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

import { logger } from '../observability/logger';
import { loadPlugin } from './PluginLoader';
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

export type InstallResult = { ok: true; name: string } | { ok: false; error: string };

export class PluginInstaller {
  constructor(private readonly registry: PluginRegistry) {}

  /**
   * Copies a bundle into the plugins directory.
   *
   * Validation happens before the copy so an obviously broken bundle costs
   * nothing, and again afterwards because the thing being validated the first
   * time is not the thing that will be loaded — a source directory can change
   * under a copy, and symlinks resolve differently once relocated.
   */
  install(sourceDir: string): InstallResult {
    const source = loadPlugin(sourceDir);

    if (!source.ok) {
      return { ok: false, error: source.error };
    }

    const name = source.plugin.manifest.name;
    const destination = join(this.registry.root, name);

    if (this.isInstalled(name)) {
      return { ok: false, error: `"${name}" is already installed. Remove it first to reinstall.` };
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
      renameSync(staging, destination);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      return { ok: false, error: `Could not install the plugin: ${messageOf(error)}` };
    }

    this.registry.invalidate();
    logger.info('plugins.installed', { name, version: source.plugin.manifest.version });

    return { ok: true, name };
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

    try {
      rmSync(target, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, error: `Could not remove the plugin: ${messageOf(error)}` };
    }

    this.registry.invalidate();
    logger.info('plugins.uninstalled', { name });

    return { ok: true, name };
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

  private isInstalled(name: string): boolean {
    return this.resolveInstalled(name) != null;
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

/** Bound on the containment walk, so a bundle cannot make installing it expensive. */
const MAX_WALK_ENTRIES = 50_000;

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
