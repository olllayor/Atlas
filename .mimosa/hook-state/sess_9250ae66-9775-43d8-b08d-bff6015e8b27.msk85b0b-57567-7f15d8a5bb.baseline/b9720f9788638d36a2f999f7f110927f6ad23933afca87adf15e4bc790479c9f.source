import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseReviewDiff } from '../src/shared/review.js';

/**
 * R2 — the composed review patches must be `git apply`-able.
 *
 * `parseReviewDiff` slices `git diff` output into per-file and per-hunk patches,
 * each carrying the file headers so a single hunk stands alone. That is the
 * promise the review pane's stage / unstage / revert rely on ("apply hunk 3" of
 * an ever-moving working tree). The trailing newline and the verbatim header
 * round-trip are the two things a naive re-serialisation breaks, and a patch
 * that has been through a lossy round trip is one `git apply` silently rejects.
 *
 * These tests prove the guarantee against a real repository: every composed
 * patch — the whole file and each individual hunk — passes `git apply --check`
 * when applied to the correct base tree.
 */

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
  const root = await mkdtemp(join(tmpdir(), 'atlas-apply-test-'));

  await run('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await run('git', ['config', 'user.email', 'test@atlas.local'], { cwd: root });
  await run('git', ['config', 'user.name', 'Atlas Test'], { cwd: root });
  await run('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });

  return root;
}

/** A file with two well-separated regions, so edits at both ends produce two hunks. */
const BASE_FILE = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');

async function checkPatch(repo: string, patch: string): Promise<number | null> {
  const patchPath = join(repo, '.atlas-roundtrip.patch');
  await writeFile(patchPath, patch);
  const result = await run('git', ['apply', '--check', patchPath], { cwd: repo });
  await rm(patchPath, { force: true });
  return result.code;
}

test('whole-file and per-hunk patches for a modified file pass git apply --check', async () => {
  const repo = await makeRepo();

  try {
    const srcDir = join(repo, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'a.ts'), BASE_FILE);
    await run('git', ['add', '.'], { cwd: repo });
    await run('git', ['commit', '-q', '-m', 'base'], { cwd: repo });

    // Two edits far enough apart to stay two hunks.
    const NEW_FILE = BASE_FILE.replace('line 1', 'line 1 changed').replace('line 20', 'line 20 changed');
    await writeFile(join(srcDir, 'a.ts'), NEW_FILE);

    const { stdout: rawDiff } = await run('git', ['diff'], { cwd: repo });
    const files = parseReviewDiff(rawDiff);
    const fileA = files.find((f) => f.path === 'src/a.ts');

    assert.equal(files.length, 1);
    assert.ok(fileA, 'modified file parsed');
    assert.equal(fileA!.hunks.length, 2, 'the two separated edits produce two hunks');

    // Wind the working tree back to the committed base, so --check sees "before".
    await run('git', ['checkout', '--', '.'], { cwd: repo });

    assert.equal(await checkPatch(repo, fileA!.patch), 0, 'whole-file patch applies');
    for (const hunk of fileA!.hunks) {
      assert.equal(await checkPatch(repo, hunk.patch), 0, `hunk ${hunk.header} applies on its own`);
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('an added-file patch passes git apply --check', async () => {
  const repo = await makeRepo();

  try {
    await writeFile(join(repo, 'keep.txt'), 'x\n');
    await run('git', ['add', '.'], { cwd: repo });
    await run('git', ['commit', '-q', '-m', 'base'], { cwd: repo });

    await writeFile(join(repo, 'b.ts'), 'hello\n');
    await run('git', ['add', join(repo, 'b.ts')], { cwd: repo });

    const { stdout: cachedDiff } = await run('git', ['diff', '--cached'], { cwd: repo });
    const files = parseReviewDiff(cachedDiff);
    const added = files.find((f) => f.path === 'b.ts');

    assert.equal(files.length, 1);
    assert.ok(added, 'a staged add is parsed as a file');
    assert.equal(added!.status, 'added');

    // Take the file out of the tree so the patch has something to create.
    await rm(join(repo, 'b.ts'));
    await run('git', ['reset', '-q'], { cwd: repo });

    assert.equal(await checkPatch(repo, added!.patch), 0, 'added-file patch applies');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

