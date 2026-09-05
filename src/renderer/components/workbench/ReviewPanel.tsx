/**
 * The review pane, built to the shape Codex's is documented to have.
 *
 * Five scopes rather than one list of edits — Unstaged (the default), Staged,
 * Branch, Commit and Last turn — because the pane shows the state of the
 * repository, not only what the assistant touched. Stage / unstage / revert are
 * offered at three levels: the whole diff, one file, one hunk. Any line can
 * carry a comment, and the collected comments are sent to the chat as a
 * follow-up, which is what makes them worth writing: a location plus an
 * instruction is something the model can act on precisely.
 *
 * Two departures from Codex, both because the underlying capability is not
 * there yet: there is no repository selector (Atlas attaches one folder per
 * conversation), and a file name is not a link into an editor (the IDE launcher
 * opens a project root, not a file at a line).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';

import type { GitLogEntry, ReviewTurnSummary } from '../../../shared/contracts';
import type { ReviewComment, ReviewDiff, ReviewFile, ReviewHunk, ReviewScope } from '../../../shared/review';
import {
  EMPTY_REVIEW_DIFF,
  REVIEW_SCOPES,
  formatReviewComments,
  scopeIsMutable,
  summariseReview
} from '../../../shared/review';
import { parseUnifiedDiff } from '../../../shared/toolCellGrammar';
import type { DiffLine } from '../../../shared/toolCellGrammar';
import { notify, notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { DiffBlock } from '../transcript/DiffBlock';

const STATUS_LABEL: Record<ReviewFile['status'], string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  binary: 'Binary'
};

/**
 * Actions are text, not buttons.
 *
 * A pane with stage / revert on every file and every hunk is a pane with forty
 * buttons in it, and forty chrome-heavy controls read as a control panel rather
 * than as a diff. Borderless text at the dim end of the ramp keeps the code the
 * brightest thing on screen, which is the only thing here worth reading first.
 */
const ACTION_CLASS =
  'rounded px-1.5 py-0.5 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Revealed on hover or keyboard focus, never on a touch of the pointer
 * elsewhere. `focus-within` is the half that matters: without it these controls
 * exist only for people using a mouse.
 */
const HOVER_ACTIONS_CLASS =
  'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none';

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-base text-text-secondary">{title}</p>
      <p className="max-w-[40ch] text-sm leading-relaxed text-text-faint">{body}</p>
    </div>
  );
}

