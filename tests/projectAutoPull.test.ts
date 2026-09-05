import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ProjectsRepo } from '../src/main/db/repositories/projectsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { GitStateService } from '../src/main/workspace/GitStateService.js';
import {
  autoPullProject,
  autoPullProjects,
  maybeAutoPullAfterState,
  type AutoPullSkipReason,
} from '../src/main/workspace/projectAutoPull.js';

function wrap(raw: DatabaseSync): SqliteDatabase {
  return {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => {
        raw.exec('BEGIN');
        try {
          const result = callback(...args);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      },
  } as unknown as SqliteDatabase;
}

function makeDatabase(t: TestContext, label: string) {
  const tempDir = mkdtempSync(join(tmpdir(), `atlas-${label}-`));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const database = wrap(raw);
  applySchema(database);

  return database;
}

type FakeState = {
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  files: Array<{ path: string }>;
};

function makeFakeGit(options: {
  isRepo?: boolean;
  state?: Partial<FakeState>;
  defaultBranch?: string | null;
  pull?: () => Promise<string>;
  fetch?: () => Promise<void>;
  stateAfterFetch?: Partial<FakeState>;
}) {
  const calls: string[] = [];
  const fetches: string[] = [];
  let fetched = false;
  const git = {
    isGitRepo: () => options.isRepo ?? true,
    getState: async () => ({
      branch: 'main',
      ahead: 0,
      behind: 1,
      files: [],
      ...options.state,
      ...(fetched ? options.stateAfterFetch : {}),
    }),
    getDefaultBranch: async () =>
      options.defaultBranch === undefined ? 'main' : options.defaultBranch,
    fetchRemote:
      options.fetch ??
      (async () => {
        fetched = true;
      }),
    pullCurrentBranch: options.pull ?? (async () => 'Already up to date.'),
  } as unknown as GitStateService;
  return {
    git,
    pulled: () => calls,
    fetched: () => fetches,
    trackPulls: () => {
      const inner = git.pullCurrentBranch.bind(git);
      (git as { pullCurrentBranch: GitStateService['pullCurrentBranch'] }).pullCurrentBranch =
        async (root: string) => {
          calls.push(root);
          return inner(root);
        };
      const innerFetch = git.fetchRemote.bind(git);
      (git as { fetchRemote: GitStateService['fetchRemote'] }).fetchRemote = async (
        root: string
      ) => {
        fetches.push(root);
        return innerFetch(root);
      };
    },
  };
}

test('automatic pull only fires on a clean, behind, default-branch checkout', async () => {
  const root = '/repo';
  const cases: Array<{
    name: string;
    options: Parameters<typeof makeFakeGit>[0];
    expected: { pulled: true } | { pulled: false; reason: AutoPullSkipReason };
  }> = [
    { name: 'clean behind default pulls', options: {}, expected: { pulled: true } },
    {
      name: 'not a repository skips',
      options: { isRepo: false },
      expected: { pulled: false, reason: 'not-a-repository' },
    },
    {
      name: 'feature branch skips even when behind',
      options: { state: { branch: 'feature' } },
      expected: { pulled: false, reason: 'not-on-default-branch' },
    },
    {
      name: 'unknown default branch skips rather than guessing',
      options: { defaultBranch: null },
      expected: { pulled: false, reason: 'unknown-default-branch' },
    },
    {
      name: 'no upstream skips',
      options: { state: { ahead: null, behind: null } },
      expected: { pulled: false, reason: 'no-upstream' },
    },
    {
      name: 'dirty tree skips',
      options: { state: { files: [{ path: 'a.txt' }] } },
      expected: { pulled: false, reason: 'working-tree-changes' },
    },
    {
      name: 'local commits ahead skip',
      options: { state: { ahead: 1, behind: 1 } },
      expected: { pulled: false, reason: 'local-commits' },
    },
    {
      name: 'in sync skips',
      options: { state: { behind: 0 } },
      expected: { pulled: false, reason: 'up-to-date' },
    },
    {
      name: 'a failed pull is a skip, not a throw',
      options: {
        pull: async () => {
          throw new Error('network down');
        },
      },
      expected: { pulled: false, reason: 'pull-failed' },
    },
  ];

  for (const { name, options, expected } of cases) {
    const { git, pulled, fetched, trackPulls } = makeFakeGit(options);
    trackPulls();
    const outcome = await autoPullProject(root, git);
    assert.deepEqual(outcome, { root, ...expected }, name);
    // A failed pull still attempted exactly one fetch; every other skip never
    // starts one.
    const attempts = !expected.pulled && expected.reason === 'pull-failed' ? 1 : 0;
    assert.equal(pulled().length, expected.pulled ? 1 : attempts, `${name}: pull call count`);
    assert.equal(fetched().length, 0, `${name}: no fetch without fetchFirst`);
  }
});

test('fetchFirst refreshes a stale behind count before deciding', async () => {
  const root = '/repo';

  // Stale zero becomes behind after the fetch: pulls, with one fetch first.
  {
    const { git, pulled, fetched, trackPulls } = makeFakeGit({
      state: { behind: 0 },
      stateAfterFetch: { behind: 2 },
    });
    trackPulls();
    const outcome = await autoPullProject(root, git, { fetchFirst: true });
    assert.deepEqual(outcome, { root, pulled: true });
    assert.deepEqual(fetched(), [root]);
    assert.deepEqual(pulled(), [root]);
  }

  // Still in sync after the fetch: no pull, but the fetch happened.
  {
    const { git, pulled, fetched, trackPulls } = makeFakeGit({ state: { behind: 0 } });
    trackPulls();
    const outcome = await autoPullProject(root, git, { fetchFirst: true });
    assert.deepEqual(outcome, { root, pulled: false, reason: 'up-to-date' });
    assert.deepEqual(fetched(), [root]);
    assert.deepEqual(pulled(), []);
  }

  // Offline remote: a skip, not a throw.
  {
    const { git, pulled, trackPulls } = makeFakeGit({
      fetch: async () => {
        throw new Error('network down');
      },
    });
    trackPulls();
    const outcome = await autoPullProject(root, git, { fetchFirst: true });
    assert.deepEqual(outcome, { root, pulled: false, reason: 'fetch-failed' });
    assert.deepEqual(pulled(), []);
  }

  // Cheap local guards run before any network: a dirty tree never fetches.
  {
    const { git, fetched, trackPulls } = makeFakeGit({ state: { files: [{ path: 'a' }] } });
    trackPulls();
    const outcome = await autoPullProject(root, git, { fetchFirst: true });
    assert.deepEqual(outcome, { root, pulled: false, reason: 'working-tree-changes' });
    assert.deepEqual(fetched(), []);
  }
});

test('the refresh entry point respects the flag and the behind hint', async () => {
  const { git, pulled, trackPulls } = makeFakeGit({});
  trackPulls();

  assert.equal(
    await maybeAutoPullAfterState({ root: '/r', behind: 3, isEnabled: false, git }),
    null
  );
  assert.deepEqual(pulled(), []);

  // Stale zero without fetchFirst: no network at all.
  assert.deepEqual(
    await maybeAutoPullAfterState({ root: '/r', behind: 0, isEnabled: true, git }),
    null
  );
  assert.deepEqual(pulled(), []);

  // Behind with the flag on: pulls through.
  const outcome = await maybeAutoPullAfterState({
    root: '/r',
    behind: 3,
    isEnabled: true,
    git,
    onPulled: () => {},
  });
  assert.deepEqual(outcome, { root: '/r', pulled: true });
});

test('a linked worktree checkout is never a pull target', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-autopull-worktree-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A worktree holds `.git` as a pointer file, not a directory.
  writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere/worktrees/wt');

  const { git } = makeFakeGit({});
  const outcome = await autoPullProject(dir, {
    ...git,
    isGitRepo: () => true,
  } as GitStateService);
  assert.deepEqual(outcome, { root: dir, pulled: false, reason: 'worktree-checkout' });
});

