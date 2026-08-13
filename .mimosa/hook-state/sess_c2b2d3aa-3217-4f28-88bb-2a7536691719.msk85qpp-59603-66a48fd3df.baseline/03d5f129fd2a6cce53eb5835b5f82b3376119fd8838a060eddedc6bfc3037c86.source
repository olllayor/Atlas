import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { PROTECTED_PROJECT_PATH_NAMES } from '../../shared/workspaceModes';
import type { ProjectTypeInfo } from './ProjectDetector';

/** Total budget across all files, matching Codex's `project_doc_max_bytes` default. */
export const AGENT_INSTRUCTIONS_MAX_BYTES = 32 * 1024;

/**
 * Per-directory candidates, first non-empty wins — the same pair Codex looks
 * for, so a repo already carrying an override keeps its meaning here.
 */
export const AGENT_INSTRUCTIONS_FILENAMES = ['AGENTS.override.md', 'AGENTS.md'] as const;

/** Nested scan bounds: how deep below the root we look, and how many hits we bother listing. */
const NESTED_SCAN_MAX_DEPTH = 3;
const NESTED_SCAN_MAX_RESULTS = 20;
const NESTED_SCAN_TTL_MS = 30_000;
const NESTED_SCAN_IGNORED = new Set<string>([
  ...PROTECTED_PROJECT_PATH_NAMES,
  'node_modules',
  'dist',
  'out',
  'build',
  'vendor',
  'target',
  '.next',
  '.venv'
]);

const MAX_CACHE_SIZE = 50;

/**
 * Cache key for the project-less case. A real root is always absolute, so an
 * empty string cannot collide with one.
 */
const GLOBAL_ONLY_KEY = '';

const TRUNCATION_MARKER = '\n\n[Truncated: AGENTS.md content exceeded the 32 KiB limit]';

export type AgentInstructionsScope = 'global' | 'project';

export type AgentInstructionsSource = {
  /** Absolute path of the contributing file. */
  path: string;
  scope: AgentInstructionsScope;
  /** Bytes actually included, after the shared budget was applied. */
  bytes: number;
  truncated: boolean;
};

export type AgentInstructionsSegment = {
  source: AgentInstructionsSource;
  text: string;
};

export type AgentInstructionsResult = {
  /** Concatenated text, global first then project; `''` when nothing was found. */
  text: string;
  /** The same text kept per file, so the prompt can label each block. */
  segments: AgentInstructionsSegment[];
  sources: AgentInstructionsSource[];
  /** Relative paths of nested AGENTS.md files that were found but not loaded. */
  nestedPaths: string[];
  totalBytes: number;
  truncated: boolean;
};

export const EMPTY_AGENT_INSTRUCTIONS: AgentInstructionsResult = {
  text: '',
  segments: [],
  sources: [],
  nestedPaths: [],
  totalBytes: 0,
  truncated: false
};

type CandidateFingerprint = { path: string; mtimeMs: number; size: number } | null;

type CacheEntry = {
  fingerprint: CandidateFingerprint[];
  segments: AgentInstructionsSegment[];
  nestedPaths: string[];
  nestedScanAt: number;
  timestamp: number;
};

/**
 * The AGENTS.md files that apply to a conversation's project.
 *
 * Shaped like `ProjectDetector` — synchronous, cached, constructed once — because
 * it is read on the same turn-setup path as `resolveConversationWorkspace` and
 * again inside `measureContextUsage`, both of which are synchronous and both of
 * which must agree about what the model was told.
 *
 * Discovery follows Codex rather than Claude Code: plain Markdown, no `@file`
 * imports, and precedence is positional — global text first, project text last,
 * so the more specific file wins by appearing later. Atlas's cwd *is* the
 * project root (`resolveWorkspaceCwd`), so Codex's git-root-to-cwd walk
 * collapses to a single project directory; files deeper in the tree are listed
 * for the model to read on demand, never preloaded.
 */
export class AgentInstructionsService {
  private readonly globalDir: string;
  private readonly maxBytes: number;
  private cache = new Map<string, CacheEntry>();

  constructor(options?: { globalDir?: string; maxBytes?: number }) {
    // `~/.atlas`, not `~/.codex` or `~/.claude`: those belong to other tools and
    // reading them would silently import instructions the user wrote for a
    // different agent with different capabilities.
    this.globalDir = options?.globalDir ?? join(homedir(), '.atlas');
    this.maxBytes = options?.maxBytes ?? AGENT_INSTRUCTIONS_MAX_BYTES;
  }

