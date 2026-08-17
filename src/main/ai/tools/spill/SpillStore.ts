import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Persists oversized tool outputs so the model's context sees a bounded
 * preview while the full text stays recoverable on disk.
 *
 * The design follows DeepSeek Harness's spill store: one directory per
 * conversation, unpredictable filenames, exclusive owner-only writes. A
 * predictable world-writable path would let another local process read
 * spilled tool output or pre-plant a symlink for the write to land on;
 * `open(..., 'wx', 0o600)` fails against any existing path — symlink or
 * not — so neither attack has a target.
 *
 * Spill files are an implementation detail of a conversation's turns:
 * they are deleted with the conversation and swept at startup when their
 * conversation no longer exists.
 */

export interface SaveTextSpillInput {
  /** The conversation whose turn produced the output. Scopes the directory. */
  conversationId: string;
  /** The tool whose result was spilled — used for a readable filename only. */
  toolName: string;
  /** The full text to persist (UTF-8). */
  content: string;
}

export interface SavedSpill {
  /** Absolute path — the locator quoted back to the model. */
  path: string;
  /** UTF-8 byte length of the stored content. */
  bytes: number;
}

/**
 * An append-only spill file opened for streaming writes. Used by producers
 * (a child process's stdout) that must bound memory by writing as data
 * arrives, rather than accumulating the full text and calling
 * {@link SpillStore.saveText} at the end.
 */
export interface SpillStream {
  /** Absolute path — the locator quoted back to the model. */
  path: string;
  /** Append one chunk (UTF-8). Serialized by the caller. */
  append(text: string): Promise<void>;
  /** Flush and close. Safe to call once. */
  end(): Promise<void>;
}

/**
 * Encode an arbitrary string as one filesystem-safe path segment.
 *
 * Conversation ids come from our own database and tool names from our own
 * registry, but both are treated as untrusted input anyway: this neutralizes
 * `../`, absolute paths, NUL and separators before any filesystem use.
 * Matches the per-segment `encodeURIComponent` convention the attachment
 * store already uses.
 */
function encodeSegment(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed) {
    return 'unknown';
  }

  const encoded = encodeURIComponent(trimmed)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 64);

  // encodeURIComponent leaves `.` literal, so a bare `.` or `..` would survive
  // as a whole-segment traversal token and `join(root, '..')` would escape the
  // root. Neutralize exactly those two; any other run of dots (`..foo`, `...`)
  // is a plain filename, not a traversal.
  if (encoded === '.' || encoded === '..') {
    return '_';
  }

  return encoded || 'unknown';
}

export class SpillStore {
  constructor(private readonly rootDir: string) {}

  get root() {
    return this.rootDir;
  }

  /**
   * Write `content` to a fresh file under the conversation's directory and
   * return its path and byte length. The filename is a random hex prefix plus
   * the sanitized tool name, so it is unpredictable and stays readable.
   */
  async saveText(input: SaveTextSpillInput): Promise<SavedSpill> {
    const dir = join(this.rootDir, encodeSegment(input.conversationId));
    await mkdir(dir, { recursive: true });

    const path = join(dir, `${randomBytes(6).toString('hex')}-${encodeSegment(input.toolName)}.txt`);
    const bytes = Buffer.byteLength(input.content, 'utf8');

    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(input.content);
    } finally {
      await handle.close();
    }

    return { path, bytes };
  }

  /**
   * Open a fresh append-only spill file under the conversation's directory
   * and return a streaming handle. Same filename convention and exclusive
   * owner-only creation as {@link saveText}; the difference is that content
   * is written incrementally, so a producer can bound its memory instead of
   * buffering the full text.
   */
  async openStream(input: { conversationId: string; toolName: string }): Promise<SpillStream> {
    const dir = join(this.rootDir, encodeSegment(input.conversationId));
    await mkdir(dir, { recursive: true });

    const path = join(dir, `${randomBytes(6).toString('hex')}-${encodeSegment(input.toolName)}.txt`);
    const handle = await open(path, 'wx', 0o600);

    return {
      path,
      append: (text: string) => handle.appendFile(text, 'utf8'),
      end: () => handle.close()
    };
  }

  /** Remove every spill file a conversation produced. */
  async deleteConversation(conversationId: string): Promise<void> {
    await rm(join(this.rootDir, encodeSegment(conversationId)), { recursive: true, force: true });
  }

  /**
   * Delete spill directories whose conversation no longer exists.
   *
   * Directories modified within `minAgeMs` are kept even when unknown: the
   * active-conversation list is a moment's snapshot, and a turn that starts
   * between the snapshot and the sweep must not lose its freshly written
   * output. Orphans that survive the sweep are reclaimed by the next one.
   */
  async sweep(activeConversationIds: Iterable<string>, minAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    const active = new Set([...activeConversationIds].map(encodeSegment));

    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      return; // No root yet means nothing to sweep.
    }

    const now = Date.now();

    await Promise.all(
      entries.map(async (entry) => {
        if (active.has(entry)) {
          return;
        }

        const dir = join(this.rootDir, entry);

        try {
          const stats = await stat(dir);
          if (!stats.isDirectory() || now - stats.mtimeMs < minAgeMs) {
            return;
          }

          await rm(dir, { recursive: true, force: true });
        } catch {
          // A directory removed mid-sweep or unreadable is simply left for
          // the next one; sweeping must never surface as an app error.
        }
      })
    );
  }
}
