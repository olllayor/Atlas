import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GitReviewService } from '../src/main/workspace/GitReviewService.js';
import { formatReviewComments, parseReviewDiff, summariseReview } from '../src/shared/review.js';

/** A plain runner, so the tests do not pull in the tool sandbox. */
function run(command: string, args: string[], options: { cwd?: string } = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-review-test-'));

  await run('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await run('git', ['config', 'user.email', 'test@atlas.local'], { cwd: root });
  await run('git', ['config', 'user.name', 'Atlas Test'], { cwd: root });
  await run('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });

  return root;
}

// A file with two well-separated regions, so edits at both ends produce two
// hunks rather than one merged one at the default -U3.
const BASE_FILE = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');

test('parseReviewDiff splits files and hunks and keeps each hunk applyable', () => {
  const output = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,3 @@',
    ' context',
    '-old line',
    '+new line',
    '@@ -20,2 +20,3 @@',
    ' tail',
    '+added tail',
    'diff --git a/src/b.ts b/src/b.ts',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/src/b.ts',
    '@@ -0,0 +1,1 @@',
    '+hello',
    ''
  ].join('\n');

  const files = parseReviewDiff(output);

  assert.equal(files.length, 2);
  assert.equal(files[0]!.path, 'src/a.ts');
  assert.equal(files[0]!.status, 'modified');
  assert.equal(files[0]!.hunks.length, 2);
  assert.equal(files[0]!.added, 2);
  assert.equal(files[0]!.removed, 1);

  // Each hunk patch carries the file headers, so it stands alone.
  const first = files[0]!.hunks[0]!.patch;
  assert.ok(first.startsWith('diff --git a/src/a.ts b/src/a.ts\n'));
  assert.ok(first.includes('--- a/src/a.ts'));
  assert.ok(first.includes('@@ -1,3 +1,3 @@'));
  assert.ok(!first.includes('@@ -20,2 +20,3 @@'), 'must not carry the other hunk');
  assert.ok(first.endsWith('\n'), 'git apply rejects an unterminated patch');

  assert.equal(files[1]!.status, 'added');
  assert.equal(files[1]!.path, 'src/b.ts');

  assert.deepEqual(summariseReview(files), { files: 2, added: 3, removed: 1 });
});

test('parseReviewDiff reads renames and deletions', () => {
  const output = [
    'diff --git a/old.ts b/new.ts',
    'similarity index 90%',
    'rename from old.ts',
    'rename to new.ts',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    'index 4444444..0000000',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-bye',
    ''
  ].join('\n');

  const files = parseReviewDiff(output);

  assert.equal(files[0]!.status, 'renamed');
  assert.equal(files[0]!.path, 'new.ts');
  assert.equal(files[0]!.previousPath, 'old.ts');

  assert.equal(files[1]!.status, 'deleted');
  assert.equal(files[1]!.path, 'gone.ts');
  assert.equal(files[1]!.removed, 1);
});

test('parseReviewDiff returns nothing for an empty diff', () => {
  assert.deepEqual(parseReviewDiff(''), []);
  assert.deepEqual(parseReviewDiff('\n  \n'), []);
});

test('comments become a location-anchored follow-up message', () => {
  const text = formatReviewComments([
    { id: '1', path: 'src/a.ts', line: 12, code: '  const x = y!', body: 'Drop the non-null assertion.' },
    { id: '2', path: 'src/a.ts', line: 3, code: 'import z', body: 'Unused.' },
    { id: '3', path: 'src/b.ts', line: null, code: '', body: 'This whole file duplicates a.ts.' }
  ]);

  // Sorted by line within a file, so the message reads top-to-bottom.
  assert.ok(text.indexOf('src/a.ts:3') < text.indexOf('src/a.ts:12'));
  assert.ok(text.includes('> const x = y!'));
  assert.ok(text.includes('- src/b.ts\n'), 'a file-level comment has no line suffix');
  assert.equal(formatReviewComments([]), '');
});

test('a hunk patch stages exactly its own hunk', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), `${BASE_FILE}\n`, 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });

  // Two edits, 30 lines apart — two hunks.
  const edited = BASE_FILE.replace('line 2', 'line 2 CHANGED').replace('line 38', 'line 38 CHANGED');
  await writeFile(join(root, 'src/app.ts'), `${edited}\n`, 'utf8');

  const service = new GitReviewService({ run });
  const diff = await service.review(root, 'unstaged');

  assert.equal(diff.files.length, 1);
  const file = diff.files[0]!;
  assert.equal(file.path, 'src/app.ts');
  assert.equal(file.hunks.length, 2, 'the two edits must be separate hunks');

  await service.applyPatch(root, file.hunks[0]!.patch, { cached: true });

  const staged = await service.review(root, 'staged');
  assert.equal(staged.files.length, 1);
  assert.equal(staged.files[0]!.added, 1, 'only the first hunk is staged');
  assert.ok(staged.files[0]!.patch.includes('line 2 CHANGED'));
  assert.ok(!staged.files[0]!.patch.includes('line 38 CHANGED'));

  // The working tree still holds both edits.
  const onDisk = await readFile(join(root, 'src/app.ts'), 'utf8');
  assert.ok(onDisk.includes('line 2 CHANGED'));
  assert.ok(onDisk.includes('line 38 CHANGED'));
});

