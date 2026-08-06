/**
 * The review pane's model of a patch.
 *
 * Codex's review pane is not a list of what the agent edited — it is the state
 * of the repository, viewed through one of several scopes, with stage / unstage
 * / revert available at three levels: the whole diff, one file, one hunk. That
 * last level is the reason this module exists rather than reusing the
 * transcript's diff grammar: `parseUnifiedDiff` produces something renderable,
 * and applying a single hunk needs something `git apply` will accept.
 *
 * So every file and every hunk carries its own complete patch text, sliced from
 * git's output verbatim — never re-serialised from a parsed structure. A patch
 * that has been through a lossy round trip is one `git apply` rejects for
 * reasons that are invisible on screen.
 */

/**
 * Which diff the pane is showing.
 *
 * `unstaged` is the default because it is the one that answers "what is in
 * front of me right now". `lastTurn` is Atlas's own: the per-turn checkpoints
 * mean the assistant's last set of edits is a real, addressable range even
 * after the working tree has moved on.
 */
export type ReviewScope = 'unstaged' | 'staged' | 'branch' | 'commit' | 'lastTurn';

export const REVIEW_SCOPES: Array<{ value: ReviewScope; label: string; hint: string }> = [
  { value: 'unstaged', label: 'Unstaged', hint: 'Changes in the working tree that are not staged.' },
  { value: 'staged', label: 'Staged', hint: 'What a commit right now would contain.' },
  { value: 'branch', label: 'Branch', hint: 'This branch compared with its base.' },
  { value: 'commit', label: 'Commit', hint: 'The exact contents of one commit.' },
  { value: 'lastTurn', label: 'Last turn', hint: "The assistant's most recent set of edits." }
];

/** Whether a scope describes the working tree, and so can be staged or reverted. */
export function scopeIsMutable(scope: ReviewScope): boolean {
  return scope === 'unstaged' || scope === 'staged';
}

export type ReviewFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'binary';

export type ReviewHunk = {
  /** `@@ -a,b +c,d @@ …`, verbatim. */
  header: string;
  /** A standalone patch: this file's headers plus this one hunk. */
  patch: string;
  added: number;
  removed: number;
};

export type ReviewFile = {
  path: string;
  /** Set on a rename; `path` is the new name. */
  previousPath: string | null;
  status: ReviewFileStatus;
  added: number;
  removed: number;
  /** The complete `diff --git` section for this file. */
  patch: string;
  hunks: ReviewHunk[];
};

export type ReviewDiff = {
  scope: ReviewScope;
  files: ReviewFile[];
  /**
   * What the scope resolved to, for the header — a base branch, a commit's
   * short hash, a turn's prompt. Null when the scope names itself.
   */
  subject: string | null;
  /** Why the scope produced nothing, when the reason is worth saying. */
  emptyReason: string | null;
};

export const EMPTY_REVIEW_DIFF: ReviewDiff = {
  scope: 'unstaged',
  files: [],
  subject: null,
  emptyReason: null
};

/** One line-anchored note the user wrote in the pane. */
export type ReviewComment = {
  id: string;
  path: string;
  /** The line number as displayed. Null when anchored to the file as a whole. */
  line: number | null;
  /** The diff line the comment sits on, for quoting back to the model. */
  code: string;
  body: string;
};

/**
 * The follow-up message a batch of comments becomes.
 *
 * Comments are worth more to a model than to a human reader: each one is a
 * precise location plus an instruction. They are rendered as a list of
 * `path:line` anchors with the offending line quoted, because "fix the null
 * check" means nothing without the line it is attached to.
 */
export function formatReviewComments(comments: ReviewComment[]): string {
  if (comments.length === 0) {
    return '';
  }

  const byPath = new Map<string, ReviewComment[]>();

  for (const comment of comments) {
    const existing = byPath.get(comment.path) ?? [];
    existing.push(comment);
    byPath.set(comment.path, existing);
  }

  const sections = [...byPath.entries()].map(([path, entries]) => {
    const lines = entries
      .slice()
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
      .map((entry) => {
        const anchor = entry.line == null ? path : `${path}:${entry.line}`;
        const quoted = entry.code.trim() ? `\n  > ${entry.code.trim()}` : '';
        return `- ${anchor}${quoted}\n  ${entry.body.trim()}`;
      });

    return lines.join('\n');
  });

  return `Review comments:\n${sections.join('\n')}`;
}

const FILE_START = 'diff --git ';

