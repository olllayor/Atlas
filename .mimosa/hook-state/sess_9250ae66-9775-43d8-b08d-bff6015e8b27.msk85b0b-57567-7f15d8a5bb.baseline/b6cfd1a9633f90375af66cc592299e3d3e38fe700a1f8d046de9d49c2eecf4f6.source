import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WorkspaceCheckpointService,
  checkpointRefName,
  parseNumstat
} from '../src/main/workspace/WorkspaceCheckpointService.js';

const CONVERSATION = 'conv-1';
const TURN = 'turn-1';

function makeGitRepo(options: { commit?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-checkpoint-test-'));
  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });

  if (options.commit !== false) {
    writeFileSync(join(root, 'README.md'), '# Initial\n');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\nnode_modules/\n');
    execSync('git add -A', { cwd: root });
    execSync('git commit -m initial', { cwd: root, stdio: 'ignore' });
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const git = (root: string, command: string) =>
  execSync(`git ${command}`, { cwd: root, encoding: 'utf8' });

test('numstat totals ignore binary markers but still count the file', () => {
  assert.deepEqual(parseNumstat('3\t1\ta.ts\n-\t-\tlogo.png\n'), {
    filesChanged: 2,
    linesAdded: 3,
    linesRemoved: 1
  });
  assert.deepEqual(parseNumstat(''), { filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
});

test('a capture leaves the index, the working tree and the branch list untouched', async () => {
  const { root, cleanup } = makeGitRepo();

  try {
    const service = new WorkspaceCheckpointService();

    // A representative dirty tree: staged, unstaged, untracked and ignored.
    writeFileSync(join(root, 'staged.ts'), 'export const a = 1;\n');
    execSync('git add staged.ts', { cwd: root });
    writeFileSync(join(root, 'README.md'), '# Changed\n');
    writeFileSync(join(root, 'untracked.ts'), 'export const b = 2;\n');
    writeFileSync(join(root, 'ignored.txt'), 'secret\n');

    const statusBefore = git(root, 'status --porcelain=v1');
    const indexBefore = readFileSync(join(root, '.git', 'index'));

    const captured = await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });

    assert.match(captured.commitSha, /^[0-9a-f]{40}$/);
    assert.equal(captured.refName, checkpointRefName(CONVERSATION, TURN, 'pre'));

    assert.equal(git(root, 'status --porcelain=v1'), statusBefore, 'status must be unchanged');
    assert.deepEqual(readFileSync(join(root, '.git', 'index')), indexBefore, 'index must be untouched');
    assert.equal(git(root, 'branch --list').includes('atlas'), false);
    assert.equal(git(root, 'tag --list').trim(), '');
    // A plain `git log` walks HEAD only, so the checkpoints stay out of the
    // history the user reads. `--all` means every ref under `refs/` and does
    // list them — that reachability is what stops gc from collecting them.
    assert.equal(git(root, 'log --oneline').includes('atlas checkpoint'), false);
    assert.ok(git(root, 'log --all --oneline').includes('atlas checkpoint'));

    // No scratch index is left behind.
    const leftovers = readdirSync(join(root, '.git')).filter((name) =>
      name.startsWith('atlas-checkpoint-index-')
    );
    assert.deepEqual(leftovers, []);
  } finally {
    cleanup();
  }
});

test('the captured tree holds untracked files but not ignored ones', async () => {
  const { root, cleanup } = makeGitRepo();

  try {
    const service = new WorkspaceCheckpointService();
    writeFileSync(join(root, 'untracked.ts'), 'export const b = 2;\n');
    writeFileSync(join(root, 'ignored.txt'), 'secret\n');

    const captured = await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });

    const listed = git(root, `ls-tree -r --name-only ${captured.treeSha}`);
    assert.ok(listed.includes('untracked.ts'));
    assert.ok(!listed.includes('ignored.txt'), 'ignored files must stay out of checkpoints');
  } finally {
    cleanup();
  }
});

test('a repository with no commits yet can still be checkpointed', async () => {
  const { root, cleanup } = makeGitRepo({ commit: false });

  try {
    const service = new WorkspaceCheckpointService();
    writeFileSync(join(root, 'first.ts'), 'export const a = 1;\n');

    const captured = await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });

    assert.equal(captured.headSha, null);
    assert.ok(git(root, `ls-tree -r --name-only ${captured.treeSha}`).includes('first.ts'));
  } finally {
    cleanup();
  }
});

