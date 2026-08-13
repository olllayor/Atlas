# T5 — TOCTOU-safe contained file reads

**Depends on:** nothing. **Independent of the agent work — ship it first.**
**Surface:** `src/main/security/` (new), `src/main/ai/tools/toolWorkspace.ts`, `src/main/ai/tools/toolRuntime.ts`, `src/main/plugins/PluginLoader.ts`, `tests/`.

## Why

t3code's `workflowScriptQuery.ts` is 124 lines of file read written like a security
boundary: realpath re-containment on the **leaf file** (not just its directory), an
extension allowlist, a size cap that truncates rather than fails, an open-then-verify
sequence that compares the opened descriptor's inode/dev against the path's, and tagged
failure reasons so callers can't confuse "denied" with "missing".

Auditing Atlas against that checklist turns up three real gaps:

1. **`resolveWorkspacePath` ([`toolWorkspace.ts:100`](../../../src/main/ai/tools/toolWorkspace.ts)) is lexical only.**
   It does `resolve` + `relative` + a `..` check, with no `realpath`. A symlink inside the
   attached project pointing at `~/.ssh` resolves lexically as *inside* the project, so the
   write-confinement check passes and the write lands outside. `PluginLoader.containedPath`
   already documents exactly this ("`./skills` may be a symlink to `/etc`, which no amount
   of string inspection can see") — the tool workspace never got the same treatment.
2. **`readToolExecute` reads are unbounded** ([`toolRuntime.ts:247`](../../../src/main/ai/tools/toolRuntime.ts)):
   `await readFile(filePath, 'utf8')` with no `isFile()` check and no cap. A FIFO stalls the
   Electron main process forever; a multi-gigabyte file OOMs it. Again, `PluginLoader.readCapped`
   already solves this — for plugins only.
3. **Nothing anywhere is TOCTOU-safe.** Every check happens on the path, then the read
   happens on the path again.

Note the framing: `read_file` taking an arbitrary absolute path is *intended* — Atlas is a
local-first client reading the user's own machine. This track is not about confining reads
to the project. It is about (a) making the *write/edit* confinement actually hold, and
(b) making every read survive hostile or pathological files.

## Deliverables

### 1. `src/main/security/containedFs.ts` (new)

Generalize the two good implementations already in `PluginLoader` into one primitive both
it and the tool layer use.

```ts
export type ContainedFsFailure =
  | 'invalid-path' | 'not-found' | 'outside-root'
  | 'not-regular-file' | 'disallowed-extension'
  | 'changed-during-read' | 'read-failed';

export type ContainedReadResult =
  | { ok: true; path: string; contents: string; truncated: boolean }
  | { ok: false; reason: ContainedFsFailure; path: string; cause?: unknown };

/**
 * Resolve `candidate` and prove the REAL path is inside `root`.
 * Realpaths the leaf itself, not only its parent: a symlink named like an
 * ordinary file inside a contained directory must not escape.
 */
export function containedPath(root: string, candidate: string): string | null;

/**
 * Same, for a path that may not exist yet (writes): realpath the deepest
 * existing ancestor, then re-join the remaining segments and re-check.
 */
export function containedWritePath(root: string, candidate: string): string | null;

/**
 * Read at most `byteCap` bytes with an open-then-verify sequence:
 *   open → fstat (must be a regular file) → lstat the resolved path →
 *   compare ino+dev → read.
 * Re-checking the path after open races against a swap; comparing the
 * descriptor's inode to the path's cannot. Over-cap reads TRUNCATE and set
 * `truncated: true` — a large file is not an error.
 * Trailing partial UTF-8 sequences are trimmed (copy the `replace(/�+$/u, '')`
 * handling already in PluginLoader.readCapped).
 */
export function containedRead(input: {
  path: string;
  root?: string;
  byteCap: number;
  allowedExtensions?: readonly string[];
}): ContainedReadResult;
```

Failures are **tagged reasons, never thrown Errors folded together**. `read-failed` is
reserved for genuine platform failures with the real cause attached — the containment
rejections get their own reasons so tests can assert which one fired.

### 2. Fix the write confinement

`resolveWorkspacePath` keeps its existing lexical checks and the `PROTECTED_PROJECT_PATH_NAMES`
rule, then adds `containedWritePath(root, target)`. A `null` result raises
`WorkspaceWriteError` with a message that names the symlink problem — the user needs to
understand *why* a path that looks inside their project was refused.

### 3. Bound tool reads

`readToolExecute`'s text and binary paths go through `containedRead` with **no `root`**
(no confinement — that is intentional) but with a byte cap and the regular-file check.
Suggested caps: 5 MiB text, 20 MiB binary/PDF/image; surface truncation in the tool result
text so the model knows it did not see the whole file. Same treatment for
`site_read_file` in `siteTools.ts`.

### 4. Dedupe

Rewrite `PluginLoader.containedPath` / `readCapped` as thin wrappers over the shared
primitive. Behaviour must not change — the existing plugin tests are the regression net.
This one file currently owns the only correct implementation in the codebase; move it
somewhere the rest of the app can reach it.

## Tests — `tests/containedFs.test.ts`

The critical discipline from the PR: **a containment test must assert the specific
reason.** A symlink-escape test that passes on `not-found` proves nothing — the link was
never exercised.

1. Reads a real file under root; `truncated === false`.
2. Rejects a relative path ⇒ `invalid-path`.
3. Rejects a path outside root ⇒ `outside-root`.
4. **Symlink inside root pointing outside ⇒ `outside-root`, asserted by name.** Fail test
   setup loudly if the symlink could not be created (an `EPERM` swallowed into a skip makes
   this test pass vacuously forever).
5. Directory ⇒ `not-regular-file`.
6. Extension not in the allowlist ⇒ `disallowed-extension`.
7. File larger than the cap ⇒ `ok: true`, `truncated: true`, exactly `byteCap` bytes.
8. `containedWritePath` accepts a not-yet-existing file in a real dir; rejects one whose
   parent dir is a symlink out of root.
9. Multibyte file cut at the cap does not end in replacement characters.
10. A `resolveWorkspacePath` regression test: symlink in project → outside ⇒ `WorkspaceWriteError`.

## Definition of done

`pnpm test` and `pnpm build` green; existing plugin-loader tests pass unmodified; the new
symlink-escape tests fail if you delete the `realpath` call (verify this by hand — a
containment test that still passes with containment removed is not a test).

## Coordination note

`src/main/plugins/*` has uncommitted in-flight work (blocklist, installer, update
service). Do the `PluginLoader` dedupe **last**, as a separate commit, or defer it — the
first three deliverables touch no plugin file.
