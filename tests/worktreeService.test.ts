import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { WorktreeService } from '../src/main/workspace/WorktreeService.js';

function makeGitRepo() {
  // Realpathed up front: $TMPDIR is itself a symlink on macOS
  // (`/var` -> `/private/var`), and git reports worktree paths realpathed, so a
  // symlinked root would never compare equal to what `git worktree list –porcelain`
  // returns.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-worktree-test-')));
  execSync('git init -b main', { cwd: root });
  execSync('git config user.name "Test User"', { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });
  writeFileSync(join(root, 'README.md'), '# Initial Commit\n');
  execSync('git add -A && git commit -m "initial commit"', { cwd: root });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const CONVERSATION_ID = '3f9ab2c1-1234-5678-90ab-cdef01234567';

test('provisionWorktree checks out a branch named exactly like the chip label', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();
    const wt = await service.provisionWorktree(root, CONVERSATION_ID);

    // Branch names use the full UUID to avoid 8-char prefix collisions across
    // conversations (see C2 fix). The renderer chip still shows the short form
    // via worktreeBranchShort() for compact display.
    assert.equal(wt.branch, `atlas/${CONVERSATION_ID}`);
    assert.ok(resolve(wt.path).startsWith(resolve(root)));

    const listed = await service.listWorktrees(root);
    assert.ok(listed.some((entry) => resolve(entry.path) === resolve(wt.path)));
  } finally {
    cleanup();
  }
});

test('removeWorktree prunes a live checkout from the list', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();
    const wt = await service.provisionWorktree(root, CONVERSATION_ID);

    await service.removeWorktree(root, { path: wt.path });

    const listed = await service.listWorktrees(root);
    assert.equal(listed.some((entry) => resolve(entry.path) === resolve(wt.path)), false);
  } finally {
    cleanup();
  }
});

test('removeWorktree is a no-op for a checkout already deleted out-of-band', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();
    const wt = await service.provisionWorktree(root, CONVERSATION_ID);

    // Simulate the stale-DB case: the folder vanished and git pruned it while
    // Atlas was closed or another tool cleaned up. The stored root must be
    // clearable without an error.
    rmSync(wt.path, { recursive: true, force: true });
    execSync('git worktree prune', { cwd: root });

    await service.removeWorktree(root, { path: wt.path }); // must not throw
  } finally {
    cleanup();
  }
});

test('removeWorktree refuses the main repository root', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();
    await assert.rejects(service.removeWorktree(root, { path: root }), /Cannot remove the main worktree/);
  } finally {
    cleanup();
  }
});

test('removeWorktree refuses a folder that exists but is not a worktree', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const orphan = join(root, 'not-a-worktree');
    mkdirSync(orphan);
    writeFileSync(join(orphan, 'junk.txt'), 'junk');

    const service = new WorktreeService();
    await assert.rejects(service.removeWorktree(root, { path: orphan }), /Failed to remove worktree/);
  } finally {
    cleanup();
  }
});

test('removeWorktree keeps the checkout when it holds uncommitted changes unless forced', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();
    const wt = await service.provisionWorktree(root, CONVERSATION_ID);
    writeFileSync(join(wt.path, 'dirty.txt'), 'uncommitted');

    // Default (no force): git refuses, the checkout survives.
    await assert.rejects(
      service.removeWorktree(root, { path: wt.path }),
      /Failed to remove worktree/
    );
    const afterRefusal = await service.listWorktrees(root);
    assert.ok(afterRefusal.some((entry) => resolve(entry.path) === resolve(wt.path)));

    // Explicit force: the checkout goes anyway.
    await service.removeWorktree(root, { path: wt.path, force: true });
    const listed = await service.listWorktrees(root);
    assert.equal(listed.some((entry) => resolve(entry.path) === resolve(wt.path)), false);
  } finally {
    cleanup();
  }
});
test('provisionWorktree starts from an explicit base branch', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    execSync('git checkout -b feature/base', { cwd: root });
    writeFileSync(join(root, 'feature.txt'), 'from feature');
    execSync('git add -A && git commit -m "feature commit"', { cwd: root });
    execSync('git checkout main', { cwd: root });

    const service = new WorktreeService();
    const wt = await service.provisionWorktree(root, CONVERSATION_ID, {
      baseBranch: 'feature/base',
    });

    const featureFile = join(wt.path, 'feature.txt');
    assert.equal(existsSync(featureFile), true, 'worktree checked out the base branch content');
    assert.equal(readFileSync(featureFile, 'utf8'), 'from feature');
    assert.equal(wt.branch, `atlas/${CONVERSATION_ID}`);
  } finally {
    cleanup();
  }
});

