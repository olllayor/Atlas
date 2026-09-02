/**
 * The workspace's file list, for the right panel's Files surface.
 *
 * One flat list per root rather than a directory walk per expanded folder:
 * the renderer builds the tree and filters it locally, so opening a folder or
 * typing in the search box costs nothing. That is the same trade t3code makes
 * (`apps/server/src/workspace/WorkspaceSearchIndex.ts`), and the caps below
 * are theirs — a repository big enough to blow past them is one where a
 * complete tree was never going to be the useful view anyway.
 *
 * Listing goes through `rg --files`, which Atlas already requires for the
 * agent's `grep_search` and `glob_search` tools. That buys real `.gitignore`
 * semantics for free: a Files panel that showed `node_modules` would be a
 * Files panel nobody scrolls.
 */

import { resolve } from 'node:path';

import { containedReadBuffer } from '../security/containedFs';
import type {
  WorkspaceEntriesResult,
  WorkspaceFileFailure,
  WorkspaceFileResult,
} from '../../shared/contracts';
import { runCommand } from '../ai/tools/toolRuntime';
import { buildEntries, normalizeRelativePath } from './workspaceEntries';

/** Past this the tree stops being something a person reads. */
const MAX_ENTRIES = 25_000;
const SCAN_TIMEOUT_MS = 15_000;
/**
 * A listing this old is re-scanned on the next request. Files change under
 * the panel constantly — the agent is editing them — so the cache exists to
 * collapse the burst of calls around opening a folder, not to hold a picture
 * of the repository for minutes.
 */
const CACHE_TTL_MS = 30_000;
/** Enough for any source file; a viewer is not the tool for a 2MB blob. */
const FILE_BYTE_CAP = 2 * 1024 * 1024;
/** A NUL in the first chunk of a file means it is not text. */
const BINARY_SNIFF_BYTES = 8_000;
/** Room for `MAX_ENTRIES` paths with long names, and then some. */
const SCAN_OUTPUT_BYTE_BUDGET = 16 * 1024 * 1024;

type CacheEntry = {
  result: WorkspaceEntriesResult;
  expiresAt: number;
};

export class WorkspaceIndex {
  private readonly cache = new Map<string, CacheEntry>();
  /** Scans in flight, so five folder clicks share one `rg`. */
  private readonly inflight = new Map<string, Promise<WorkspaceEntriesResult>>();

  constructor(private readonly now: () => number = Date.now) {}

  async list(root: string, options?: { refresh?: boolean }): Promise<WorkspaceEntriesResult> {
    if (options?.refresh) {
      this.cache.delete(root);
    } else {
      const cached = this.cache.get(root);
      if (cached && cached.expiresAt > this.now()) return cached.result;
    }

    const existing = this.inflight.get(root);
    if (existing) return existing;

    const scan = this.scan(root)
      .then((result) => {
        this.cache.set(root, { result, expiresAt: this.now() + CACHE_TTL_MS });
        return result;
      })
      .finally(() => {
        this.inflight.delete(root);
      });

    this.inflight.set(root, scan);
    return scan;
  }

  /** The conversation's project changed, or the panel asked for a fresh scan. */
  forget(root: string) {
    this.cache.delete(root);
  }

  private async scan(root: string): Promise<WorkspaceEntriesResult> {
    // `--hidden` because dotfiles are most of what a person opens this panel
    // for; `.git` is excluded by name because it is the one hidden directory
    // nobody wants and `.gitignore` never lists it.
    const result = await runCommand(
      'rg',
      ['--files', '--hidden', '--glob', '!.git', '--glob', '!.git/**'],
      {
        cwd: root,
        timeoutMs: SCAN_TIMEOUT_MS,
        // `runCommand`'s default ingest budget is sized for tool output a
        // model reads. A path list at the cap is several megabytes of
        // perfectly ordinary data, and silently losing its tail would show a
        // tree that is simply missing files.
        maxOutputBytes: SCAN_OUTPUT_BYTE_BUDGET,
      }
    );

    // 1 is ripgrep's "no matches", which for `--files` means an empty folder.
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(
        result.stderr.trim() || `Could not list files in this workspace (rg exited ${result.code ?? 'unknown'}).`
      );
    }

    const files = result.stdout
      .split('\n')
      .map((line) => normalizeRelativePath(line))
      .filter((line): line is string => line !== null);

    return buildEntries(files, MAX_ENTRIES);
  }

  /**
   * One file's text. Containment, the regular-file check and the open-then-
   * verify read all come from `containedFs`; this only adds the binary sniff
   * and the workspace-relative shape the panel speaks in.
   */
  read(root: string, relativePath: string): WorkspaceFileResult {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
      return { ok: false, relativePath, failure: 'outside-root' };
    }

    // Resolved lexically and handed to `containedReadBuffer`, which proves
    // containment against the *real* path after opening it. Going through
    // `containedPath` first would collapse "outside the workspace" and "no
    // longer on disk" into one answer, and the panel says different things
    // about those two.
    const read = containedReadBuffer({
      path: resolve(root, normalized),
      root,
      byteCap: FILE_BYTE_CAP,
    });
    if (!read.ok) {
      return { ok: false, relativePath: normalized, failure: readFailure(read.reason) };
    }

    if (looksBinary(read.buffer)) {
      return { ok: false, relativePath: normalized, failure: 'binary' };
    }

    return {
      ok: true,
      relativePath: normalized,
      // Trailing partial UTF-8 from the byte cap would render as replacement
      // characters the file never contained.
      contents: read.buffer.toString('utf8').replace(/�+$/u, ''),
      byteLength: read.buffer.byteLength,
      truncated: read.truncated,
    };
  }
}

function readFailure(reason: string): WorkspaceFileFailure {
  switch (reason) {
    case 'not-found':
      return 'not-found';
    case 'not-regular-file':
      return 'not-a-file';
    case 'outside-root':
    case 'invalid-path':
      return 'outside-root';
    default:
      return 'read-failed';
  }
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.byteLength, BINARY_SNIFF_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}