test('a turn diff reports exactly what changed between the two captures', async () => {
  const { root, cleanup } = makeGitRepo();

  try {
    const service = new WorkspaceCheckpointService();
    const pre = await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });

    writeFileSync(join(root, 'README.md'), '# Initial\nsecond line\n');
    writeFileSync(join(root, 'added.ts'), 'export const c = 3;\n');

    const post = await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'post'
    });

    const diff = await service.diff(root, pre.commitSha, post.commitSha);
    assert.ok(diff.includes('added.ts'));
    assert.ok(diff.includes('second line'));

    const stat = await service.diffStat(root, pre.commitSha, post.commitSha);
    assert.equal(stat.filesChanged, 2);
    assert.equal(stat.linesAdded, 2);
  } finally {
    cleanup();
  }
});

test('reverting restores modified files, deletes created ones, and keeps the rest', async () => {
  const { root, cleanup } = makeGitRepo();

  try {
    const service = new WorkspaceCheckpointService();

    writeFileSync(join(root, 'keep.ts'), 'untouched\n');
    const pre = await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });

    // What a turn would do: change one file, create another, nest a third.
    writeFileSync(join(root, 'README.md'), '# Rewritten by the agent\n');
    writeFileSync(join(root, 'created.ts'), 'export const d = 4;\n');
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'deep.ts'), 'export const e = 5;\n');

    await service.revertTo(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      preTreeSha: pre.treeSha
    });

    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# Initial\n');
    assert.equal(existsSync(join(root, 'created.ts')), false, 'created files must be removed');
    assert.equal(existsSync(join(root, 'nested', 'deep.ts')), false);
    assert.equal(readFileSync(join(root, 'keep.ts'), 'utf8'), 'untouched\n');
  } finally {
    cleanup();
  }
});

test('a revert records an undo point so it can itself be undone', async () => {
  const { root, cleanup } = makeGitRepo();

  try {
    const service = new WorkspaceCheckpointService();
    const pre = await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });

    writeFileSync(join(root, 'created.ts'), 'export const d = 4;\n');

    const { undo } = await service.revertTo(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      preTreeSha: pre.treeSha
    });

    assert.equal(existsSync(join(root, 'created.ts')), false);

    // Rolling forward again from the undo point brings the file back.
    await service.revertTo(root, {
      conversationId: CONVERSATION,
      turnId: `${TURN}-redo`,
      preTreeSha: undo.treeSha
    });

    assert.equal(readFileSync(join(root, 'created.ts'), 'utf8'), 'export const d = 4;\n');
  } finally {
    cleanup();
  }
});

test('checkpoint refs are listable and deletable per conversation', async () => {
  const { root, cleanup } = makeGitRepo();

  try {
    const service = new WorkspaceCheckpointService();
    await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });
    await service.captureAndRelease(root, {
      conversationId: 'conv-2',
      turnId: 'turn-9',
      kind: 'pre'
    });

    const refs = await service.listRefs(root, CONVERSATION);
    assert.deepEqual(refs, [checkpointRefName(CONVERSATION, TURN, 'pre')]);

    await service.deleteRef(root, refs[0]!);
    assert.deepEqual(await service.listRefs(root, CONVERSATION), []);
    assert.equal((await service.listRefs(root, 'conv-2')).length, 1);
  } finally {
    cleanup();
  }
});

test('a folder that is not a repository is reported rather than thrown at', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-plain-'));

  try {
    const service = new WorkspaceCheckpointService();
    assert.equal(await service.isGitRepo(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('capturing does not rewrite the stat cache of an unrelated file', async () => {
  const { root, cleanup } = makeGitRepo();

  try {
    const service = new WorkspaceCheckpointService();
    const before = statSync(join(root, 'README.md')).mtimeMs;

    await service.captureAndRelease(root, {
      conversationId: CONVERSATION,
      turnId: TURN,
      kind: 'pre'
    });

    assert.equal(statSync(join(root, 'README.md')).mtimeMs, before);
  } finally {
    cleanup();
  }
});
