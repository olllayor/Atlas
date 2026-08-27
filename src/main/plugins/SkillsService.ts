import { dirname } from 'node:path';

import { formatSkillBody } from '../../shared/plugins';
import type { LoadedSkill } from './PluginLoader';
import { readSkillBody } from './PluginLoader';
import type { WorkspaceMode } from '../../shared/workspaceModes';
import type { LoadedPlugin } from './PluginLoader';
import type { PluginRegistry, PluginSnapshot } from './PluginRegistry';

/**
 * The skills every installed plugin offers.
 *
 * A view over `PluginRegistry` rather than its own scanner: skills are one of
 * several component types a bundle carries, and reading the directory once per
 * consumer would mean the prompt and the tool set could disagree about what is
 * installed.
 *
 * The two-phase split is the point. Only a name and a one-line description
 * reach the prompt; the body is read when `load_skill` asks for it. On a
 * machine with 34 bundles installed that is ~25 KiB of index against ~2 MB of
 * bodies — the standing cost is roughly 80x smaller than preloading would be,
 * for the same 208 skills.
 */

/** Ceiling on the whole index, so a machine full of bundles cannot flood the prompt. */
const MAX_INDEX_BYTES = 24 * 1024;

/** Per-entry description cap. The parse limit is far too generous for an index. */
const MAX_INDEX_DESCRIPTION_CHARS = 200;

/** What a session is, for deciding which plugins belong in it. */
export type SkillContext = {
  mode: WorkspaceMode;
  hasProject: boolean;
};

export type SkillsSnapshot = PluginSnapshot & {
  /** Everything loadable, including skills withheld from the index. */
  skills: LoadedSkill[];
};

export class SkillsService {
  constructor(
    private readonly registry: PluginRegistry,
    /**
     * The beta switch, read live on every access.
     *
     * Off, the service is inert: the snapshot is empty, so the prompt index,
     * the `load_skill` tool and every `@plugin` mention resolve to nothing —
     * the same shape as a machine with no plugins installed.
     */
    private readonly isEnabled: () => boolean = () => true
  ) {}

  /** The registry's view, plus every skill flattened across bundles. */
  snapshot(): SkillsSnapshot {
    const snapshot = this.registry.snapshot();
    const plugins = this.isEnabled() ? snapshot.plugins : [];
    return { ...snapshot, plugins, skills: plugins.flatMap((plugin) => plugin.skills) };
  }

  /**
   * Skills whose plugin fits the session it would be offered in.
   *
   * A code-only plugin has nothing to say in a work session, and a plugin that
   * needs a project has nothing to act on without one. Filtering here rather
   * than at selection time means those skills cost no tokens at all, instead of
   * costing an index line and an occasional wrong choice.
   *
   * Absent context means no filtering: the context meter and any caller without
   * a session should see the whole set rather than a guess.
   */
  applicableSkills(context?: SkillContext): LoadedSkill[] {
    const snapshot = this.snapshot();

    return snapshot.plugins
      .filter((plugin) => !context || pluginApplies(plugin, context))
      .flatMap((plugin) => plugin.skills);
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
   * A skill's instructions, fenced as untrusted, anchored to its folder.
   *
   * Third-party Markdown phrased as instructions is the same injection surface
   * as a tool result, and gets the same treatment. The folder is named because
   * a skill is a directory rather than a file, and a body that points at
   * `references/` is unusable without knowing where `references/` is.
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
      'Optional instruction sets contributed by installed plugins. Each line is a name and what it is for.',
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