  /**
   * Cheap enough to call on every turn: four `statSync` calls revalidate the
   * cache, and the nested scan is reused for 30 seconds. That is deliberate —
   * the agent may edit AGENTS.md mid-conversation, and an edit has to apply on
   * the very next turn without a watcher.
   *
   * `root === null` (work mode with no project attached) still returns the
   * global scope: instructions are context, and the capability boundary is the
   * withheld toolset, not a withheld prompt.
   */
  getForRoot(root: string | null): AgentInstructionsResult {
    const absRoot = root ? resolve(root) : null;
    const key = absRoot ?? GLOBAL_ONLY_KEY;
    const candidates = this.candidatePaths(absRoot);
    const fingerprint = candidates.map((path) => fingerprintOf(path));

    const cached = this.cache.get(key);
    const now = Date.now();
    const segments =
      cached && sameFingerprint(cached.fingerprint, fingerprint)
        ? cached.segments
        : this.readSegments(absRoot);
    const nestedPaths =
      cached && now - cached.nestedScanAt < NESTED_SCAN_TTL_MS ? cached.nestedPaths : scanNested(absRoot);

    this.evictIfFull();
    this.cache.set(key, {
      fingerprint,
      segments,
      nestedPaths,
      nestedScanAt: cached && nestedPaths === cached.nestedPaths ? cached.nestedScanAt : now,
      timestamp: now
    });

    return composeResult(segments, nestedPaths);
  }

  /** Drops caches for one root, or everything. Used after a write and by tests. */
  invalidate(root?: string) {
    if (root) {
      this.cache.delete(resolve(root));
    } else {
      this.cache.clear();
    }
  }

  private candidatePaths(absRoot: string | null): string[] {
    const paths = AGENT_INSTRUCTIONS_FILENAMES.map((name) => join(this.globalDir, name));
    if (absRoot) {
      paths.push(...AGENT_INSTRUCTIONS_FILENAMES.map((name) => join(absRoot, name)));
    }
    return paths;
  }

  /**
   * Global first, project second, and one file per directory: an override
   * replaces the plain file rather than stacking on top of it.
   */
  private readSegments(absRoot: string | null): AgentInstructionsSegment[] {
    const segments: AgentInstructionsSegment[] = [];
    let remaining = this.maxBytes;

    const directories: Array<{ dir: string; scope: AgentInstructionsScope }> = [
      { dir: this.globalDir, scope: 'global' }
    ];
    if (absRoot) {
      directories.push({ dir: absRoot, scope: 'project' });
    }

    for (const { dir, scope } of directories) {
      if (remaining <= 0) {
        break;
      }

      for (const name of AGENT_INSTRUCTIONS_FILENAMES) {
        const path = join(dir, name);
        const read = readCapped(path, remaining);
        if (!read || !read.text.trim()) {
          // A file that is missing, unreadable, or blank does not consume the
          // directory's one slot — the next candidate still gets its turn.
          continue;
        }

        segments.push({
          source: { path, scope, bytes: read.bytes, truncated: read.truncated },
          text: read.truncated ? `${read.text}${TRUNCATION_MARKER}` : read.text
        });
        remaining -= read.bytes;
        break;
      }
    }

    return segments;
  }

  private evictIfFull() {
    if (this.cache.size < MAX_CACHE_SIZE) {
      return;
    }

    const oldest = [...this.cache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, Math.floor(MAX_CACHE_SIZE / 4));
    for (const [key] of oldest) this.cache.delete(key);
  }
}

function composeResult(
  segments: AgentInstructionsSegment[],
  nestedPaths: string[]
): AgentInstructionsResult {
  if (segments.length === 0 && nestedPaths.length === 0) {
    return EMPTY_AGENT_INSTRUCTIONS;
  }

  return {
    text: segments.map((segment) => segment.text).join('\n\n'),
    segments,
    sources: segments.map((segment) => segment.source),
    nestedPaths,
    totalBytes: segments.reduce((total, segment) => total + segment.source.bytes, 0),
    truncated: segments.some((segment) => segment.source.truncated)
  };
}

function fingerprintOf(path: string): CandidateFingerprint {
  try {
    const stat = statSync(path);
    return stat.isFile() ? { path, mtimeMs: stat.mtimeMs, size: stat.size } : null;
  } catch {
    return null;
  }
}

function sameFingerprint(left: CandidateFingerprint[], right: CandidateFingerprint[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    if (entry == null || other == null) {
      return entry == null && other == null;
    }
    return entry.path === other.path && entry.mtimeMs === other.mtimeMs && entry.size === other.size;
  });
}

/**
 * Reads at most `budget` bytes, and never through `readFileSync`.
 *
 * Reads are unrestricted in Atlas (see `toolWorkspace`), so `AGENTS.md` may be a
 * symlink to anything at all — a multi-gigabyte file, a FIFO that never ends.
 * An explicit descriptor with a bounded `readSync` cannot stall the turn the way
 * slurping the whole file could. Every failure is swallowed: this runs on the
 * turn path, and a project with an unreadable instruction file must still be
 * able to hold a conversation.
 */
