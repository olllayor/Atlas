import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  gitBranchToolExecute,
  gitCommitToolExecute,
  gitLogToolExecute,
  gitStashToolExecute
} from '../src/main/ai/tools/gitTools.js';
import { GitStateService } from '../src/main/workspace/GitStateService.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

function makeGitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-git-test-'));
  execSync('git init -b main', { cwd: root });
  execSync('git config user.name "Test User"', { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });
  writeFileSync(join(root, 'README.md'), '# Initial Commit\n');
  execSync('git add -A && git commit -m "initial commit"', { cwd: root });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('GitStateService detects branch, status, log, and branches', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const gitService = new GitStateService();

    assert.equal(gitService.isGitRepo(root), true);

    const branch = await gitService.getBranch(root);
    assert.equal(branch, 'main');

    writeFileSync(join(root, 'NEW_FILE.txt'), 'hello');
    const status = await gitService.getStatus(root);
    assert.ok(status.some((s) => s.path.includes('NEW_FILE.txt')));

    const log = await gitService.getLog(root);
    assert.equal(log.length, 1);
    assert.equal(log[0].message, 'initial commit');

    const branches = await gitService.getBranches(root);
    assert.ok(branches.some((b) => b.name === 'main' && b.current));
  } finally {
    cleanup();
  }
});

test('git_log tool executes log query on workspace', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const workspace: ToolWorkspace = { mode: 'code', root };
    const output = await gitLogToolExecute({ maxCount: 5 }, workspace);
    assert.ok(output.includes('initial commit'));
  } finally {
    cleanup();
  }
});

test('git_branch tool creates, switches, and lists branches', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const workspace: ToolWorkspace = { mode: 'code', root };

    await gitBranchToolExecute({ action: 'create', name: 'feature-1' }, workspace);
    let list = await gitBranchToolExecute({ action: 'list' }, workspace);
    assert.ok(list.includes('feature-1'));

    await gitBranchToolExecute({ action: 'switch', name: 'feature-1' }, workspace);
    const gitService = new GitStateService();
    assert.equal(await gitService.getBranch(root), 'feature-1');
  } finally {
    cleanup();
  }
});

test('git_commit tool creates a new commit', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const workspace: ToolWorkspace = { mode: 'code', root };
    writeFileSync(join(root, 'file.txt'), 'content');

    const result = await gitCommitToolExecute({ message: 'add file', addAll: true }, workspace);
    assert.ok(result.includes('add file') || result.includes('Committed'));

    const gitService = new GitStateService();
    const log = await gitService.getLog(root);
    assert.equal(log[0].message, 'add file');
  } finally {
    cleanup();
  }
});

test('GitStateService switches, creates branches and commits from the UI path', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const gitService = new GitStateService();

    await gitService.createBranch(root, 'feature-ui');
    assert.equal(await gitService.getBranch(root), 'feature-ui');

    await gitService.switchBranch(root, 'main');
    assert.equal(await gitService.getBranch(root), 'main');

    writeFileSync(join(root, 'ui.txt'), 'from the commit dialog');
    const output = await gitService.commit(root, { message: 'ui commit', addAll: true });
    assert.ok(output.length > 0);

    const log = await gitService.getLog(root);
    assert.equal(log[0]!.message, 'ui commit');
  } finally {
    cleanup();
  }
});

test('GitStateService refuses branch names that would be read as git flags', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const gitService = new GitStateService();
    await assert.rejects(() => gitService.switchBranch(root, '--force'), /cannot start with/);
  } finally {
    cleanup();
  }
});

test('a remote-listed branch name is switched to as its local name', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const gitService = new GitStateService();
    await gitService.createBranch(root, 'shared');
    await gitService.switchBranch(root, 'main');

    // What `git branch -a` prints for a remote branch; `git switch` only
    // accepts the trailing local name.
    await gitService.switchBranch(root, 'remotes/origin/shared');
    assert.equal(await gitService.getBranch(root), 'shared');
  } finally {
    cleanup();
  }
});

test('ahead/behind is null when the branch has no upstream', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const gitService = new GitStateService();
    assert.deepEqual(await gitService.getAheadBehind(root), { ahead: null, behind: null });
  } finally {
    cleanup();
  }
});