test('copyWorktreeIncludes carries gitignored files named by .worktreeinclude', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    writeFileSync(join(root, '.env'), 'SECRET=1\n');
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'local.json'), '{}');
    writeFileSync(
      join(root, '.worktreeinclude'),
      '# local-only files\n.env\nconfig/\n\n'
    );
    // .gitignore makes them ignored; tracked files would already be in the worktree.
    writeFileSync(join(root, '.gitignore'), '.env\nconfig/\n');

    const service = new WorktreeService();
    const wt = await service.provisionWorktree(root, CONVERSATION_ID);

    assert.equal(readFileSync(join(wt.path, '.env'), 'utf8'), 'SECRET=1\n');
    assert.equal(existsSync(join(wt.path, 'config', 'local.json')), true);
  } finally {
    cleanup();
  }
});

test('copyWorktreeIncludes is a no-op without a .worktreeinclude file', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();
    const copied = await service.copyWorktreeIncludes(root, root);
    assert.deepEqual(copied, []);
  } finally {
    cleanup();
  }
});

function gcRepo() {
  const repo = makeGitRepo();
  // A second commit so worktrees have distinct heads to snapshot.
  writeFileSync(join(repo.root, 'second.txt'), '2');
  execSync('git add -A && git commit -m "second"', { cwd: repo.root });
  return repo;
}

test('gc removes stale managed worktrees beyond retention, snapshots first, spares active ones', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();

    const staleA = await service.provisionWorktree(root, 'aaaa1111-1234-5678-90ab-cdef01234567');
    const staleB = await service.provisionWorktree(root, 'bbbb2222-1234-5678-90ab-cdef01234567');

    const result = await service.gcManagedWorktrees(root, {
      activePaths: [],
      retention: 1,
    });

    // Newest (staleB) survives the retention window; staleA is collected.
    assert.equal(result.removedPaths.length, 1);
    assert.ok(resolve(result.removedPaths[0]) === resolve(staleA.path));
    assert.deepEqual(result.snapshotBranches, ['atlas/wt-snapshot/aaaa1111-1234-5678-90ab-cdef01234567']);

    const listed = await service.listWorktrees(root);
    assert.equal(listed.some((entry) => resolve(entry.path) === resolve(staleA.path)), false);
    assert.equal(listed.some((entry) => resolve(entry.path) === resolve(staleB.path)), true);

    // The snapshot ref outlives both the checkout and its per-conversation branch.
    const branches = execSync('git branch --list "atlas/*"', { cwd: root, encoding: 'utf8' });
    assert.ok(branches.includes('atlas/wt-snapshot/aaaa1111-1234-5678-90ab-cdef01234567'));
    assert.equal(branches.includes(`atlas/aaaa1111`), false, 'collected conversation branch deleted');
  } finally {
    cleanup();
  }
});

test('gc never touches referenced or user-created worktrees', async () => {
  const { root, cleanup } = gcRepo();
  try {
    const service = new WorktreeService();

    const managed = await service.provisionWorktree(root, CONVERSATION_ID);
    // A user-made permanent worktree outside the managed directory.
    execSync('git branch feature/permanent', { cwd: root });
    await service.addWorktree(root, { path: join(root, 'permanent-wt'), branch: 'feature/permanent' });

    const result = await service.gcManagedWorktrees(root, {
      activePaths: [managed.path],
      retention: 0,
    });

    assert.deepEqual(result.removedPaths, []);
    const listed = await service.listWorktrees(root);
    assert.equal(listed.some((entry) => resolve(entry.path) === resolve(managed.path)), true);
    assert.equal(listed.some((entry) => entry.branch === 'feature/permanent'), true);
  } finally {
    cleanup();
  }
});