test('the batch dedupes roots and never rejects', async () => {
  const { git } = makeFakeGit({});
  const outcomes = await autoPullProjects(['/a', '/b', '/a'], git, { concurrency: 2 });
  assert.equal(outcomes.length, 2);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.root),
    ['/a', '/b']
  );
  assert.ok(outcomes.every((outcome) => outcome.pulled));
});

function makeOriginWithClone(t: TestContext, label: string) {
  const dir = mkdtempSync(join(tmpdir(), `atlas-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const origin = join(dir, 'origin.git');
  execSync(`git init --bare -b main "${origin}"`);

  const seed = join(dir, 'seed');
  execSync(`git clone "${origin}" "${seed}"`);
  execSync('git config user.name "Test User"', { cwd: seed });
  execSync('git config user.email "test@example.com"', { cwd: seed });
  writeFileSync(join(seed, 'file.txt'), 'one\n');
  execSync('git add -A && git commit -m one && git push origin main', { cwd: seed });

  const checkout = join(dir, 'checkout');
  execSync(`git clone "${origin}" "${checkout}"`);
  execSync('git config user.name "Test User"', { cwd: checkout });
  execSync('git config user.email "test@example.com"', { cwd: checkout });

  // Advance the remote past the checkout without touching it.
  writeFileSync(join(seed, 'file.txt'), 'two\n');
  execSync('git add -A && git commit -m two && git push origin main', { cwd: seed });
  execSync('git fetch origin', { cwd: checkout });

  return { checkout };
}

test('a real behind checkout pulls fast-forward', async (t) => {
  const { checkout } = makeOriginWithClone(t, 'autopull-real');
  const git = new GitStateService();

  assert.equal(await git.getDefaultBranch(checkout), 'main');

  const outcome = await autoPullProject(checkout, git);
  assert.deepEqual(outcome, { root: checkout, pulled: true });

  const second = await autoPullProject(checkout, git);
  assert.deepEqual(second, { root: checkout, pulled: false, reason: 'up-to-date' });
});

test('opting a project into automatic pull round-trips', (t) => {
  const projects = new ProjectsRepo(makeDatabase(t, 'autopull-flag'));

  const project = projects.create({ root: tmpdir(), title: 'Atlas' });
  assert.equal(project.autoPull, false, 'existing behaviour is opt-in');

  const enabled = projects.setAutoPull(project.id, true);
  assert.equal(enabled.autoPull, true);
  assert.equal(projects.get(project.id)?.autoPull, true);
  assert.equal(
    projects.list().find((row) => row.id === project.id)?.autoPull,
    true
  );

  assert.equal(projects.setAutoPull(project.id, false).autoPull, false);
  assert.throws(() => projects.setAutoPull('missing-project', true), /not found/);
});

test('the auto_pull migration backfills opted-out on old databases', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-autopull-migrate-'));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  t.after(() => raw.close());

  // A pre-migration projects table: no auto_pull column.
  raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      root TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      pinned_at TEXT
    );
    INSERT INTO projects (id, title, root, created_at, updated_at)
    VALUES ('p1', 'Old', '/old', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);

  applySchema(wrap(raw));

  const columns = raw
    .prepare('PRAGMA table_info(projects)')
    .all()
    .map((column) => (column as { name: string }).name);
  assert.ok(columns.includes('auto_pull'));

  const row = raw.prepare('SELECT auto_pull FROM projects WHERE id = ?').get('p1') as {
    auto_pull: number;
  };
  assert.equal(row.auto_pull, 0, 'an upgrade never opts a project in on its own');

  // Idempotent: a second apply is a no-op, not a duplicate-column error.
  applySchema(wrap(raw));
});

test('applySchema on an empty projects table still gains the column', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-autopull-empty-'));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  t.after(() => raw.close());
  raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      root TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      pinned_at TEXT
    );
  `);
  applySchema(wrap(raw));
  const columns = raw
    .prepare('PRAGMA table_info(projects)')
    .all()
    .map((column) => (column as { name: string }).name);
  assert.ok(columns.includes('auto_pull'));
});
