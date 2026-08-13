import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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