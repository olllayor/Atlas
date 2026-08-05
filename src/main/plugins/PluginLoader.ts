import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { isValidMcpCommand } from '../../shared/mcp';
import type { PluginManifest, PluginMcpServerDecl } from '../../shared/plugins';
import {
  EMPTY_SKILL_SIDECAR,
  PLUGIN_MANIFEST_DIRS,
  PLUGIN_MANIFEST_FILENAME,
  parsePluginManifest,
  parsePluginMcpServers,
  parseSkillMarkdown,
  parseSkillSidecar,
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
  /**
   * MCP servers this skill declares a need for, by server key.
   *
   * Rare — two of 147 sidecars on the surveyed machine use it — but it is the
   * only way a skill can reach a server in a different plugin, so it is the
   * cross-plugin half of activation.
   */
  requiredServers: string[];
  /** Absolute path of the `SKILL.md`. The body is read from here on demand. */
  path: string;
};

/**
 * A bundle-declared MCP server with its paths made real.
 *
 * `command` and `cwd` are absolute here. A bundle may ship its own executable
 * and name it `./bin/server`, which means nothing until it is resolved against
 * the bundle root and proven to still be inside it.
 */
export type LoadedMcpServer = PluginMcpServerDecl & {
  /** Absolute when the bundle shipped the binary, unchanged when it names one on PATH. */
  command: string | null;
  cwd: string | null;
};

export type LoadedPlugin = {
  /** Absolute, realpath-resolved bundle root. */
  root: string;
  manifest: PluginManifest;
  skills: LoadedSkill[];
  mcpServers: LoadedMcpServer[];
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
  const mcpServers = discoverMcpServers(root, parsed.manifest, warnings);

  return { ok: true, plugin: { root, manifest: parsed.manifest, skills, mcpServers, warnings } };
}

/**
 * The bundle's MCP servers, with bundle-relative paths resolved.
 *
 * A malformed `.mcp.json` costs the bundle its servers and nothing else: a
 * plugin is usually mostly skills, and refusing to load 40 working skills
 * because one server entry is wrong would be the wrong trade.
 */
function discoverMcpServers(
  root: string,
  manifest: PluginManifest,
  warnings: string[]
): LoadedMcpServer[] {
  const servers: LoadedMcpServer[] = [];
  const seen = new Set<string>();

  for (const declared of pluginComponentPaths(manifest, 'mcpServers')) {
    const file = containedPath(root, declared);

    if (!file) {
      if (manifest.paths.mcpServers === declared) {
        warnings.push(`The MCP configuration "${declared}" is missing or points outside the plugin.`);
      }
      continue;
    }

    const text = readCapped(file, 256 * 1024);

    if (text == null) {
      continue;
    }

    const parsed = parsePluginMcpServers(text);

    if (!parsed.ok) {
      warnings.push(`Ignored ${declared}: ${parsed.error}`);
      continue;
    }

    for (const decl of parsed.servers) {
      if (seen.has(decl.key)) {
        continue;
      }

      const resolved = resolveServerPaths(root, decl, warnings);

      if (resolved) {
        seen.add(decl.key);
        servers.push(resolved);
      }
    }
  }

  return servers;
}

function resolveServerPaths(
  root: string,
  decl: PluginMcpServerDecl,
  warnings: string[]
): LoadedMcpServer | null {
  const declaredCwd = decl.cwd ? containedPath(root, decl.cwd) : null;

  if (decl.cwd && !declaredCwd) {
    warnings.push(`Skipped the MCP server "${decl.key}": its working directory is not inside the plugin.`);
    return null;
  }

  // A bundle that declares no working directory still means its own. Real
  // bundles ship entries like `node ./cli/mcp-server-wrapper.js` with no `cwd`,
  // and those relative arguments are written against the bundle root — resolved
  // against Atlas's own working directory they name nothing. A server that
  // needs to see the user's project takes a path as an argument; none of them
  // rely on inheriting our cwd.
  const cwd = declaredCwd ?? root;

  if (decl.transport === 'http' || !decl.command) {
    // Nothing is spawned for HTTP, so a working directory would be a fiction.
    return { ...decl, command: null, cwd: declaredCwd };
  }

  // A command with a separator names a file the bundle ships; a bare name is
  // resolved through PATH by the OS and is not this function's business.
  if (!/[/\\]/.test(decl.command)) {
    if (!isValidMcpCommand(decl.command)) {
      warnings.push(`Skipped the MCP server "${decl.key}": "${decl.command}" is not a usable command.`);
      return null;
    }

    return { ...decl, cwd };
  }

  const command = containedPath(root, decl.command);

  if (!command) {
    // The lexical check in `shared/plugins.ts` already rejected `../`. Landing
    // here means a symlink pointed out of the bundle, or the file is absent.
    warnings.push(`Skipped the MCP server "${decl.key}": "${decl.command}" is missing or outside the plugin.`);
    return null;
  }

  return { ...decl, command, cwd };
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
      // The sidecar sits beside the skill and is the spelling 20 real skills
      // use to opt out of implicit invocation; the frontmatter flag is the
      // other. Read together so neither is silently ignored.
      const sidecarText = readCapped(join(dir, entry.name, 'agents', 'openai.yaml'), 64 * 1024);
      const sidecar = sidecarText ? parseSkillSidecar(sidecarText) : EMPTY_SKILL_SIDECAR;

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
        // The sidecar wins when it speaks, because it is the more specific
        // file; silence there leaves the frontmatter's answer standing.
        implicitInvocation: sidecar.implicitInvocation ?? parsed.skill.implicitInvocation,
        requiredServers: sidecar.requiredServers,
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
