import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { formatSkillBody } from '../../shared/plugins';
import type { LoadedSkill } from './PluginLoader';
import { readSkillBody } from './PluginLoader';
import type { WorkspaceMode } from '../../shared/workspaceModes';
import type { LoadedPlugin } from './PluginLoader';
import type { PluginRegistry, PluginSnapshot } from './PluginRegistry';
import { StandaloneSkillsScanner } from './StandaloneSkillsScanner';

/**
 * The skills available to an Atlas session, sourced from:
 * 1. Global standalone Agent Skills (~/.agents/skills, ~/.claude/skills, ~/.codex/skills, ~/.atlas/skills)
 * 2. Project standalone Agent Skills (<projectRoot>/.agents/skills, etc.)
 * 3. Installed plugin bundles (~/.atlas/plugins)
 *
 * The two-phase split is the point. Only a name and a one-line description
 * reach the prompt; the body is read when `load_skill` asks for it.
 */

/** Ceiling on the whole index, so a machine full of bundles cannot flood the prompt. */
const MAX_INDEX_BYTES = 24 * 1024;

/** Per-entry description cap. The parse limit is far too generous for an index. */
const MAX_INDEX_DESCRIPTION_CHARS = 200;

/** What a session is, for deciding which plugins and skills belong in it. */
export type SkillContext = {
  mode: WorkspaceMode;
  hasProject: boolean;
  projectRoot?: string | null;
};

export type SkillsSnapshot = PluginSnapshot & {
  /** Everything loadable, including skills withheld from the index. */
  skills: LoadedSkill[];
};

export class SkillsService {
  private readonly standaloneScanner: StandaloneSkillsScanner;

  constructor(
    private readonly registry: PluginRegistry,
    /**
     * The beta switch for plugin bundles, read live on every access.
     *
     * Off, plugin bundles are withheld; standalone Agent Skills remain available.
     */
    private readonly isEnabled: () => boolean = () => true,
    standaloneScanner?: StandaloneSkillsScanner
  ) {
    const isCustomRegistryRoot = registry.root !== join(homedir(), '.atlas', 'plugins');
    this.standaloneScanner =
      standaloneScanner ??
      new StandaloneSkillsScanner(
        isCustomRegistryRoot ? { globalRoots: [] } : undefined
      );
  }

  /** The registry's view, plus every skill flattened across bundles and standalone locations. */
  snapshot(projectRoot?: string | null): SkillsSnapshot {
    const snapshot = this.registry.snapshot();
    const plugins = this.isEnabled() ? snapshot.plugins : [];
    const pluginSkills = plugins.flatMap((plugin) => plugin.skills);
    const standaloneSkills = this.standaloneScanner.scan(projectRoot);

    const seen = new Set<string>();
    const mergedSkills: LoadedSkill[] = [];

    // Standalone skills (project and global)
    for (const skill of standaloneSkills) {
      const key = skill.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        mergedSkills.push(skill);
      }
    }

    // Plugin skills
    for (const skill of pluginSkills) {
      mergedSkills.push(skill);
    }

    return { ...snapshot, plugins, skills: mergedSkills };
  }

  /**
   * Skills whose plugin and scope fit the session it would be offered in.
   *
   * A code-only plugin has nothing to say in a work session, and a plugin that
   * needs a project has nothing to act on without one. Standalone project skills
   * require a project, while global skills apply anywhere.
   */
  applicableSkills(context?: SkillContext): LoadedSkill[] {
    const snapshot = this.registry.snapshot();
    const plugins = this.isEnabled() ? snapshot.plugins : [];
    const pluginSkills = plugins
      .filter((plugin) => !context || pluginApplies(plugin, context))
      .flatMap((plugin) => plugin.skills);

    const standaloneSkills = this.standaloneScanner.scan(context?.projectRoot);
    const applicableStandalone = standaloneSkills.filter((skill) => {
      if (skill.pluginName === 'project' && context && !context.hasProject) {
        return false;
      }
      return true;
    });

    const seen = new Set<string>();
    const mergedSkills: LoadedSkill[] = [];

    for (const skill of applicableStandalone) {
      const key = skill.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        mergedSkills.push(skill);
      }
    }

    for (const skill of pluginSkills) {
      mergedSkills.push(skill);
    }

    return mergedSkills;
  }

  /**
   * Resolves a skill by the name the model or user used.
   *
   * Accepts bare name ("apple-design"), qualified name ("demo:yeet"),
   * or scope-prefixed name ("global:apple-design", "project:shadcn").
   *
   * Scoped strictly to the given project root: a skill from another project
   * is never returned, so project boundaries are not crossed by name lookup.
   */
  find(name: string, projectRoot?: string | null): LoadedSkill | null {
    const wanted = name.trim().toLowerCase();
    const skills = this.snapshot(projectRoot).skills;

    return (
      skills.find((skill) => skill.qualifiedName.toLowerCase() === wanted) ??
      skills.find((skill) => skill.name.toLowerCase() === wanted) ??
      skills.find((skill) => `${skill.pluginName}:${skill.name}`.toLowerCase() === wanted) ??
      null
    );
  }

  /** Drops standalone caches alongside the registry, so new skills appear. */
  invalidate(): void {
    this.registry.invalidate();
    this.standaloneScanner.invalidate();
  }

  /**
   * A skill's instructions, fenced as untrusted, anchored to its folder.
   *
   * Third-party Markdown phrased as instructions is the same injection surface
   * as a tool result, and gets the same treatment. The folder is named because
   * a skill is a directory rather than a file, and a body that points at
   * `references/` is unusable without knowing where `references/` is.
   */
  read(name: string, projectRoot?: string | null): string {
    const skill = this.find(name, projectRoot);

    if (!skill) {
      return `There is no skill called "${name}". Check the available skills listed in the system prompt.`;
    }

    const body = readSkillBody(skill);

    if (body == null) {
      return `The skill "${skill.qualifiedName}" could not be read from disk.`;
    }

    return formatSkillBody(skill.pluginName, skill.name, body, dirname(skill.path));
  }

  /**
   * The index block for the system prompt, or `null` when nothing is installed.
   *
   * Skills that opted out of implicit invocation are deliberately absent: they
   * are reachable by name when the user asks for one, and listing them would
   * charge every turn for a skill the model was told not to choose.
   */
  describeForPrompt(context?: SkillContext): string | null {
    const listed = this.applicableSkills(context).filter((skill) => skill.implicitInvocation);

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
      'Optional instruction sets contributed by installed plugins and user skills. Each line is a name and what it is for.',
      'When one matches the task, call load_skill with its name and follow what it returns. Do not guess at a skill\'s contents from its description.',
      ...lines,
      '</available_skills>'
    ].join('\n');
  }
}

function pluginApplies(plugin: LoadedPlugin, context: SkillContext): boolean {
  const { workspaceModes, requiresProject } = plugin.manifest.atlas;

  // An empty list means every mode, so a bundle that says nothing is unchanged.
  if (workspaceModes.length > 0 && !workspaceModes.includes(context.mode)) {
    return false;
  }

  return !requiresProject || context.hasProject;
}

/** Descriptions are prose and may wrap; the index is one skill per line. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