/**
 * Splits `git diff` output into per-file sections.
 *
 * Sliced rather than parsed: the section is handed to `git apply` later, so it
 * has to be the bytes git produced, including the `index` line and any mode
 * changes.
 */
function splitFileSections(output: string): string[] {
  const sections: string[] = [];
  let current: string[] | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith(FILE_START)) {
      if (current) {
        sections.push(current.join('\n'));
      }
      current = [line];
      continue;
    }

    current?.push(line);
  }

  if (current) {
    sections.push(current.join('\n'));
  }

  return sections;
}

/**
 * The path a `diff --git a/x b/x` line names.
 *
 * Read from the `+++`/`---` lines where possible: the `diff --git` line quotes
 * and escapes paths containing spaces, and unpicking that is guesswork. Only
 * when both are `/dev/null` — which cannot happen — does this fall back.
 */
function readPaths(lines: string[]): { path: string; previousPath: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      from = line.slice(4);
    } else if (line.startsWith('+++ ')) {
      to = line.slice(4);
    } else if (line.startsWith('rename from ')) {
      renameFrom = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) {
      renameTo = line.slice('rename to '.length);
    } else if (line.startsWith('@@')) {
      break;
    }
  }

  const strip = (value: string | null): string | null => {
    if (!value || value === '/dev/null') {
      return null;
    }

    // git prefixes with `a/` and `b/`; `--no-prefix` output has neither.
    return value.replace(/^[ab]\//, '');
  };

  const newPath = strip(to) ?? renameTo;
  const oldPath = strip(from) ?? renameFrom;

  if (renameTo && renameFrom) {
    return { path: renameTo, previousPath: renameFrom };
  }

  if (newPath && oldPath && newPath !== oldPath) {
    return { path: newPath, previousPath: oldPath };
  }

  // A deletion has no `+++` path, so the old one is the file's identity.
  return { path: newPath ?? oldPath ?? 'unknown', previousPath: null };
}

function readStatus(lines: string[], previousPath: string | null): ReviewFileStatus {
  for (const line of lines) {
    if (line.startsWith('new file mode')) return 'added';
    if (line.startsWith('deleted file mode')) return 'deleted';
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) return 'binary';
    if (line.startsWith('@@')) break;
  }

  return previousPath ? 'renamed' : 'modified';
}

/**
 * Turns `git diff` output into files and hunks, each with an applyable patch.
 *
 * The trailing newline matters: `git apply` rejects a patch whose last line is
 * not terminated, and slicing a section out of the middle of git's output loses
 * it. Every patch this returns ends in exactly one.
 */
export function parseReviewDiff(output: string): ReviewFile[] {
  if (!output.trim()) {
    return [];
  }

  return splitFileSections(output).map((section) => {
    const lines = section.split('\n');
    const { path, previousPath } = readPaths(lines);
    const status = readStatus(lines, previousPath);

    const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));
    const headerLines = firstHunkIndex === -1 ? lines : lines.slice(0, firstHunkIndex);

    const hunks: ReviewHunk[] = [];
    let added = 0;
    let removed = 0;

    if (firstHunkIndex !== -1) {
      let currentHeader: string | null = null;
      let body: string[] = [];

      const flush = () => {
        if (currentHeader == null) {
          return;
        }

        const hunkAdded = body.filter((line) => line.startsWith('+')).length;
        const hunkRemoved = body.filter((line) => line.startsWith('-')).length;

        added += hunkAdded;
        removed += hunkRemoved;

        hunks.push({
          header: currentHeader,
          patch: `${[...headerLines, currentHeader, ...body].join('\n').replace(/\n+$/, '')}\n`,
          added: hunkAdded,
          removed: hunkRemoved
        });
      };

      for (const line of lines.slice(firstHunkIndex)) {
        if (line.startsWith('@@')) {
          flush();
          currentHeader = line;
          body = [];
          continue;
        }

        body.push(line);
      }

      flush();
    }

    return {
      path,
      previousPath,
      status,
      added,
      removed,
      patch: `${section.replace(/\n+$/, '')}\n`,
      hunks
    };
  });
}

/** Totals for the review header. */
export function summariseReview(files: ReviewFile[]) {
  return files.reduce(
    (totals, file) => ({
      files: totals.files + 1,
      added: totals.added + file.added,
      removed: totals.removed + file.removed
    }),
    { files: 0, added: 0, removed: 0 }
  );
}