export function ReviewPanel({
  conversationId,
  onSendComments
}: {
  conversationId?: string;
  /** Drops the collected comments into the composer as a follow-up message. */
  onSendComments?: (text: string) => void;
}) {
  const [scope, setScope] = useState<ReviewScope>('unstaged');
  const [commit, setCommit] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [diff, setDiff] = useState<ReviewDiff>(EMPTY_REVIEW_DIFF);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [reviewTurns, setReviewTurns] = useState<ReviewTurnSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<ReviewComment[]>([]);

  const refresh = useCallback(async () => {
    if (!conversationId || !window.atlasChat?.git?.review) {
      setDiff(EMPTY_REVIEW_DIFF);
      return;
    }

    setLoading(true);

    try {
      setDiff(
        await window.atlasChat.git.review({ conversationId, scope, commit, turnId })
      );
    } catch (error) {
      notifyError('Could not read the diff', error);
      setDiff({ ...EMPTY_REVIEW_DIFF, scope });
    } finally {
      setLoading(false);
    }
  }, [commit, conversationId, scope, turnId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The turn list is only needed by one scope, and it is a second call.
  useEffect(() => {
    if (scope !== 'lastTurn' || !conversationId || !window.atlasChat?.git?.listReviewTurns) {
      return;
    }

    window.atlasChat.git
      .listReviewTurns(conversationId)
      .then((entries) => {
        setReviewTurns(entries);
        setTurnId((current) => current ?? entries.at(-1)?.turnId ?? null);
      })
      .catch(() => undefined);
  }, [conversationId, scope]);

  // The commit list is only needed by one scope, and it is a second git call.
  useEffect(() => {
    if (scope !== 'commit' || !conversationId || !window.atlasChat?.git?.getLog) {
      return;
    }

    window.atlasChat.git
      .getLog(conversationId, 30)
      .then((entries) => {
        setLog(entries);
        setCommit((current) => current ?? entries[0]?.hash ?? null);
      })
      .catch(() => undefined);
  }, [conversationId, scope]);

  /**
   * Runs a git write, then re-reads.
   *
   * Always re-reads rather than patching local state: staging a hunk changes
   * what the *other* scopes show too, and a pane that quietly disagreed with
   * the repository would be worse than one that takes a moment.
   */
  const mutate = useCallback(
    async (label: string, work: () => Promise<void>) => {
      if (busy) {
        return;
      }

      setBusy(true);

      try {
        await work();
        await refresh();
      } catch (error) {
        notifyError(label, error);
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh]
  );

  const totals = useMemo(() => summariseReview(diff.files), [diff.files]);
  const mutable = scopeIsMutable(diff.scope) && Boolean(conversationId);
  const staged = diff.scope === 'staged';

  const commentsFor = useCallback(
    (path: string) => (line: DiffLine) =>
      comments.filter(
        (comment) =>
          comment.path === path && comment.line === line.lineNumber && comment.code === line.content
      ),
    [comments]
  );

  const addComment = (path: string, line: DiffLine, body: string) => {
    setComments((current) => [
      ...current,
      {
        id: `${path}:${line.lineNumber ?? 0}:${current.length}`,
        path,
        line: line.lineNumber,
        code: line.content,
        body
      }
    ]);
  };

  const sendComments = () => {
    if (comments.length === 0 || !onSendComments) {
      return;
    }

    onSendComments(formatReviewComments(comments));
    setComments([]);
    notify({ tone: 'success', title: `${comments.length} comments added to the composer` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-2">
        {/* Scope selector. Plain text like the tab bar above it — a second row
            of pills would read as a competing level of navigation. Toggle
            buttons, not a nested tablist: this selects a filter inside the
            review panel, and a tab-in-tab is a context AT cannot place. */}
        <div role="group" aria-label="Review scope" className="flex flex-wrap items-center gap-3">
          {REVIEW_SCOPES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={entry.value === scope}
              title={entry.hint}
              onClick={() => {
                setScope(entry.value);
                if (entry.value !== 'lastTurn') setTurnId(null);
              }}
              className={cn(
                'py-1 text-sm transition-colors',
                entry.value === scope
                  ? 'text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary'
              )}
            >
              {entry.label}
            </button>
          ))}

          {/* t3code's numbered per-turn scopes: every checkpointed turn is a
              real, addressable diff, not just "the last one". */}
          {scope === 'lastTurn' && reviewTurns.length > 0 ? (
            <div role="group" aria-label="Turns" className="flex flex-wrap items-center gap-2">
              {reviewTurns.map((turn) => {
                const active = turnId ? turn.turnId === turnId : turn.index === reviewTurns.length;
                return (
                  <button
                    key={turn.turnId}
                    type="button"
                    aria-pressed={active}
                    title={`Diff for turn ${turn.index}`}
                    onClick={() => setTurnId(turn.turnId)}
                    className={cn(
                      'rounded-full px-1.5 py-0.5 font-mono text-3xs leading-none transition-colors',
                      active
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-faint hover:bg-bg-hover hover:text-text-secondary'
                    )}
                  >
                    {turn.index}
                  </button>
                );
              })}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh diff"
            className="ml-auto rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <RefreshCw
              className={cn('size-3.5', loading && 'motion-spin-steps')}
              aria-hidden
            />
          </button>
        </div>

        {scope === 'commit' && log.length > 0 ? (
          <select
            value={commit ?? ''}
            onChange={(event) => setCommit(event.target.value)}
            className="mt-2 w-full rounded-md border border-border-default bg-bg-base px-2 py-1 text-xs text-text-primary outline-none"
          >
            {log.map((entry) => (
              <option key={entry.hash} value={entry.hash}>
                {entry.shortHash} · {entry.message}
              </option>
            ))}
          </select>
        ) : null}

        {diff.files.length > 0 ? (
          <div className="group/row flex items-center gap-2 py-1">
            <p className="min-w-0 flex-1 truncate text-xs text-text-faint">
              {totals.files} file{totals.files === 1 ? '' : 's'}{' '}
              <span className="tabular-nums">
                <span className="text-diff-add-fg">+{totals.added}</span>{' '}
                <span className="text-diff-del-fg">−{totals.removed}</span>
              </span>
              {diff.subject ? <span> · vs {diff.subject}</span> : null}
            </p>

            {mutable ? (
              <div className={HOVER_ACTIONS_CLASS}>
                <button
                  type="button"
                  disabled={busy}
                  className={ACTION_CLASS}
                  onClick={() =>
                    void mutate(staged ? 'Could not unstage' : 'Could not stage', async () => {
                      const paths = diff.files.map((file) => file.path);
                      await (staged
                        ? window.atlasChat.git.unstage(conversationId!, paths)
                        : window.atlasChat.git.stage(conversationId!, paths));
                    })
                  }
                >
                  {staged ? 'Unstage all' : 'Stage all'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={cn(ACTION_CLASS, 'hover:text-error')}
                  onClick={() =>
                    void mutate('Could not revert', () =>
                      window.atlasChat.git.revert(
                        conversationId!,
                        diff.files.map((file) => file.path)
                      )
                    )
                  }
                >
                  Revert all
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* No card, no border: a pending batch is a state, not an object. */}
        {comments.length > 0 ? (
          <div className="flex items-center gap-1 py-1">
            <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">
              {comments.length} comment{comments.length === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={() => setComments([])} className={ACTION_CLASS}>
              Discard
            </button>
            <button
              type="button"
              onClick={sendComments}
              disabled={!onSendComments}
              className={cn(ACTION_CLASS, 'text-text-secondary')}
            >
              Send to chat
            </button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-auto-hide px-4 pb-3">
        {diff.files.length === 0 ? (
          <EmptyState
            title={diff.emptyReason ? 'Nothing to review' : 'No changes in this scope'}
            body={
              diff.emptyReason ??
              REVIEW_SCOPES.find((entry) => entry.value === diff.scope)?.hint ??
              'Nothing has changed here yet.'
            }
          />
        ) : (
          diff.files.map((file) => (
            <ReviewFileRow
              key={`${file.path}:${file.status}`}
              file={file}
              busy={busy}
              mutable={mutable}
              staged={staged}
              defaultOpen={diff.files.length === 1}
              commentsFor={commentsFor(file.path)}
              onAddComment={(line, body) => addComment(file.path, line, body)}
              onStage={() =>
                void mutate('Could not stage', () =>
                  window.atlasChat.git.stage(conversationId!, [file.path])
                )
              }
              onUnstage={() =>
                void mutate('Could not unstage', () =>
                  window.atlasChat.git.unstage(conversationId!, [file.path])
                )
              }
              onRevert={() =>
                void mutate('Could not revert', () =>
                  window.atlasChat.git.revert(conversationId!, [file.path])
                )
              }
              onApplyHunk={(hunk, options) =>
                void mutate('This hunk no longer applies', () =>
                  window.atlasChat.git.applyHunk({
                    conversationId: conversationId!,
                    patch: hunk.patch,
                    cached: options.cached,
                    reverse: options.reverse
                  })
                )
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function ReviewFileRow({
  file,
  busy,
  mutable,
  staged,
  defaultOpen,
  commentsFor,
  onAddComment,
  onStage,
  onUnstage,
  onRevert,
  onApplyHunk
}: {
  file: ReviewFile;
  busy: boolean;
  mutable: boolean;
  staged: boolean;
  defaultOpen: boolean;
  commentsFor: (line: DiffLine) => ReviewComment[];
  onAddComment: (line: DiffLine, body: string) => void;
  onStage: () => void;
  onUnstage: () => void;
  onRevert: () => void;
  onApplyHunk: (hunk: ReviewHunk, options: { cached: boolean; reverse: boolean }) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [pendingLine, setPendingLine] = useState<DiffLine | null>(null);
  const label = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

  return (
    <div className="border-t border-border-subtle first:border-t-0">
      <div className="group/row -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            aria-hidden
            className={cn('size-3 shrink-0 text-text-faint transition-transform', !open && '-rotate-90')}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={label}>
            {label}
          </span>
          {file.status !== 'modified' ? (
            <span className="shrink-0 text-xs text-text-faint">{STATUS_LABEL[file.status]}</span>
          ) : null}
          <span className="shrink-0 tabular-nums text-xs">
            <span className="text-diff-add-fg">+{file.added}</span>{' '}
            <span className="text-diff-del-fg">−{file.removed}</span>
          </span>
        </button>

        {mutable ? (
          <div className={HOVER_ACTIONS_CLASS}>
            <button
              type="button"
              disabled={busy}
              className={ACTION_CLASS}
              onClick={staged ? onUnstage : onStage}
            >
              {staged ? 'Unstage' : 'Stage'}
            </button>
            <button
              type="button"
              disabled={busy}
              className={cn(ACTION_CLASS, 'hover:text-error')}
              onClick={onRevert}
            >
              Revert
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="pb-3">
          {file.status === 'binary' || file.hunks.length === 0 ? (
            <p className="px-2 py-1 text-sm text-text-faint">
              {file.status === 'binary'
                ? 'Binary file — no textual diff.'
                : 'No hunks in this diff.'}
            </p>
          ) : (
            file.hunks.map((hunk, index) => (
              <HunkBlock
                key={`${hunk.header}:${index}`}
                hunk={hunk}
                busy={busy}
                mutable={mutable}
                staged={staged}
                // A file with one hunk needs no hunk label: the row above
                // already names it, and `@@ -1,3 +1,3 @@` above a three-line
                // diff is a caption for something already on screen.
                showHeader={file.hunks.length > 1}
                commentsFor={commentsFor}
                onAddComment={setPendingLine}
                onApply={(options) => onApplyHunk(hunk, options)}
              />
            ))
          )}
        </div>
      ) : null}

      {pendingLine ? (
        <CommentComposer
          line={pendingLine}
          onCancel={() => setPendingLine(null)}
          onSubmit={(body) => {
            onAddComment(pendingLine, body);
            setPendingLine(null);
          }}
        />
      ) : null}
    </div>
  );
}

function HunkBlock({
  hunk,
  busy,
  mutable,
  staged,
  showHeader,
  commentsFor,
  onAddComment,
  onApply
}: {
  hunk: ReviewHunk;
  busy: boolean;
  mutable: boolean;
  staged: boolean;
  showHeader: boolean;
  commentsFor: (line: DiffLine) => ReviewComment[];
  onAddComment: (line: DiffLine) => void;
  onApply: (options: { cached: boolean; reverse: boolean }) => void;
}) {
  // Rendered from the hunk's own patch, so what is on screen is exactly the
  // bytes that would be applied if one of the buttons below is pressed.
  const parsed = useMemo(() => parseUnifiedDiff(hunk.patch), [hunk.patch]);
  const diffFile = parsed?.[0] ?? null;

  if (!diffFile) {
    return null;
  }

  return (
    <div className="group/row mt-2 first:mt-0">
      {showHeader || mutable ? (
        <div className="flex h-6 items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-2xs text-text-faint" title={hunk.header}>
            {showHeader ? hunk.header : ''}
          </code>

          {mutable ? (
            <div className={HOVER_ACTIONS_CLASS}>
              {/*
                Staging a hunk writes it to the index; unstaging is the same
                patch reversed against the index; reverting is it reversed
                against the working tree. Two buttons, one operation.
              */}
              <button
                type="button"
                disabled={busy}
                className={ACTION_CLASS}
                onClick={() => onApply({ cached: true, reverse: staged })}
              >
                {staged ? 'Unstage hunk' : 'Stage hunk'}
              </button>
              {!staged ? (
                <button
                  type="button"
                  disabled={busy}
                  className={cn(ACTION_CLASS, 'hover:text-error')}
                  onClick={() => onApply({ cached: false, reverse: true })}
                >
                  Revert hunk
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <DiffBlock file={diffFile} onAddComment={onAddComment} commentsFor={commentsFor} />
    </div>
  );
}

function CommentComposer({
  line,
  onSubmit,
  onCancel
}: {
  line: DiffLine;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState('');

  return (
    <div className="mb-3 border-l-2 border-brand pl-2">
      <p className="truncate font-mono text-2xs text-text-faint" title={line.content}>
        {line.lineNumber ?? '—'} {line.content.trim() || '(blank line)'}
      </p>
      <textarea
        value={body}
        autoFocus
        rows={3}
        placeholder="What should change here?"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onCancel();
          }

          // Submit on the same chord the composer uses, so a comment is
          // finished the way a message is.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && body.trim()) {
            onSubmit(body.trim());
          }
        }}
        className="mt-1.5 w-full resize-none rounded-md border border-border-default bg-bg-base px-2 py-1.5 text-xs text-text-primary outline-none focus-visible:border-border-strong"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1">
        <button type="button" onClick={onCancel} className={ACTION_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!body.trim()}
          onClick={() => onSubmit(body.trim())}
          className={cn(ACTION_CLASS, 'text-text-primary')}
        >
          Add comment
        </button>
      </div>
    </div>
  );
}
