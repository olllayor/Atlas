import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveClaudeHomePath } from './claudeHome.js';

/**
 * Claude Code skill discovery + `$skill` dispatch.
 *
 * Blueprint: pingdotgg/t3code `Drivers/ClaudeSkills.ts` (filesystem scan,
 * frontmatter rules, user-wins precedence) and `Drivers/ClaudeSkillDispatch.ts`
 * (`$name` → trailing `/name` rewrite). Plain TS port, no Effect.
 *
 * Claude Code loads skills from `<config dir>/skills` (user scope) and
 * `<cwd>/.claude/skills` (project scope): one directory per skill with a
 * `SKILL.md` carrying YAML frontmatter. The skill is identified by its
 * directory name, not the frontmatter `name` (verified against the CLI).
 */

export interface ClaudeSkill {
  readonly name: string;
  readonly description?: string;
  /** `false` hides the skill from invocation; free-form text stays invokable. */
  readonly userInvocable?: boolean;
  /** True when only the user (not the model) may invoke it. */
  readonly userInvocationOnly?: boolean;
  readonly scope: 'user' | 'project';
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** YAML 1.1 spellings (`yes`/`no`, `on`/`off`, `1`/`0`) included. */
function parseFrontmatterBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return value === 1 ? true : value === 0 ? false : undefined;
  }
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase()) {
    case 'true':
    case 'yes':
    case 'on':
    case 'y':
      return true;
    case 'false':
    case 'no':
    case 'off':
    case 'n':
      return false;
    default:
      return undefined;
  }
}

type SkillFrontmatter =
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' }
  | {
      readonly kind: 'parsed';
      readonly description?: string;
      readonly userInvocationOnly?: boolean;
      readonly userInvocable?: boolean;
    };

/** Minimal `key: value` frontmatter reader; full YAML is more than skills need. */
export function parseSkillFrontmatter(contents: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { kind: 'missing' };
  }
  const record: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      // A line that is neither `key: value` nor blank/continuation means the
      // block is not the flat mapping skills use — treat as malformed so a
      // broken skill never surfaces as invokable.
      if (line.trim().length > 0 && !/^\s/.test(line)) {
        return { kind: 'malformed' };
      }
      continue;
    }
    record[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  const description = record['description'] ?? '';
  return {
    kind: 'parsed',
    ...(description ? { description } : {}),
    ...(parseFrontmatterBoolean(record['disable-model-invocation']) === true
      ? { userInvocationOnly: true }
      : {}),
    ...(parseFrontmatterBoolean(record['user-invocable']) === false
      ? { userInvocable: false }
      : {})
  };
}

/** Config dir: explicit home path, else the CLI default `~/.claude`. */
export function resolveClaudeConfigDir(homePath: string): string {
  const trimmed = homePath.trim();
  if (trimmed) {
    return resolveClaudeHomePath(trimmed);
  }
  return join(homedir(), '.claude');
}

/**
 * Best-effort skill enumeration. Unreadable roots and malformed entries are
 * skipped; user scope wins name collisions, matching the CLI.
 */
export async function discoverClaudeSkills(input: {
  homePath: string;
  cwd: string;
}): Promise<ClaudeSkill[]> {
  const roots: Array<{ directory: string; scope: 'user' | 'project' }> = [
    { directory: join(resolveClaudeConfigDir(input.homePath), 'skills'), scope: 'user' },
    { directory: join(input.cwd, '.claude', 'skills'), scope: 'project' }
  ];
  const byName = new Map<string, ClaudeSkill>();
  for (const root of roots) {
    let entries: string[];
    try {
      entries = (await readdir(root.directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const entry of [...entries].sort()) {
      const name = entry.trim();
      if (!name || byName.has(name)) {
        continue;
      }
      let contents: string;
      try {
        contents = await readFile(join(root.directory, entry, 'SKILL.md'), 'utf8');
      } catch {
        continue;
      }
      const frontmatter = parseSkillFrontmatter(contents);
      if (frontmatter.kind === 'malformed') {
        continue;
      }
      byName.set(name, {
        name,
        scope: root.scope,
        ...(frontmatter.kind === 'parsed' && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
        ...(frontmatter.kind === 'parsed' && frontmatter.userInvocationOnly === true
          ? { userInvocationOnly: true as const }
          : {}),
        ...(frontmatter.kind === 'parsed' && frontmatter.userInvocable === false
          ? { userInvocable: false as const }
          : {})
      });
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Same token the composer chips recognise, so chip and dispatch agree. */
const SKILL_MENTION_PATTERN = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;

export interface ClaudeSkillDispatch {
  /** Text before the dispatched mention; absent when it opens the prompt. */
  readonly leadingText: string | undefined;
  /** `/name` plus trailing text — must be the message's last text block. */
  readonly commandText: string;
  readonly skillName: string;
}

/**
 * Split the prompt around the last `$skill` mention naming a discovered skill.
 * Unknown `$words` (`$HOME` in prose) stay literal. Earlier mentions become
 * inline `/name` so the model still reaches them through its Skill tool.
 */
export function planClaudeSkillDispatch(
  prompt: string,
  skillNames: ReadonlySet<string>
): ClaudeSkillDispatch | undefined {
  const mentions: Array<{ name: string; start: number; end: number }> = [];
  for (const match of prompt.matchAll(SKILL_MENTION_PATTERN)) {
    const name = match[2] ?? '';
    if (!skillNames.has(name)) {
      continue;
    }
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    mentions.push({ name, start, end: start + name.length + 1 });
  }
  const last = mentions.at(-1);
  if (!last) {
    return undefined;
  }
  const leading = prompt.slice(0, last.start);
  const trailing = prompt.slice(last.end);
  const leadingWithInlineSlashes = mentions
    .slice(0, -1)
    .reduceRight(
      (text, mention) => `${text.slice(0, mention.start)}/${text.slice(mention.start + 1)}`,
      leading
    )
    .trimEnd();
  return {
    leadingText: leadingWithInlineSlashes.length > 0 ? leadingWithInlineSlashes : undefined,
    commandText: `/${last.name}${trailing}`.trimEnd(),
    skillName: last.name
  };
}
