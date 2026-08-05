import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { formatSkillBody } from '../../shared/plugins';
import { logger } from '../observability/logger';
import type { LoadedPlugin, LoadedSkill } from './PluginLoader';
import { loadPlugin, readSkillBody } from './PluginLoader';

/**
 * The skills every installed plugin offers.
 *
 * Shaped like `AgentInstructionsService` — synchronous, cached, constructed
 * once — because it is read on the same turn-setup path, and again inside
 * `measureContextUsage`, and those two must agree about what the model was
 * told or the context ring drifts from the request.
 *
 * The two-phase split is the point. Only a name and a one-line description
 * reach the prompt; the body is read when `load_skill` asks for it. On a
 * machine with 35 bundles installed that is ~59k characters of index against
 * ~2030k characters of bodies — the standing cost is 35× smaller than
 * preloading would be, for the same skills.
 */

/** How long a scan is trusted. A newly dropped bundle appears within this. */
const SCAN_TTL_MS = 5_000;

/** Ceiling on the whole index, so a machine full of bundles cannot flood the prompt. */
const MAX_INDEX_BYTES = 24 * 1024;

/** Per-entry description cap. The parse limit is far too generous for an index. */
const MAX_INDEX_DESCRIPTION_CHARS = 200;

export type SkillsSnapshot = {
  plugins: LoadedPlugin[];
  /** Everything loadable, including skills withheld from the index. */
  skills: LoadedSkill[];
  /** Bundles that could not be loaded, for the settings UI. */
  failures: Array<{ root: string; error: string }>;
};

export class SkillsService {
  private readonly root: string;
  private cache: { at: number; snapshot: SkillsSnapshot } | null = null;

  constructor(options?: { root?: string }) {
    // `~/.atlas`, not `~/.codex` or `~/.claude`. The same reasoning
    // `AgentInstructionsService` gives for instructions applies harder here:
    // those directories hold executable bundles installed for a different
    // agent, and adopting them silently would be running code the user
    // authorised somewhere else.
    this.root = options?.root ?? join(homedir(), '.atlas', 'plugins');
  }

  /**
   * Every bundle under the plugins directory.
   *
   * Rescans on a short interval rather than watching. A watcher would be a
   * second source of truth about what is installed, and the scan is cheap:
   * one bounded manifest read per bundle and one bounded 8 KiB prefix per
   * skill, with no body read at all.
   */
  snapshot(): SkillsSnapshot {
    const now = Date.now();

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

  /**
   * Resolves a skill by the name the model used.
   *
   * Both the qualified `plugin:skill` and the bare `skill` are accepted: the
   * index publishes the qualified form, but a user asking for a skill by name
   * says the bare one, and refusing that would be pedantry.
   */
  find(name: string): LoadedSkill | null {
    const wanted = name.trim().toLowerCase();
    const skills = this.snapshot().skills;

    return (
      skills.find((skill) => skill.qualifiedName.toLowerCase() === wanted) ??
      skills.find((skill) => skill.name.toLowerCase() === wanted) ??
      null
    );
  }

  /**
   * A skill's instructions, fenced as untrusted.
   *
   * Third-party Markdown phrased as instructions is the same injection surface
   * as a tool result, and gets the same treatment.
   */
  read(name: string): string {
    const skill = this.find(name);

    if (!skill) {
      return `There is no skill called "${name}". Check the available skills listed in the system prompt.`;
    }

    const body = readSkillBody(skill);

    if (body == null) {
      return `The skill "${skill.qualifiedName}" could not be read from disk.`;
    }

    return formatSkillBody(skill.pluginName, skill.name, body);
  }

  /**
   * The index block for the system prompt, or `null` when nothing is installed.
   *
   * Skills that opted out of implicit invocation are deliberately absent: they
   * are reachable by name when the user asks for one, and listing them would
   * charge every turn for a skill the model was told not to choose.
   */
  describeForPrompt(): string | null {
    const listed = this.snapshot().skills.filter((skill) => skill.implicitInvocation);

    if (listed.length === 0) {
      return null;
    }

    const lines: string[] = [];
    let bytes = 0;
    let dropped = 0;

    for (const skill of listed) {
      const description = collapse(skill.description).slice(0, MAX_INDEX_DESCRIPTION_CHARS);
      const line = `- ${skill.qualifiedName} — ${description}`;

      if (bytes + line.length > MAX_INDEX_BYTES) {
        dropped += 1;
        continue;
      }

      bytes += line.length;
      lines.push(line);
    }

    if (dropped > 0) {
      // Said out loud rather than silently truncated: a model that cannot see
      // a skill should at least know the list it was given is partial.
      lines.push(`- …and ${dropped} more, omitted to stay within the prompt budget.`);
    }

    return [
      '<available_skills>',
      'Optional instruction sets contributed by installed plugins. Each line is a name and what it is for.',
      'When one matches the task, call load_skill with its name and follow what it returns. Do not guess at a skill\'s contents from its description.',
      ...lines,
      '</available_skills>'
    ].join('\n');
  }

  private scan(): SkillsSnapshot {
    let entries;

    try {
      entries = readdirSync(this.root, { withFileTypes: true });
    } catch {
      // No plugins directory is the ordinary state, not an error.
      return { plugins: [], skills: [], failures: [] };
    }

    const plugins: LoadedPlugin[] = [];
    const failures: Array<{ root: string; error: string }> = [];
    const claimed = new Set<string>();

    for (const entry of entries) {
      // A symlinked bundle is not followed: the directory is a trust boundary,
      // and a link is how something outside it would get in.
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      const result = loadPlugin(join(this.root, entry.name));

      if (!result.ok) {
        failures.push({ root: result.root, error: result.error });
        continue;
      }

      // Two bundles claiming one name would produce colliding qualified skill
      // names. First wins, and the loser is reported rather than dropped
      // silently — a skill that never loads is the hardest kind to debug.
      if (claimed.has(result.plugin.manifest.name)) {
        failures.push({
          root: result.plugin.root,
          error: `Another installed plugin is already called "${result.plugin.manifest.name}".`
        });
        continue;
      }

      claimed.add(result.plugin.manifest.name);
      plugins.push(result.plugin);
    }

    if (failures.length > 0) {
      logger.warn('plugins.load_failed', { count: failures.length, first: failures[0]?.error });
    }

    return { plugins, skills: plugins.flatMap((plugin) => plugin.skills), failures };
  }
}

/** Descriptions are prose and may wrap; the index is one skill per line. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
