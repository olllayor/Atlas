import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync
} from 'node:fs';

/**
 * Shared filesystem-containment primitive.
 *
 * A path that is lexically inside a root is not necessarily *on disk* inside
 * that root: any segment along the way can be a symlink, and string
 * inspection (`resolve` + `relative` + a `..` check) cannot see that. Every
 * function here proves containment against the real, symlink-resolved
 * location instead of the spelled one — and `containedRead` goes one step
 * further and proves the file it *reads* is the file it *checked*, because
 * checking a path and then opening that same path again is two lookups with
 * a window between them for the target to change.
 */

export type ContainedFsFailure =
  | 'invalid-path'
  | 'not-found'
  | 'outside-root'
  | 'not-regular-file'
  | 'disallowed-extension'
  | 'changed-during-read'
  | 'read-failed';

export type ContainedReadResult =
  | { ok: true; path: string; contents: string; truncated: boolean }
  | { ok: false; reason: ContainedFsFailure; path: string; cause?: unknown };

export type ContainedReadBufferResult =
  | { ok: true; path: string; buffer: Buffer; truncated: boolean }
  | { ok: false; reason: ContainedFsFailure; path: string; cause?: unknown };

/**
 * Realpaths `root` itself before comparing anything against it.
 *
 * `$TMPDIR` on macOS is itself a symlink (`/var` → `/private/var`), so every
 * fixture that lives under it — which is most of them — would otherwise fail
 * containment against its own root. Resolving both sides is what makes the
 * comparison mean anything.
 */
function realRoot(root: string): string | null {
  try {
    return realpathSync(resolve(root));
  } catch {
    return null;
  }
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

/**
 * Resolve `candidate` (root-relative or already-absolute) and prove the REAL
 * path is inside `root`. Realpaths the leaf itself, not only its parent: a
 * symlink named like an ordinary file inside a contained directory must not
 * escape.
 *
 * `target` is built from the *lexical* root, not the realpathed one: `root`
 * itself may reach the same place through a symlinked prefix (`$TMPDIR` on
 * macOS is `/var/...` while its realpath is `/private/var/...`), and joining
 * an already-absolute `candidate` against a realpathed root would silently
 * ignore the root argument (`path.resolve` keeps only the rightmost absolute
 * segment) while comparing it against the realpathed one — two different
 * coordinate spaces that don't line up even for a path that is genuinely
 * inside root. `realpathSync` below resolves fully regardless of which
 * coordinate space `target` started in, so the final comparison is always
 * real-to-real.
 */
export function containedPath(root: string, candidate: string): string | null {
  const target = resolve(resolve(root), candidate);

  const resolvedRoot = realRoot(root);
  if (resolvedRoot == null) {
    return null;
  }

  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    return null;
  }

  return isWithin(resolvedRoot, real) ? real : null;
}

/**
 * Same as `containedPath`, for a path that may not exist yet (writes):
 * realpath the deepest existing ancestor, then re-join the remaining
 * segments and re-check.
 *
 * A not-yet-written file can't be realpathed — there's nothing there to
 * resolve — but every ancestor above it can be, and a symlink planted at any
 * of those levels (`./shared` pointing at `/etc`) is exactly what would let a
 * lexically-inside path land somewhere else on disk once the write happens.
 */
export function containedWritePath(root: string, candidate: string): string | null {
  const lexicalRoot = resolve(root);
  const target = resolve(lexicalRoot, candidate);

  // Lexical pre-check against the *unresolved* root, matching whatever
  // string-level containment the caller already computed — see the
  // `containedPath` comment above for why this can't use the realpathed root.
  const lexicalRel = relative(lexicalRoot, target);
  if (lexicalRel === '' || lexicalRel.startsWith('..') || isAbsolute(lexicalRel)) {
    return null;
  }

  const resolvedRoot = realRoot(root);
  if (resolvedRoot == null) {
    return null;
  }

  let existingAncestor = target;
  const pendingSegments: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      // Walked off the filesystem root without finding anything real.
      return null;
    }
    pendingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }

  let realAncestor: string;
  try {
    realAncestor = realpathSync(existingAncestor);
  } catch {
    return null;
  }

  if (!isWithin(resolvedRoot, realAncestor)) {
    return null;
  }

  const rejoined = pendingSegments.length > 0 ? resolve(realAncestor, ...pendingSegments) : realAncestor;
  const finalRel = relative(resolvedRoot, rejoined);

  return finalRel === '' || finalRel.startsWith('..') || isAbsolute(finalRel) ? null : rejoined;
}

