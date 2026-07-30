import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

import type { WorkspaceProject } from '../../../shared/contracts';
import type { SqliteDatabase } from '../client';

type ProjectRow = {
  id: string;
  title: string;
  root: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

const SELECT_COLUMNS = `
  id,
  title,
  root,
  created_at AS createdAt,
  updated_at AS updatedAt,
  last_used_at AS lastUsedAt
`;

/**
 * Resolves the real git directory for a root.
 *
 * A plain checkout has `.git/` as a directory; a worktree or submodule has it
 * as a file containing `gitdir: <path>`, and that indirection is where the
 * branch actually lives.
 */
function resolveGitDir(root: string) {
  const dotGit = resolve(root, '.git');

  try {
    const stats = statSync(dotGit);

    if (stats.isDirectory()) {
      return dotGit;
    }

    const pointer = readFileSync(dotGit, 'utf8').trim();
    const match = /^gitdir:\s*(.+)$/.exec(pointer);
    if (!match?.[1]) {
      return null;
    }

    return isAbsolute(match[1]) ? match[1] : resolve(root, match[1]);
  } catch {
    return null;
  }
}

/**
 * The checked-out branch, read straight from `HEAD`.
 *
 * A file read rather than `git rev-parse`: this runs on every project list,
 * and spawning a process per row to render a chip is not worth it. A detached
 * HEAD holds a raw sha, which is not a branch, so it reports none.
 */
function readBranch(root: string) {
  const gitDir = resolveGitDir(root);
  if (!gitDir) {
    return null;
  }

  try {
    const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Reported per read rather than stored: a folder can be renamed, moved, or
 * deleted while Atlas is closed, and a stale `exists` flag would let Code mode
 * hand the model a writable root that is not there. The branch moves under us
 * for the same reason.
 */
function describeRoot(root: string) {
  try {
    if (!statSync(root).isDirectory()) {
      return { exists: false, isGitRepository: false, branch: null };
    }
  } catch {
    return { exists: false, isGitRepository: false, branch: null };
  }

  return {
    exists: true,
    isGitRepository: existsSync(resolve(root, '.git')),
    branch: readBranch(root)
  };
}

function mapProject(row: ProjectRow): WorkspaceProject {
  return {
    id: row.id,
    title: row.title,
    root: row.root,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    ...describeRoot(row.root)
  };
}

export class ProjectsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(): WorkspaceProject[] {
    return this.db
      .prepare<[], ProjectRow>(
        `
          SELECT ${SELECT_COLUMNS}
          FROM projects
          ORDER BY COALESCE(last_used_at, updated_at) DESC
        `
      )
      .all()
      .map(mapProject);
  }

  get(projectId: string): WorkspaceProject | null {
    const row = this.db
      .prepare<{ projectId: string }, ProjectRow>(
        `
          SELECT ${SELECT_COLUMNS}
          FROM projects
          WHERE id = @projectId
        `
      )
      .get({ projectId });

    return row ? mapProject(row) : null;
  }

  findByRoot(root: string): WorkspaceProject | null {
    const row = this.db
      .prepare<{ root: string }, ProjectRow>(
        `
          SELECT ${SELECT_COLUMNS}
          FROM projects
          WHERE root = @root
        `
      )
      .get({ root: resolve(root) });

    return row ? mapProject(row) : null;
  }

  /**
   * Attaching the same folder twice returns the existing project rather than a
   * duplicate: `root` is the identity that matters, and two rows for one folder
   * would let two conversations disagree about the same working tree.
   */
  create(input: { root: string; title?: string }): WorkspaceProject {
    const root = resolve(input.root);
    const existing = this.findByRoot(root);
    if (existing) {
      return existing;
    }

    const title = input.title?.replace(/\s+/g, ' ').trim().slice(0, 200) || basename(root) || root;
    const createdAt = new Date().toISOString();
    const id = randomUUID();

    this.db
      .prepare(
        `
          INSERT INTO projects (id, title, root, created_at, updated_at, last_used_at)
          VALUES (@id, @title, @root, @createdAt, @createdAt, NULL)
        `
      )
      .run({ id, title, root, createdAt });

    return this.get(id)!;
  }

  rename(projectId: string, title: string): WorkspaceProject {
    const normalized = title.replace(/\s+/g, ' ').trim().slice(0, 200);

    if (!normalized) {
      throw new Error('Project title cannot be empty.');
    }

    const result = this.db
      .prepare(
        `
          UPDATE projects
          SET title = @title, updated_at = @updatedAt
          WHERE id = @projectId
        `
      )
      .run({ projectId, title: normalized, updatedAt: new Date().toISOString() });

    if (result.changes === 0) {
      throw new Error(`Project ${projectId} not found.`);
    }

    return this.get(projectId)!;
  }

  /** Detaching a project leaves its conversations in place (`ON DELETE SET NULL`). */
  delete(projectId: string) {
    this.db.prepare('DELETE FROM projects WHERE id = @projectId').run({ projectId });
  }

  touch(projectId: string) {
    this.db
      .prepare('UPDATE projects SET last_used_at = @now WHERE id = @projectId')
      .run({ projectId, now: new Date().toISOString() });
  }
}
