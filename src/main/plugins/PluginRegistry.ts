import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { logger } from '../observability/logger';
import type { LoadedPlugin } from './PluginLoader';
import { loadPlugin } from './PluginLoader';

/**
 * What is installed.
 *
 * One scan feeds every component type — skills today, MCP servers beside them,
 * apps and hooks later — so a bundle is read once per interval rather than once
 * per consumer. Synchronous and cached for the same reason
 * `AgentInstructionsService` is: this is read on the turn-setup path and again
 * inside `measureContextUsage`, and those two must agree.
 */

/** How long a scan is trusted. A newly dropped bundle appears within this. */
const SCAN_TTL_MS = 5_000;

export type PluginFailure = { root: string; error: string };

export type PluginSnapshot = {
  /**
   * Bundles that are installed *and* enabled.
   *
   * Only enabled plugins are here, so a consumer cannot contribute a disabled
   * plugin's tools by forgetting to filter. Turning a plugin off has to mean
   * off everywhere, and the safe default belongs at the source.
   */
  plugins: LoadedPlugin[];
  /** Installed but switched off. Shown in settings, used nowhere else. */
  disabled: LoadedPlugin[];
  /** Bundles that could not be loaded, for the settings UI. */
  failures: PluginFailure[];
};

const EMPTY: PluginSnapshot = { plugins: [], disabled: [], failures: [] };

export class PluginRegistry {
  readonly root: string;
  private cache: { at: number; snapshot: PluginSnapshot } | null = null;

  constructor(options?: {
    root?: string;
    now?: () => number;
    /** Consulted on every scan, so a toggle applies without a restart. */
    isEnabled?: (name: string) => boolean;
  }) {
    // `~/.atlas`, not `~/.codex` or `~/.claude`. The same reasoning
    // `AgentInstructionsService` gives for instructions applies harder here:
    // those directories hold executable bundles installed for a different
    // agent, and adopting them silently would be running code the user
    // authorised somewhere else.
    this.root = options?.root ?? join(homedir(), '.atlas', 'plugins');
    this.now = options?.now ?? (() => Date.now());
    this.isEnabled = options?.isEnabled ?? (() => true);
  }

  private readonly now: () => number;
  private readonly isEnabled: (name: string) => boolean;

  /**
   * Rescans on a short interval rather than watching.
   *
   * A watcher would be a second source of truth about what is installed, and
   * the scan is cheap by construction: one bounded manifest read per bundle and
   * one bounded 8 KiB prefix per skill, with no skill body read at all.
   */
  snapshot(): PluginSnapshot {
    const now = this.now();

    if (this.cache && now - this.cache.at < SCAN_TTL_MS) {
      return this.cache.snapshot;
    }

    const snapshot = this.scan();
    this.cache = { at: now, snapshot };
    return snapshot;
  }

  /** Drops the cache. Used after an install and by tests. */
  invalidate() {
    this.cache = null;
  }

  private scan(): PluginSnapshot {
    let entries;

    try {
      entries = readdirSync(this.root, { withFileTypes: true });
    } catch {
      // No plugins directory is the ordinary state, not an error.
      return EMPTY;
    }

    const plugins: LoadedPlugin[] = [];
    const disabled: LoadedPlugin[] = [];
    const failures: PluginFailure[] = [];
    const claimed = new Set<string>();

    for (const entry of entries) {
      // `isDirectory()` is false for a symlink, and that is the point: the
      // plugins directory is a trust boundary, and a link is how something
      // outside it would get in. Dot-directories are skipped because installers
      // leave staging leftovers like `.staging-<uuid>` behind.
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      const result = loadPlugin(join(this.root, entry.name));

      if (!result.ok) {
        failures.push({ root: result.root, error: result.error });
        continue;
      }

      // Two bundles claiming one name would produce colliding qualified skill
      // and server names. First wins, and the loser is reported rather than
      // dropped silently — a component that never loads is the hardest kind to
      // debug.
      if (claimed.has(result.plugin.manifest.name)) {
        failures.push({
          root: result.plugin.root,
          error: `Another installed plugin is already called "${result.plugin.manifest.name}".`
        });
        continue;
      }

      claimed.add(result.plugin.manifest.name);
      (this.isEnabled(result.plugin.manifest.name) ? plugins : disabled).push(result.plugin);
    }

    if (failures.length > 0) {
      logger.warn('plugins.load_failed', { count: failures.length, first: failures[0]?.error });
    }

    return { plugins, disabled, failures };
  }
}
