import { formatSkillBody } from '../../shared/plugins';
import type { LoadedSkill } from './PluginLoader';
import { readSkillBody } from './PluginLoader';
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

export type SkillsSnapshot = PluginSnapshot & {
  /** Everything loadable, including skills withheld from the index. */
  skills: LoadedSkill[];
};

export class SkillsService {
  constructor(private readonly registry: PluginRegistry) {}

  /** The registry's view, plus every skill flattened across bundles. */
  snapshot(): SkillsSnapshot {
    const snapshot = this.registry.snapshot();
    return { ...snapshot, skills: snapshot.plugins.flatMap((plugin) => plugin.skills) };
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

}

/** Descriptions are prose and may wrap; the index is one skill per line. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