type ContainedReadInput = {
  path: string;
  root?: string;
  byteCap: number;
  allowedExtensions?: readonly string[];
};

/**
 * Read at most `byteCap` bytes of `path` with an open-then-verify sequence:
 * open → fstat (must be a regular file) → realpath the leaf → lstat that real
 * path → compare its inode/device against the open descriptor's → read.
 *
 * Re-checking a path string after some earlier check races against whatever
 * can swap the target in between; comparing the descriptor we're about to
 * read from against the inode the path currently names cannot, because the
 * descriptor was already open before the swap could happen. `root` is
 * optional: omitting it means "no confinement," for callers (arbitrary
 * absolute-path reads) where that is the intended behaviour, not an oversight.
 *
 * Over-cap reads TRUNCATE and set `truncated: true` — a large file is not an
 * error. Returns raw bytes; use `containedRead` instead when the caller wants
 * decoded text.
 */
export function containedReadBuffer(input: ContainedReadInput): ContainedReadBufferResult {
  const { path, root, byteCap, allowedExtensions } = input;

  if (!isAbsolute(path)) {
    return { ok: false, reason: 'invalid-path', path };
  }

  if (allowedExtensions && !allowedExtensions.includes(extname(path).toLowerCase())) {
    return { ok: false, reason: 'disallowed-extension', path };
  }

  let resolvedRoot: string | null = null;
  if (root) {
    resolvedRoot = realRoot(root);
    if (resolvedRoot == null) {
      return { ok: false, reason: 'outside-root', path };
    }
  }

  let fd: number;
  try {
    // `O_NONBLOCK` is what makes the regular-file check below reachable at
    // all. Opening a FIFO read-only *blocks until a writer appears* — with a
    // plain `'r'` the process hangs inside `openSync` and never reaches the
    // `fstat` that would have rejected it, which on the Electron main thread
    // means the whole app stops. Non-blocking open returns a descriptor
    // immediately, and `fstat` then rejects anything that isn't a regular
    // file. On a regular file the flag is a no-op.
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException)?.code;
    return { ok: false, reason: code === 'ENOENT' ? 'not-found' : 'read-failed', path, cause };
  }

  try {
    const opened = fstatSync(fd);

    if (!opened.isFile()) {
      return { ok: false, reason: 'not-regular-file', path };
    }

    let real: string;
    try {
      real = realpathSync(path);
    } catch (cause) {
      return { ok: false, reason: 'not-found', path, cause };
    }

    if (resolvedRoot && !isWithin(resolvedRoot, real)) {
      return { ok: false, reason: 'outside-root', path };
    }

    let onDisk;
    try {
      onDisk = lstatSync(real);
    } catch (cause) {
      return { ok: false, reason: 'read-failed', path, cause };
    }

    if (onDisk.ino !== opened.ino || onDisk.dev !== opened.dev) {
      return { ok: false, reason: 'changed-during-read', path };
    }

    // Allocate for the file, not for the cap: a 20 MiB binary cap would
    // otherwise mean a 20 MiB allocation to read a 200-byte icon. A reported
    // size of 0 is not trusted as "empty" — synthetic files (procfs and
    // friends) report 0 and still yield bytes — so those fall back to the cap.
    const readCap = opened.size > 0 ? Math.min(opened.size, byteCap) : byteCap;
    const buffer = Buffer.allocUnsafe(readCap);
    const bytesRead = readSync(fd, buffer, 0, readCap, 0);
    const truncated = opened.size > bytesRead;

    return { ok: true, path: real, buffer: buffer.subarray(0, bytesRead), truncated };
  } catch (cause) {
    return { ok: false, reason: 'read-failed', path, cause };
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Nothing useful to do with a failed close.
    }
  }
}

/**
 * Text-decoding wrapper over `containedReadBuffer`. Trailing partial UTF-8
 * sequences (cutting a multibyte character at the byte cap) are trimmed
 * rather than left as replacement characters the file never contained.
 */
export function containedRead(input: ContainedReadInput): ContainedReadResult {
  const result = containedReadBuffer(input);

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    path: result.path,
    contents: result.buffer.toString('utf8').replace(/�+$/u, ''),
    truncated: result.truncated
  };
}