function readCapped(
  path: string,
  budget: number
): { text: string; bytes: number; truncated: boolean } | null {
  let stat;
  try {
    stat = statSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[AgentInstructions] could not stat ${path}:`, err);
    }
    return null;
  }

  if (!stat.isFile()) {
    return null;
  }

  // One byte past the budget, so a file that exactly fills it is not reported
  // as truncated while a file that overruns it is.
  const buffer = Buffer.allocUnsafe(budget + 1);
  let bytesRead: number;
  let fd: number | null = null;

  try {
    fd = openSync(path, 'r');
    bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
  } catch (err) {
    console.warn(`[AgentInstructions] could not read ${path}:`, err);
    return null;
  } finally {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        // Nothing useful to do with a failed close.
      }
    }
  }

  const truncated = bytesRead > budget;
  const bytes = Math.min(bytesRead, budget);
  let text = buffer.subarray(0, bytes).toString('utf8');

  if (truncated) {
    // Cutting at a byte offset can land inside a multibyte sequence, which
    // decodes to replacement characters the author never wrote.
    text = text.replace(/\uFFFD+$/u, '');
  }

  return { text, bytes, truncated };
}

/**
 * The nested AGENTS.md files, as paths only.
 *
 * The agents.md spec says the closest file to an edited file wins; Codex honours
 * that by expecting the agent to open those files when it works in those
 * subtrees, not by preloading them. Listing keeps the same guarantee for a few
 * dozen bytes instead of a few dozen kilobytes. The walk is bounded on every
 * axis — depth, ignored directories, result count — because a monorepo scanned
 * naively is a turn spent on `readdir`.
 */
function scanNested(absRoot: string | null): string[] {
  if (!absRoot) {
    return [];
  }

  const found: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (found.length >= NESTED_SCAN_MAX_RESULTS) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[AgentInstructions] could not scan ${dir}:`, err);
      return;
    }

    for (const entry of entries) {
      if (found.length >= NESTED_SCAN_MAX_RESULTS) {
        return;
      }

      // `isDirectory()` is false for a symlink, which is the point: following
      // directory links turns a bounded walk into an unbounded one.
      if (entry.isDirectory()) {
        if (depth < NESTED_SCAN_MAX_DEPTH && !NESTED_SCAN_IGNORED.has(entry.name)) {
          walk(join(dir, entry.name), depth + 1);
        }
        continue;
      }

      if (dir !== absRoot && (AGENT_INSTRUCTIONS_FILENAMES as readonly string[]).includes(entry.name)) {
        found.push(relative(absRoot, join(dir, entry.name)));
      }
    }
  };

  walk(absRoot, 0);
  return found;
}

/**
 * The starter file `/init` writes.
 *
 * Deterministic and template-driven rather than model-generated: this runs from
 * an IPC handler with no turn around it, and a skeleton the user fills in beats
 * a plausible-sounding description of a project nobody checked.
 */
export function generateStarterAgentsMd(projectTitle: string, typeInfo: ProjectTypeInfo): string {
  const stack = [
    typeInfo.type === 'unknown' ? null : typeInfo.type,
    typeInfo.framework,
    typeInfo.packageManager
  ]
    .filter(Boolean)
    .join(' · ');

  const runner = typeInfo.packageManager ?? 'npm';
  const buildLines =
    typeInfo.type === 'node'
      ? [`- Install: \`${runner} install\``, `- Build: \`${runner} run build\``, `- Test: \`${runner} test\``]
      : typeInfo.type === 'python'
        ? ['- Install: `pip install -r requirements.txt`', '- Test: `pytest`']
        : typeInfo.type === 'rust'
          ? ['- Build: `cargo build`', '- Test: `cargo test`']
          : typeInfo.type === 'go'
            ? ['- Build: `go build ./...`', '- Test: `go test ./...`']
            : ['- Install:', '- Build:', '- Test:'];

  return [
    `# ${projectTitle}`,
    '',
    'Instructions for AI agents working in this repository. Plain Markdown, no imports.',
    '',
    '## Project overview',
    '',
    stack ? `Detected stack: ${stack}. Replace this with what the project actually is and does.` : 'Describe what this project is and does.',
    '',
    '## Build and run',
    '',
    ...buildLines,
    '',
    '## Conventions',
    '',
    '- Match the surrounding code rather than introducing a new style.',
    '- Note anything a newcomer would get wrong: naming, error handling, module layout.',
    '',
    '## Testing',
    '',
    '- How tests are run, and what must pass before a change is considered done.',
    '',
    '## Notes for agents',
    '',
    '- Files or directories that must not be touched.',
    '- Steps that are easy to forget (migrations, codegen, generated files).',
    ''
  ].join('\n');
}
