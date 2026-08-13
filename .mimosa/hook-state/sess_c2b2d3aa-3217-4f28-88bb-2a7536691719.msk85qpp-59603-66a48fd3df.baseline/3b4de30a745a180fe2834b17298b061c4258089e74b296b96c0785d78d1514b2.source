import { closeSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { pluginDataDir } from './atlasPaths';

import { isValidMcpCommand } from '../../shared/mcp';
import type { PluginConnector } from '../../shared/pluginConnectors';
import { parsePluginConnectors } from '../../shared/pluginConnectors';
import type {
  PluginManifest,
  PluginManifestFormat,
  PluginMcpServerDecl
} from '../../shared/plugins';
import {
  AGENT_PLUGIN_MANIFEST_DIR,
  EMPTY_SKILL_SIDECAR,
  PLUGIN_MANIFEST_DIRS,
  PLUGIN_MANIFEST_FILENAME,
  describeSchemaSupport,
  expandPluginVariables,
  isAgentSkillName,
  parseCommandMarkdown,
  parsePluginManifest,
  parsePluginMcpServers,
  parseSkillMarkdown,
  parseSkillSidecar,
  pluginComponentPaths,
  satisfiesMinVersion
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

/** The same bound for commands, which are one file each rather than a directory. */
const MAX_COMMANDS_PER_PLUGIN = 256;

/**
 * Per-file cap when a command is opened.
 *
 * Smaller than a skill's budget on purpose: a command body becomes a message in
 * the composer, and a template larger than this is not something a person is
 * going to read before sending.
 */
export const COMMAND_BODY_MAX_BYTES = 16 * 1024;

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
  /** Agent Skills metadata, carried for display. See `PluginSkill`. */
  license: string | null;
  compatibility: string | null;
  /** What the skill asked to have pre-approved. Recorded, never honoured. */
  allowedTools: string[];
  /** Absolute path of the `SKILL.md`. The body is read from here on demand. */
  path: string;
};

export type LoadedCommand = {
  /** `<plugin>:<command>`, so two bundles may both ship a `review`. */
  qualifiedName: string;
  pluginName: string;
  name: string;
  description: string;
  argumentHint: string;
  /** Absolute path of the `.md`. The body is read from here on demand. */
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
  commands: LoadedCommand[];
  mcpServers: LoadedMcpServer[];
  /**
   * Declared OAuth connectors, read for display and never acted on.
   *
   * Atlas has no connector broker: these are shown marked unavailable, and a
   * bundle whose *only* component is a connector is still refused at install by
   * `readPluginCapability` — installing one is a no-op the user pays for.
   */
  connectors: PluginConnector[];
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
export function loadPlugin(bundleRoot: string, appVersion?: string): PluginLoadResult {
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

  const parsed = parsePluginManifest(found.text, found.format);

  if (!parsed.ok) {
    return { ok: false, root, error: parsed.error };
  }

  const required = parsed.manifest.atlas.minAppVersion;

  if (appVersion && !satisfiesMinVersion(appVersion, required)) {
    // Refused rather than half-loaded: a bundle written against a newer
    // manifest would otherwise lose exactly the parts its author cared about,
    // without anything saying so.
    return {
      ok: false,
      root,
      error: `"${parsed.manifest.name}" needs Atlas ${required} or newer. This is ${appVersion}.`
    };
  }

  const warnings: string[] = [];

  // Reported, never fatal. The Agent Plugins schema is closed, but the spec is
  // explicit that unknown fields "must be reported and ignored by clients, but
  // do not invalidate the plugin" — a bundle written against a later draft
  // should still load everything this build understands.
  const schemaProblem = describeSchemaSupport(parsed.manifest.schema);

  if (schemaProblem) {
    warnings.push(schemaProblem);
  }

  // Only for the standard, whose schema is closed and whose spec asks for the
  // report. The vendor conventions have no closed schema at all: 20 of 45
  // surveyed bundles carry `strict`, `agents` or `bundledContentVariant`, and
  // warning about those would put a complaint on nearly every legacy row for
  // fields their own format considers ordinary.
  if (parsed.manifest.format === 'agent-plugins' && parsed.manifest.unknownKeys.length > 0) {
    warnings.push(`Ignored unrecognised manifest fields: ${parsed.manifest.unknownKeys.join(', ')}.`);
  }

  const skills = discoverSkills(root, parsed.manifest, warnings);
  const commands = discoverCommands(root, parsed.manifest, warnings);
  const mcpServers = discoverMcpServers(root, parsed.manifest, warnings);
  const connectors = discoverConnectors(root, parsed.manifest, warnings);

  return {
    ok: true,
    plugin: { root, manifest: parsed.manifest, skills, commands, mcpServers, connectors, warnings }
  };
}

/**
 * The bundle's connector declarations.
 *
 * Read so they can be *shown*, never so they can be used. Atlas has no
 * connector broker, so every one of these ends up on screen marked
 * unavailable — but a browser that stayed silent would describe 85% of the
 * official catalogue as offering nothing, when the truth is that they offer
 * something Atlas cannot yet perform.
 */
function discoverConnectors(
  root: string,
  manifest: PluginManifest,
  warnings: string[]
): PluginConnector[] {
  const connectors: PluginConnector[] = [];
  const seen = new Set<string>();

  for (const declared of pluginComponentPaths(manifest, 'apps')) {
    const file = containedPath(root, declared);

    if (!file) {
      continue;
    }

    const text = readCapped(file, 256 * 1024);

    if (text == null) {
      continue;
    }

    const parsed = parsePluginConnectors(text);

    if (!parsed.ok) {
      warnings.push(`Ignored ${declared}: ${parsed.error}`);
      continue;
    }

    for (const connector of parsed.connectors) {
      if (!seen.has(connector.key)) {
        seen.add(connector.key);
        connectors.push(connector);
      }
    }
  }

  return connectors;
}

/**
 * Every command the bundle offers, as index entries.
 *
 * One `.md` per command, flat. Nested directories are skipped rather than
 * walked: the namespaced `commands/sub/name.md` spelling exists elsewhere, but
 * flattening it here would let two files collide on one name, and walking it
 * would turn discovery into a tree scan for a shape no surveyed bundle uses.
 */
function discoverCommands(
  root: string,
  manifest: PluginManifest,
  warnings: string[]
): LoadedCommand[] {
  const commands: LoadedCommand[] = [];
  const seen = new Set<string>();

  for (const declared of pluginComponentPaths(manifest, 'commands')) {
    const dir = containedPath(root, declared);

    if (!dir) {
      if (manifest.paths.commands === declared) {
        warnings.push(`The commands path "${declared}" is missing or points outside the plugin.`);
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
      if (commands.length >= MAX_COMMANDS_PER_PLUGIN) {
        warnings.push(`Only the first ${MAX_COMMANDS_PER_PLUGIN} commands were loaded.`);
        return commands;
      }

      // `isFile()` is false for a symlink, which is the point: a linked command
      // is how a bundle would serve text from outside itself.
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
        continue;
      }

      const path = join(dir, entry.name);
      // Read whole rather than by prefix: unlike a skill, the body is the
      // command, and it is capped small enough that a second read on use would
      // be the more expensive choice.
      const text = readCapped(path, COMMAND_BODY_MAX_BYTES);

      if (text == null) {
        continue;
      }

      const parsed = parseCommandMarkdown(text, entry.name.slice(0, -3));

      if (!parsed.ok) {
        warnings.push(`Skipped the command "${entry.name}": ${parsed.error}`);
        continue;
      }

      if (seen.has(parsed.command.name)) {
        warnings.push(`Skipped a second command named "${parsed.command.name}".`);
        continue;
      }

      seen.add(parsed.command.name);
      commands.push({
        qualifiedName: `${manifest.name}:${parsed.command.name}`,
        pluginName: manifest.name,
        name: parsed.command.name,
        description: parsed.command.description,
        argumentHint: parsed.command.argumentHint,
        path
      });
    }
  }

  return commands;
}

/**
 * A command's body, read when the user actually picks it.
 *
 * Re-parsed rather than trusted from the index, like `readSkillBody`: the file
 * may have changed since discovery, and the frontmatter is what says where the
 * body begins.
 */
export function readCommandBody(command: LoadedCommand): string | null {
  const text = readCapped(command.path, COMMAND_BODY_MAX_BYTES);

  if (text == null) {
    return null;
  }

  const parsed = parseCommandMarkdown(text, command.name);

  return parsed.ok ? parsed.command.body : null;
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

    warnings.push(...parsed.warnings);

    for (const decl of parsed.servers) {
      if (seen.has(decl.key)) {
        continue;
      }

      const resolved = resolveServerPaths(root, pluginDataDir(manifest.name), decl, warnings);

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
  dataDir: string,
  decl: PluginMcpServerDecl,
  warnings: string[]
): LoadedMcpServer | null {
  const roots = { pluginRoot: root, pluginData: dataDir };

  // Expanded before anything is resolved, because the spec defines expansion as
  // a textual pass over the *configured* values and containment as a check on
  // the result. Checking first and expanding second would validate a string
  // nobody ever runs.
  const args = decl.args.map((arg) => expandPluginVariables(arg, roots));
  const env = Object.fromEntries(
    Object.entries(decl.env).map(([key, value]) => [key, expandPluginVariables(value, roots)])
  );

  const expanded = { ...decl, args, env };
  const declaredCwd = decl.cwd ? resolveCwd(root, dataDir, decl.cwd) : null;

  if (decl.cwd && !declaredCwd) {
    warnings.push(`Skipped the MCP server "${decl.key}": its working directory is not inside the plugin.`);
    return null;
  }

  decl = expanded;

  // A bundle that declares no working directory still means its own. Real
  // bundles ship entries like `node ./cli/mcp-server-wrapper.js` with no `cwd`,
  // and those relative arguments are written against the bundle root — resolved
  // against Atlas's own working directory they name nothing. A server that
  // needs to see the user's project takes a path as an argument; none of them
  // rely on inheriting our cwd.
  const cwd = declaredCwd ?? root;

  if (decl.transport === 'http' || decl.transport === 'sse' || !decl.command) {
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

export { pluginDataDir } from './atlasPaths';

/**
 * Ensures a plugin's data directory exists and is writable.
 *
 * Called at spawn time rather than at load time: creating a directory for every
 * installed bundle on every five-second rescan would be filesystem work for
 * plugins that never run. The spec's requirement is that it exist *before* the
 * subprocess launches, which is exactly here.
 */
export function ensurePluginDataDir(pluginName: string): string {
  const dir = pluginDataDir(pluginName);

  mkdirSync(dir, { recursive: true });

  return dir;
}

/**
 * A declared `cwd`, resolved and proven contained.
 *
 * Two roots, because the spec allows two: `${PLUGIN_ROOT}` forms stay inside the
 * bundle, `${PLUGIN_DATA}` forms inside the client-managed directory. A path
 * that escapes whichever root it named is refused — the placeholder chooses the
 * base, it does not waive the check.
 */
function resolveCwd(root: string, dataDir: string, declared: string): string | null {
  const dataMatch = /^\$\{PLUGIN_DATA\}(?:\/(.*))?$/.exec(declared);

  if (dataMatch) {
    // Created eagerly here: `containedPath` resolves with `realpath`, which
    // cannot answer for a directory that does not exist yet.
    mkdirSync(dataDir, { recursive: true });

    return dataMatch[1] ? containedPath(dataDir, `./${dataMatch[1]}`) : containedPath(dataDir, '.');
  }

  const rootMatch = /^\$\{PLUGIN_ROOT\}(?:\/(.*))?$/.exec(declared);

  if (rootMatch) {
    return rootMatch[1] ? containedPath(root, `./${rootMatch[1]}`) : root;
  }

  return containedPath(root, declared);
}

/**
 * The bundle's manifest, and which convention it was found under.
 *
 * The root is probed **first**. A bundle shipping `plugin.json` at its root is
 * an Agent Plugins bundle — that location is the standard's, and it is the one
 * spelling no vendor convention uses — so finding one there settles the format
 * before any of the dot-directories are considered. A bundle carrying both is
 * saying "read me as the standard, and here is a fallback for older clients".
 */
function findManifest(root: string): { dir: string; format: PluginManifestFormat; text: string } | null {
  const rootText = readCapped(join(root, PLUGIN_MANIFEST_FILENAME), 256 * 1024);

  if (rootText != null) {
    return { dir: AGENT_PLUGIN_MANIFEST_DIR, format: 'agent-plugins', text: rootText };
  }

  for (const dir of PLUGIN_MANIFEST_DIRS) {
    const text = readCapped(join(root, dir, PLUGIN_MANIFEST_FILENAME), 256 * 1024);

    if (text != null) {
      return { dir, format: 'vendor', text };
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

      // The Agent Skills spec requires the frontmatter name to match the
      // directory. Reported rather than enforced: the directory is what the
      // loader actually keys on, so a mismatch is a confusing bundle, not a
      // broken one, and dropping the skill would be a harsher answer than the
      // problem deserves.
      if (parsed.skill.name !== entry.name) {
        warnings.push(
          `The skill in "${entry.name}/" calls itself "${parsed.skill.name}". The spec asks these to match.`
        );
      }

      if (!isAgentSkillName(parsed.skill.name)) {
        warnings.push(
          `"${parsed.skill.name}" is not a conformant skill name: use lowercase letters, digits and single hyphens.`
        );
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
        license: parsed.skill.license,
        compatibility: parsed.skill.compatibility,
        allowedTools: parsed.skill.allowedTools,
        path
      });
    }
  }

  return skills;
}

/**
 * Whether a bundle offers anything Atlas can actually run.
 *
 * A catalogue entry can be perfectly valid and still do nothing here: a bundle
 * whose only component is an `.app.json` connector installs cleanly and then
 * sits there, because Atlas has no connector broker. 108 of the 180 plugins in
 * one public catalogue are exactly that shape, so this is the difference
 * between a useful listing and one where most rows are dead.
 *
 * Probes rather than loads: a full read per entry would mean scanning several
 * hundred bundles' skills to draw a list.
 */
export function readPluginCapability(bundleRoot: string): { usable: boolean } {
  let root: string;

  try {
    root = realpathSync(resolve(bundleRoot));
  } catch {
    return { usable: false };
  }

  const found = findManifest(root);
  const manifest = found ? parsePluginManifest(found.text, found.format) : null;

  if (!manifest?.ok) {
    // Not usable, but not this function's business to say why — the manifest
    // parser already reports that properly when the entry is installed.
    return { usable: false };
  }

  for (const kind of ['skills', 'mcpServers'] as const) {
    for (const declared of pluginComponentPaths(manifest.manifest, kind)) {
      if (containedPath(root, declared)) {
        return { usable: true };
      }
    }
  }

  return { usable: false };
}

/**
 * A bundle's declared version, without loading the whole bundle.
 *
 * The update check asks this of a marketplace's local bundles, whose catalogue
 * entries often carry no `version` of their own — the manifest beside the code
 * is the only place the answer lives. One manifest read rather than a skills
 * scan per candidate.
 */
export function readPluginVersion(bundleRoot: string): string | null {
  let root: string;

  try {
    root = realpathSync(resolve(bundleRoot));
  } catch {
    return null;
  }

  const found = findManifest(root);
  const parsed = found ? parsePluginManifest(found.text, found.format) : null;

  return parsed?.ok ? parsed.manifest.version : null;
}

/**
 * A bundle's icon file, without loading the whole bundle.
 *
 * Used for catalogue rows, where doing a full `loadPlugin` per entry would mean
 * scanning several hundred bundles' skills to draw a grid. Reads one manifest
 * and resolves the artwork it names, with the same containment check every
 * other declared path gets.
 */
export function readPluginIconPath(bundleRoot: string): string | null {
  let root: string;

  try {
    root = realpathSync(resolve(bundleRoot));
  } catch {
    return null;
  }

  const found = findManifest(root);

  if (!found) {
    return null;
  }

  const parsed = parsePluginManifest(found.text, found.format);

  if (!parsed.ok) {
    return null;
  }

  return pluginIconPath(root, parsed.manifest);
}

/** The artwork a manifest names, resolved and proven to be inside the bundle. */
export function pluginIconPath(root: string, manifest: PluginManifest): string | null {
  for (const declared of [manifest.interface?.logo, manifest.interface?.composerIcon]) {
    const path = declared ? containedPath(root, declared) : null;

    if (path) {
      return path;
    }
  }

  return null;
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
