import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { PluginManifest, PluginSkill } from '../../shared/plugins';
import {
  PLUGIN_MANIFEST_DIRS,
  PLUGIN_MANIFEST_FILENAME,
  parsePluginManifest,
  parseSkillMarkdown,
  pluginComponentPaths
} from '../../shared/plugins';

/**
 * Reading plugin bundles off disk.
 *
 * `shared/plugins.ts` decides what a manifest *means*; this decides what is
 * actually there. The split matters because the renderer imports the former and
 * has no filesystem, and because every check that needs a real path — symlink
 * containment above all — can only happen here.
 *
 * Nothing in this module throws for a bad bundle. Plugins load as a set, and a
 * malformed one contributes an error record rather than deciding whether the
 * others load.
 */

/** Per-file cap when indexing. Frontmatter lives at the top; bodies do not. */
const SKILL_INDEX_PREFIX_BYTES = 8 * 1024;

/** Per-file cap when a skill is actually opened, matching the AGENTS.md budget. */
export const SKILL_BODY_MAX_BYTES = 32 * 1024;

/** Bounds on the skills scan, so a bundle cannot turn discovery into a walk. */
const MAX_SKILLS_PER_PLUGIN = 256;

export type LoadedSkill = {
  /** `<plugin>:<skill>`, the name the model and the UI both use. */
  qualifiedName: string;
  pluginName: string;
  name: string;
  description: string;
  implicitInvocation: boolean;
  /** Absolute path of the `SKILL.md`. The body is read from here on demand. */
  path: string;
};

export type LoadedPlugin = {
  /** Absolute, realpath-resolved bundle root. */
  root: string;
  manifest: PluginManifest;
  skills: LoadedSkill[];
  /**
   * Non-fatal problems found while loading.
   *
   * A skill with no description and a skills directory that does not exist are
   * both normal enough that they must not cost the plugin its other components,
   * but both are worth showing in the UI rather than swallowing.
   */
  warnings: string[];
};

export type PluginLoadResult =
  | { ok: true; plugin: LoadedPlugin }
  | { ok: false; root: string; error: string };

/**
 * Loads one bundle.
 *
 * Component discovery is deliberately shallow: skills are indexed by their
 * frontmatter only, and no body is read. A bundle carrying fifty skills costs
 * fifty bounded prefix reads here and nothing in the model's context until one
 * is actually chosen.
 */
export function loadPlugin(bundleRoot: string): PluginLoadResult {
  let root: string;

  try {
    // Resolved once, up front: every containment check below compares against
    // this, and comparing against an unresolved path would let a symlinked
    // bundle root make its own contents look external.
    root = realpathSync(resolve(bundleRoot));
  } catch (error) {
    return { ok: false, root: bundleRoot, error: `Could not read the plugin: ${messageOf(error)}` };
  }

  const found = findManifest(root);

  if (!found) {
    return {
      ok: false,
      root,
      error: `No plugin manifest. Expected ${PLUGIN_MANIFEST_FILENAME} in one of: ${PLUGIN_MANIFEST_DIRS.join(', ')}.`
    };
  }

  const parsed = parsePluginManifest(found.text);

  if (!parsed.ok) {
    return { ok: false, root, error: parsed.error };
  }

  const warnings: string[] = [];
  const skills = discoverSkills(root, parsed.manifest, warnings);

  return { ok: true, plugin: { root, manifest: parsed.manifest, skills, warnings } };
}

/** The first manifest among the vendor conventions, in precedence order. */
function findManifest(root: string): { dir: string; text: string } | null {
  for (const dir of PLUGIN_MANIFEST_DIRS) {
    const text = readCapped(join(root, dir, PLUGIN_MANIFEST_FILENAME), 256 * 1024);

    if (text != null) {
      return { dir, text };
    }
  }

  return null;
}

/**
 * Every skill the bundle offers, as index entries.
 *
 * Each declared and conventional skills directory is scanned for
 * `<name>/SKILL.md`. A duplicate skill name within one plugin keeps the first
 * seen — the directories are probed in a fixed order, so which one wins is
 * stable across runs rather than dependent on readdir order.
 */