test('reverting a hunk restores only those lines on disk', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'app.ts'), `${BASE_FILE}\n`, 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });

  const edited = BASE_FILE.replace('line 2', 'line 2 CHANGED').replace('line 38', 'line 38 CHANGED');
  await writeFile(join(root, 'app.ts'), `${edited}\n`, 'utf8');

  const service = new GitReviewService({ run });
  const diff = await service.review(root, 'unstaged');

  await service.applyPatch(root, diff.files[0]!.hunks[0]!.patch, { reverse: true });

  const onDisk = await readFile(join(root, 'app.ts'), 'utf8');
  assert.ok(!onDisk.includes('line 2 CHANGED'), 'the reverted hunk is gone');
  assert.ok(onDisk.includes('line 38 CHANGED'), 'the other hunk survives');
});

test('untracked files appear in the unstaged scope as additions', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'seed.txt'), 'seed\n', 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });

  await writeFile(join(root, 'brand-new.ts'), 'export const value = 1;\n', 'utf8');

  const service = new GitReviewService({ run });
  const diff = await service.review(root, 'unstaged');

  const added = diff.files.find((file) => file.path === 'brand-new.ts');
  assert.ok(added, 'an untracked file is part of "what is in front of me"');
  assert.equal(added!.status, 'added');
  assert.equal(added!.added, 1);
});

test('reverting an untracked file deletes it, since there is nothing to restore', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'seed.txt'), 'seed\n', 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });

  await writeFile(join(root, 'scratch.ts'), 'throwaway\n', 'utf8');

  const service = new GitReviewService({ run });
  await service.revert(root, ['scratch.ts']);

  await assert.rejects(() => readFile(join(root, 'scratch.ts'), 'utf8'));
  // The committed file is untouched by an unrelated revert.
  assert.equal(await readFile(join(root, 'seed.txt'), 'utf8'), 'seed\n');
});

test('stage and unstage move a file between the two scopes', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'a.ts'), 'one\n', 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });
  await writeFile(join(root, 'a.ts'), 'two\n', 'utf8');

  const service = new GitReviewService({ run });

  await service.stage(root, ['a.ts']);
  assert.equal((await service.review(root, 'staged')).files.length, 1);
  assert.equal((await service.review(root, 'unstaged')).files.length, 0);

  await service.unstage(root, ['a.ts']);
  assert.equal((await service.review(root, 'staged')).files.length, 0);
  assert.equal((await service.review(root, 'unstaged')).files.length, 1);
});

test('the branch scope explains itself when there is no base to compare with', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'a.ts'), 'one\n', 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });
  await run('git', ['switch', '-qc', 'feature'], { cwd: root });

  const service = new GitReviewService({ run });

  // `main` exists here, so it is found even without an `origin/HEAD`.
  assert.equal(await service.resolveBaseBranch(root), 'main');

  await writeFile(join(root, 'a.ts'), 'two\n', 'utf8');
  await run('git', ['commit', '-qam', 'change'], { cwd: root });

  const diff = await service.review(root, 'branch');
  assert.equal(diff.subject, 'main');
  assert.equal(diff.files.length, 1);
});

test('the commit scope shows one commit, and asks for one when given none', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'a.ts'), 'one\n', 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'first'], { cwd: root });
  await writeFile(join(root, 'a.ts'), 'two\n', 'utf8');
  await run('git', ['commit', '-qam', 'second'], { cwd: root });

  const service = new GitReviewService({ run });

  const empty = await service.review(root, 'commit');
  assert.equal(empty.files.length, 0);
  assert.ok(empty.emptyReason);

  const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const diff = await service.review(root, 'commit', { commit: head });

  assert.equal(diff.files.length, 1);
  assert.equal(diff.files[0]!.added, 1);
  assert.equal(diff.files[0]!.removed, 1);
});

test('a hunk that no longer matches the working tree fails loudly', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'a.ts'), `${BASE_FILE}\n`, 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });
  await writeFile(join(root, 'a.ts'), BASE_FILE.replace('line 2', 'line 2 CHANGED') + '\n', 'utf8');

  const service = new GitReviewService({ run });
  const diff = await service.review(root, 'unstaged');
  const patch = diff.files[0]!.hunks[0]!.patch;

  // The file moves on underneath the captured patch — the edit the patch
  // wanted to undo is not there any more.
  await writeFile(join(root, 'a.ts'), 'totally different\n', 'utf8');

  await assert.rejects(
    () => service.applyPatch(root, patch, { reverse: true }),
    'reverting a hunk that is no longer on disk must not half-apply'
  );
});

/**
 * Staging is applied to the index, so working-tree drift does not invalidate
 * it — worth pinning down, because the opposite assumption is the natural one
 * and it is what makes "stage this hunk" safe to leave on screen while the
 * assistant keeps editing.
 */
test('staging a hunk is unaffected by later working-tree edits', async (t) => {
  const root = await makeRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'a.ts'), `${BASE_FILE}\n`, 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'base'], { cwd: root });
  await writeFile(join(root, 'a.ts'), BASE_FILE.replace('line 2', 'line 2 CHANGED') + '\n', 'utf8');

  const service = new GitReviewService({ run });
  const patch = (await service.review(root, 'unstaged')).files[0]!.hunks[0]!.patch;

  await writeFile(join(root, 'a.ts'), `${BASE_FILE.replace('line 2', 'line 2 CHANGED')}\nappended\n`, 'utf8');
  await service.applyPatch(root, patch, { cached: true });

  const staged = await service.review(root, 'staged');
  assert.ok(staged.files[0]!.patch.includes('line 2 CHANGED'));
});
