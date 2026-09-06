/**
 * Skills in the `/` slash menu (ported from t3code PR #8009, Atlas-native).
 *
 * The `/` menu lists built-in control commands and plugin template commands.
 * Skills used to live only behind `@` mentions (plugin bundles) and `$`
 * dispatch (Claude). This module adds them to the slash menu as
 * `/skill:Display Name` rows, gated by the `showSkillsInSlashMenu` setting
 * (on by default; off keeps the menu command-only).
 *
 * Insert behavior follows the existing invocation route per skill kind, so a
 * slash pick always lands on a token the send path already understands:
 *
 * - Plugin skills insert `@plugin skill `: the provider-agnostic mention the
 *   runtime inlines (with same-turn server activation).
 * - Standalone skills (`global` / `project` scope) have no `@` address, so
 *   they insert `$name `: the Claude dispatch token, and a literal name the
 *   model can reach through `load_skill` elsewhere.
 *
 * Pure, so the picker and the tests read the same rules.
 */

export type SlashMenuSkillSource = 'plugin' | 'project' | 'global';

export type SlashMenuSkill = {
  /** `<plugin>:<skill>` for bundles, bare name for standalone skills. */
  qualifiedName: string;
  /** Bundle name, or the `global` / `project` scope. */
  pluginName: string;
  name: string;
  description: string;
  source: SlashMenuSkillSource;
};

/** `apple-design` → `Apple Design`. Underscores split the same way. */
export function formatSkillDisplayName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The row label, e.g. `/skill:Apple Design`. */
export function skillSlashLabel(skill: Pick<SlashMenuSkill, 'name'>): string {
  return `/skill:${formatSkillDisplayName(skill.name)}`;
}

/**
 * The text a slash pick leaves in the composer, always with a trailing
 * space. Never starts with `/`, so the standalone-command grammar (which
 * consumes exact `/name` drafts as control actions) cannot mistake it for a
 * built-in — even when a skill shares a built-in's name.
 */
export function skillInsertText(skill: Pick<SlashMenuSkill, 'pluginName' | 'name' | 'source'>): string {
  if (skill.source === 'plugin') {
    return `@${skill.pluginName} ${skill.name} `;
  }
  return `$${skill.name} `;
}

/**
 * Visible skills for the menu. The input is already the usable set (the main
 * process only returns applicable skills), so this is just the setting gate.
 */
export function getSlashMenuSkills(
  skills: readonly SlashMenuSkill[],
  showSkillsInSlashMenu: boolean
): SlashMenuSkill[] {
  return showSkillsInSlashMenu ? [...skills] : [];
}

/**
 * Drops plugin template commands whose name collides with a *visible* skill,
 * so one name never owns two rows. The skill alias wins and keeps its
 * `/skill:Name` label.
 *
 * Dedupe runs against visible skills only: when the setting is off (or no
 * skill by that name is offered), the provider command stays. Built-ins are
 * never deduped here — they are consumed control actions, and hiding one
 * behind a skill row would silently rewire `/plan` into a message.
 */
export function dedupeSlashMenuCommands<T extends { name: string }>(
  commands: readonly T[],
  visibleSkills: readonly Pick<SlashMenuSkill, 'name'>[]
): T[] {
  if (visibleSkills.length === 0) return [...commands];
  const skillNames = new Set(visibleSkills.map((skill) => skill.name.trim().toLowerCase()));
  return commands.filter((command) => !skillNames.has(command.name.trim().toLowerCase()));
}

/**
 * Filter for the slash popup. Mirrors `filterSlashCommands` ranking, plus
 * the `skill:` prefix alias: bare `skill` lists every skill, `skill:unsl`
 * searches for `unsl`.
 */
export function filterSlashMenuSkills(skills: readonly SlashMenuSkill[], query: string): SlashMenuSkill[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized || normalized === 'skill') return [...skills];
  const needle = normalized.startsWith('skill:') ? normalized.slice('skill:'.length) : normalized;
  if (!needle) return [...skills];
  const matches = skills.filter((skill) =>
    [skill.name, formatSkillDisplayName(skill.name), skill.description, skill.pluginName]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  );
  return matches.sort((left, right) => rankSkill(left, needle) - rankSkill(right, needle));
}

function rankSkill(skill: SlashMenuSkill, needle: string): number {
  const name = skill.name.toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (formatSkillDisplayName(skill.name).toLowerCase().startsWith(needle)) return 1;
  return 2;
}
