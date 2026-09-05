/**
 * Native skill discovery across user and project roots, ported from t3code
 * PR #9348 (`Drivers/AntigravitySkills.ts`) to plain Node TS.
 *
 * Skills discovered on disk survive session and command updates: callers merge
 * rather than replace, and the registry re-reads the workspace.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface AntigravitySkill {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}

async function readSkillDir(dir: string): Promise<AntigravitySkill[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const skills: AntigravitySkill[] = [];
  for (const entry of entries) {
    const skillFile = join(dir, entry, 'SKILL.md');
    try {
      const st = await stat(skillFile);
      if (!st.isFile()) continue;
      const content = await readFile(skillFile, 'utf8');
      const firstLine = content.split('\n')[0]?.replace(/^#\s*/, '').trim() || entry;
      skills.push({ name: entry, description: firstLine.slice(0, 240), path: skillFile });
    } catch {
      continue;
    }
  }
  return skills;
}

/** Discover skills under `<root>/.agents/skills` and `<root>/skills`. */
export async function discoverAntigravitySkills(roots: readonly string[]): Promise<AntigravitySkill[]> {
  const seen = new Map<string, AntigravitySkill>();
  for (const root of roots) {
    for (const dir of [join(root, '.agents', 'skills'), join(root, 'skills')]) {
      for (const skill of await readSkillDir(dir)) {
        if (!seen.has(skill.name)) {
          seen.set(skill.name, skill);
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Merge freshly discovered skills over the registry without dropping disk state. */
export function mergeAntigravitySkills(
  previous: readonly AntigravitySkill[],
  discovered: readonly AntigravitySkill[]
): AntigravitySkill[] {
  const merged = new Map<string, AntigravitySkill>();
  for (const skill of previous) merged.set(skill.name, skill);
  for (const skill of discovered) merged.set(skill.name, skill);
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
