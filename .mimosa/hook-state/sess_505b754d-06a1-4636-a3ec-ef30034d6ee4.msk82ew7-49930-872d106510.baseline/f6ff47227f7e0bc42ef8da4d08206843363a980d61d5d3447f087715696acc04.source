import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { containedPath, containedRead, containedWritePath } from '../src/main/security/containedFs.js';
import { resolveWritablePath, WorkspaceWriteError } from '../src/main/ai/tools/toolWorkspace.js';

/**
 * Realpathed up front: `$TMPDIR` is itself a symlink on macOS
 * (`/var` -> `/private/var`), so an un-resolved root would never compare
 * equal to — or ever successfully contain — anything these functions return,
 * since they always compare against the *real* root.
 */
function makeRoot(prefix: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('containedRead reads a real file under root and reports no truncation', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  try {
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'hello world');

    const result = containedRead({ path: file, root, byteCap: 1024 });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.contents, 'hello world');
    assert.equal(result.ok && result.truncated, false);
  } finally {
    cleanup();
  }
});

test('containedRead rejects a relative path as invalid-path', () => {
  const result = containedRead({ path: 'relative/path.txt', byteCap: 1024 });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'invalid-path');
});

test('containedRead rejects a path outside root as outside-root', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  const outside = makeRoot('atlas-containedfs-outside-');
  try {
    const file = join(outside.root, 'secret.txt');
    writeFileSync(file, 'nope');

    const result = containedRead({ path: file, root, byteCap: 1024 });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'outside-root');
  } finally {
    cleanup();
    outside.cleanup();
  }
});

test('containedRead rejects a symlink inside root that points outside, by name', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  const outside = makeRoot('atlas-containedfs-outside-');
  try {
    const secretFile = join(outside.root, 'secret.txt');
    writeFileSync(secretFile, 'top secret');

    const linkPath = join(root, 'escape.txt');
    // No try/catch-and-skip here: if the platform refuses to create a
    // symlink, the test setup should fail loudly. A swallowed EPERM would
    // leave the containment check unexercised and this test passing for the
    // wrong reason — the exact failure mode a "reason: outside-root" (rather
    // than an accidental "not-found") assertion below is meant to rule out.
    symlinkSync(secretFile, linkPath);

    const result = containedRead({ path: linkPath, root, byteCap: 1024 });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'outside-root');
  } finally {
    cleanup();
    outside.cleanup();
  }
});

test('containedRead rejects a directory as not-regular-file', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  try {
    const dir = join(root, 'subdir');
    mkdirSync(dir);

    const result = containedRead({ path: dir, root, byteCap: 1024 });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'not-regular-file');
  } finally {
    cleanup();
  }
});

test('containedRead rejects an extension outside the allowlist', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  try {
    const file = join(root, 'script.exe');
    writeFileSync(file, 'binary-ish');

    const result = containedRead({ path: file, root, byteCap: 1024, allowedExtensions: ['.txt', '.md'] });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'disallowed-extension');
  } finally {
    cleanup();
  }
});

test('containedRead truncates a file larger than the cap instead of failing', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  try {
    const file = join(root, 'big.txt');
    writeFileSync(file, 'a'.repeat(5000));

    const result = containedRead({ path: file, root, byteCap: 1024 });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.truncated, true);
    assert.equal(result.ok && Buffer.byteLength(result.contents, 'utf8'), 1024);
  } finally {
    cleanup();
  }
});

test('containedWritePath accepts a not-yet-existing file under a real directory', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  try {
    // Neither `new/` nor `file.txt` exists yet; only `root` does.
    const target = join(root, 'new', 'file.txt');

    const result = containedWritePath(root, target);

    assert.equal(result, resolve(root, 'new', 'file.txt'));
  } finally {
    cleanup();
  }
});

test('containedWritePath rejects a target whose parent directory is a symlink out of root', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  const outside = makeRoot('atlas-containedfs-outside-');
  try {
    const linkedDir = join(root, 'shared');
    symlinkSync(outside.root, linkedDir, 'dir');

    const target = join(linkedDir, 'pwned.txt');
    const result = containedWritePath(root, target);

    assert.equal(result, null);
  } finally {
    cleanup();
    outside.cleanup();
  }
});

test('containedRead trims a multibyte character cut at the cap rather than leaving replacement characters', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  try {
    const file = join(root, 'multibyte.txt');
    // Each '€' is 3 bytes in UTF-8; a cap of 11 lands one byte into the
    // first one.
    const content = 'x'.repeat(10) + '€'.repeat(50);
    writeFileSync(file, content, 'utf8');

    const result = containedRead({ path: file, root, byteCap: 11 });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.truncated, true);
    assert.equal(result.ok && result.contents, 'x'.repeat(10));
    assert.equal(result.ok && /�/.test(result.contents), false);
  } finally {
    cleanup();
  }
});

test('resolveWritablePath refuses a write through a symlink that escapes the project (regression)', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  const outside = makeRoot('atlas-containedfs-outside-');
  try {
    symlinkSync(outside.root, join(root, 'escape'), 'dir');
    const workspace = { mode: 'code' as const, root };

    assert.throws(() => resolveWritablePath('escape/pwned.txt', workspace), WorkspaceWriteError);
    assert.throws(() => resolveWritablePath('escape/pwned.txt', workspace), /symlink/);
  } finally {
    cleanup();
    outside.cleanup();
  }
});

test('containedPath resolves a real path inside root and rejects a symlink escape', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-');
  const outside = makeRoot('atlas-containedfs-outside-');
  try {
    writeFileSync(join(root, 'inside.txt'), 'ok');
    assert.equal(containedPath(root, 'inside.txt'), resolve(root, 'inside.txt'));

    symlinkSync(outside.root, join(root, 'linked'), 'dir');
    assert.equal(containedPath(root, 'linked'), null);
  } finally {
    cleanup();
    outside.cleanup();
  }
});

/**
 * The FIFO case is the whole reason `containedRead` opens non-blocking.
 *
 * `open(2)` on a FIFO in read-only mode blocks until some process opens the
 * write end — with a plain blocking open this test would hang forever rather
 * than fail, and on the Electron main thread the same call would take the app
 * with it. The `O_NONBLOCK` flag is what lets the regular-file check run at
 * all; delete it and this test stops terminating.
 *
 * Guarded by a real `mkfifo`: if the platform has no such thing there is
 * nothing to defend against, but a *failing* `mkfifo` must not silently pass
 * the test either, so the skip is on the binary's absence only.
 */
test('containedRead rejects a FIFO without blocking', () => {
  const { root, cleanup } = makeRoot('atlas-containedfs-fifo-');
  try {
    const fifo = join(root, 'pipe');
    const made = spawnSync('mkfifo', [fifo]);

    if (made.error !== undefined && (made.error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    assert.equal(made.status, 0, `mkfifo failed: ${made.stderr?.toString() ?? ''}`);

    const result = containedRead({ path: fifo, root, byteCap: 1024 });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'not-regular-file');
  } finally {
    cleanup();
  }
});