function discoverSkills(
  root: string,
  manifest: PluginManifest,
  warnings: string[]
): LoadedSkill[] {
  const skills: LoadedSkill[] = [];
  const seen = new Set<string>();

  for (const declared of pluginComponentPaths(manifest, 'skills')) {
    const dir = containedPath(root, declared);

    if (!dir) {
      // Only worth a warning when the author asked for it. A missing default
      // directory is the ordinary case for a bundle that ships no skills.
      if (manifest.paths.skills === declared) {
        warnings.push(`The skills path "${declared}" is missing or points outside the plugin.`);
      }
      continue;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (skills.length >= MAX_SKILLS_PER_PLUGIN) {
        warnings.push(`Only the first ${MAX_SKILLS_PER_PLUGIN} skills were loaded.`);
        return skills;
      }

      // `isDirectory()` is false for a symlink, which is the point: a linked
      // skill directory is how a bundle would reach outside itself.
      if (!entry.isDirectory()) {
        continue;
      }

      const path = join(dir, entry.name, 'SKILL.md');

      // A bounded prefix, not the file: the frontmatter is at the top, and the
      // body is what this phase exists to avoid reading.
      const prefix = readCapped(path, SKILL_INDEX_PREFIX_BYTES);

      if (prefix == null) {
        continue;
      }

      const parsed = parseSkillMarkdown(prefix);

      if (!parsed.ok) {
        warnings.push(`Skipped "${entry.name}": ${parsed.error}`);
        continue;
      }

      if (seen.has(parsed.skill.name)) {
        warnings.push(`Skipped a second skill named "${parsed.skill.name}".`);
        continue;
      }

      seen.add(parsed.skill.name);
      skills.push({
        qualifiedName: `${manifest.name}:${parsed.skill.name}`,
        pluginName: manifest.name,
        name: parsed.skill.name,
        description: parsed.skill.description,
        implicitInvocation: parsed.skill.implicitInvocation,
        path
      });
    }
  }

  return skills;
}

/**
 * A skill's body, read when the model actually asks for it.
 *
 * Re-parsed rather than trusted from the index: the file may have changed since
 * discovery, and the frontmatter is what says where the body begins.
 */
export function readSkillBody(skill: LoadedSkill): string | null {
  const text = readCapped(skill.path, SKILL_BODY_MAX_BYTES);

  if (text == null) {
    return null;
  }

  const parsed = parseSkillMarkdown(text);
  return parsed.ok ? parsed.skill.body : null;
}

/**
 * Resolves a bundle-relative path and proves it is still inside the bundle.
 *
 * The lexical check in `shared/plugins.ts` already rejected `..` and absolute
 * paths. This is the half that needs a filesystem: `./skills` may be a symlink
 * to `/etc`, which no amount of string inspection can see.
 */
function containedPath(root: string, declared: string): string | null {
  const candidate = resolve(root, declared.replace(/^\.[/\\]/, ''));

  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return null;
  }

  // The separator matters: without it `/plugins/foo-evil` reads as inside
  // `/plugins/foo`.
  return real === root || real.startsWith(root + sep) ? real : null;
}

/**
 * Reads at most `budget` bytes, and never through `readFileSync`.
 *
 * The same reasoning as `AgentInstructions.readCapped`, for the same reason: a
 * plugin file may be a symlink to anything at all — a multi-gigabyte file, a
 * FIFO that never ends — and an explicit descriptor with a bounded `readSync`
 * cannot stall on one the way slurping the whole file could.
 */
function readCapped(path: string, budget: number): string | null {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }

  if (!stat.isFile()) {
    return null;
  }

  const buffer = Buffer.allocUnsafe(budget);
  let bytesRead: number;
  let fd: number | null = null;

  try {
    fd = openSync(path, 'r');
    bytesRead = readSync(fd, buffer, 0, budget, 0);
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        // Nothing useful to do with a failed close.
      }
    }
  }

  // Cutting at a byte offset can land inside a multibyte sequence, which
  // decodes to replacement characters the author never wrote.
  return buffer.subarray(0, bytesRead).toString('utf8').replace(/�+$/u, '');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
