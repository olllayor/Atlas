import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  EMPTY_SKILL_SIDECAR,
  parseSkillMarkdown,
  parseSkillSidecar
} from '../../shared/plugins';
import type { LoadedSkill } from './PluginLoader';

const SKILL_INDEX_PREFIX_BYTES = 8 * 1024;
const SIDEBAR_PREFIX_BYTES = 64 * 1024;
const DEFAULT_TTL_MS = 5_000;

export type StandaloneSkillsScannerOptions = {
  globalRoots?: string[];
  ttlMs?: number;
  now?: () => number;
};

export function defaultGlobalRoots(): string[] {
  const home = homedir();
  return [
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.codex', 'skills'),
    join(home, '.atlas', 'skills'),
  ];
}

export function defaultProjectRoots(projectRoot: string): string[] {
  return [
    join(projectRoot, '.agents', 'skills'),
    join(projectRoot, '.claude', 'skills'),
    join(projectRoot, '.codex', 'skills'),
    join(projectRoot, 'skills'),
  ];
}

/**
 * Reads up to `budget` bytes from `path`.
 * Fails safely on missing files, non-files, or unreadable descriptors.
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
        // Ignored
      }
    }
  }

  return buffer.subarray(0, bytesRead).toString('utf-8');
}

function scanSkillDirectory(
  rootDir: string,
  scope: 'global' | 'project'
): LoadedSkill[] {
  let entries;
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: LoadedSkill[] = [];

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir || entry.name.startsWith('.')) {
      continue;
    }

    const skillMdPath = join(fullPath, 'SKILL.md');
    const prefix = readCapped(skillMdPath, SKILL_INDEX_PREFIX_BYTES);
    if (prefix == null) {
      continue;
    }

    const parsed = parseSkillMarkdown(prefix);
    if (!parsed.ok) {
      continue;
    }

    const sidecarPath = join(fullPath, 'agents', 'openai.yaml');
    const sidecarText = readCapped(sidecarPath, SIDEBAR_PREFIX_BYTES);
    const sidecar = sidecarText ? parseSkillSidecar(sidecarText) : EMPTY_SKILL_SIDECAR;

    results.push({
      qualifiedName: parsed.skill.name,
      pluginName: scope,
      name: parsed.skill.name,
      description: parsed.skill.description,
      implicitInvocation: sidecar.implicitInvocation ?? parsed.skill.implicitInvocation,
      requiredServers: sidecar.requiredServers,
      license: parsed.skill.license,
      compatibility: parsed.skill.compatibility,
      allowedTools: parsed.skill.allowedTools,
      path: skillMdPath
    });
  }

  return results;
}

/**
 * Discovers standalone Agent Skills from global and project directories.
 *
 * Implements the open Agent Skills standard:
 * - Global: ~/.agents/skills, ~/.claude/skills, ~/.codex/skills, ~/.atlas/skills
 * - Project: <projectRoot>/.agents/skills, <projectRoot>/.claude/skills,
 *   <projectRoot>/.codex/skills, <projectRoot>/skills
 *
 * Project skills take precedence over global skills with the same name.
 */
export class StandaloneSkillsScanner {
  private readonly globalRoots: string[];
  private readonly ttlMs: number;
  private readonly now: () => number;

  private globalCache: { at: number; skills: LoadedSkill[] } | null = null;
  private projectCache = new Map<string, { at: number; skills: LoadedSkill[] }>();

  constructor(options?: StandaloneSkillsScannerOptions) {
    this.globalRoots = options?.globalRoots ?? defaultGlobalRoots();
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * Scans global skill roots.
   */
  scanGlobal(): LoadedSkill[] {
    const now = this.now();
    if (this.globalCache && now - this.globalCache.at < this.ttlMs) {
      return [...this.globalCache.skills];
    }

    const skills: LoadedSkill[] = [];
    const seen = new Set<string>();

    for (const root of this.globalRoots) {
      const found = scanSkillDirectory(root, 'global');
      for (const skill of found) {
        const key = skill.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          skills.push(skill);
        }
      }
    }

    this.globalCache = { at: now, skills };
    return [...skills];
  }

  /**
   * Scans project skill roots for a given projectRoot.
   */
  scanProject(projectRoot: string): LoadedSkill[] {
    if (!projectRoot) {
      return [];
    }

    const now = this.now();
    const cached = this.projectCache.get(projectRoot);
    if (cached && now - cached.at < this.ttlMs) {
      return [...cached.skills];
    }

    const roots = defaultProjectRoots(projectRoot);
    const skills: LoadedSkill[] = [];
    const seen = new Set<string>();

    for (const root of roots) {
      const found = scanSkillDirectory(root, 'project');
      for (const skill of found) {
        const key = skill.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          skills.push(skill);
        }
      }
    }

    this.projectCache.set(projectRoot, { at: now, skills });
    return [...skills];
  }

  /**
   * Scans both project (if provided) and global skills.
   * Project skills take precedence over global skills with the same name.
   */
  scan(projectRoot?: string | null): LoadedSkill[] {
    const projectSkills = projectRoot ? this.scanProject(projectRoot) : [];
    const globalSkills = this.scanGlobal();

    const merged: LoadedSkill[] = [];
    const seen = new Set<string>();

    // Project skills take precedence
    for (const skill of projectSkills) {
      const key = skill.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(skill);
      }
    }

    // Global skills follow
    for (const skill of globalSkills) {
      const key = skill.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(skill);
      }
    }

    return merged;
  }

  /** Drops all caches. */
  invalidate(): void {
    this.globalCache = null;
    this.projectCache.clear();
  }

  /** Drops the cached entry for one project root. */
  invalidateProject(projectRoot: string): void {
    this.projectCache.delete(projectRoot);
  }
}
