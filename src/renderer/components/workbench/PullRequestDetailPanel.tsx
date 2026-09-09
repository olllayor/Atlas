/**
 * One pull request: what it says, what was said about it, and what it changes.
 *
 * Three tabs, following t3code's detail panel. The split is not cosmetic — each
 * tab is a separate read, and separating them is what keeps the summary fast:
 * the description arrives in one `gh pr view`, while the conversation and the
 * patch are each their own request and are not made until the tab is opened.
 * A long-lived pull request carries hundreds of comments and a megabyte of
 * patch, and the summary must not wait for either.
 *
 * Every tab keeps what it loaded once it has loaded it, so moving between them
 * costs nothing after the first visit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';

import type {
  PullRequestAction,
  PullRequestActivity,
  PullRequestDetail,
  PullRequestDiffResult,
  PullRequestInlineCommentDraft,
  PullRequestLabelCandidate,
  PullRequestMergeMethod,
  PullRequestReviewThread,
  PullRequestReviewVerdict,
  PullRequestReviewerCandidate,
} from '../../../shared/contracts';
import type { DiffLine } from '../../../shared/toolCellGrammar';
import { parseUnifiedDiff } from '../../../shared/toolCellGrammar';
import type { ReviewComment } from '../../../shared/review';
import { notify, notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import MessageResponseContent from '../ai-elements/MessageResponseContent';
import { DiffBlock } from '../transcript/DiffBlock';
import { PullRequestEmptyState } from './PullRequestsPanel';
import {
  PullRequestDiffStat,
  PullRequestStateGlyph,
  formatRelativeTime,
  pullRequestActorLabel,
  pullRequestCheckPresentation,
  resolvePullRequestState,
} from './pullRequestPresentation';

type DetailTab = 'summary' | 'activity' | 'diff';

const TABS: { value: DetailTab; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'activity', label: 'Activity' },
  { value: 'diff', label: 'Diff' },
];

const ACTION_CLASS =
  'rounded bg-bg-surface px-2 py-0.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

/** What each action is called while it runs and once it has. */
const ACTION_LABELS: Record<PullRequestAction, { verb: string; done: string }> = {
  close: { verb: 'Close', done: 'Pull request closed.' },
  reopen: { verb: 'Reopen', done: 'Pull request reopened.' },
  ready: { verb: 'Ready for review', done: 'Pull request marked ready for review.' },
  draft: { verb: 'Convert to draft', done: 'Pull request converted to draft.' },
  merge: { verb: 'Merge', done: 'Pull request merged.' },
};

const MERGE_METHODS: { value: PullRequestMergeMethod; label: string; title: string }[] = [
  { value: 'merge', label: 'Merge', title: 'Create a merge commit' },
  { value: 'squash', label: 'Squash', title: 'Squash commits into one, then merge' },
  { value: 'rebase', label: 'Rebase', title: 'Rebase commits onto the base branch' },
];

export function PullRequestDetailPanel({
  conversationId,
  number,
  onBack,
}: {
  conversationId: string;
  number: number;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<DetailTab>('summary');
  const [busy, setBusy] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>('merge');

  const requestRef = useRef(0);

  const loadDetail = useCallback(async () => {
    if (!window.atlasChat?.github?.getPr) return;

    const token = ++requestRef.current;
    setLoading(true);

    try {
      const next = await window.atlasChat.github.getPr({ conversationId, number });
      if (requestRef.current !== token) return;
      setDetail(next);
      setFailed(next === null);
    } catch (err) {
      if (requestRef.current !== token) return;
      setFailed(true);
      notifyError(`Could not load pull request #${number}`, err);
    } finally {
      if (requestRef.current === token) setLoading(false);
    }
  }, [conversationId, number]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const runAction = useCallback(
    async (action: PullRequestAction, method?: PullRequestMergeMethod) => {
      if (!window.atlasChat?.github?.runPrAction) return;
      setBusy(true);

      try {
        await window.atlasChat.github.runPrAction({
          conversationId,
          number,
          action,
          ...(method ? { mergeMethod: method } : {}),
        });
        notify({ tone: 'success', title: ACTION_LABELS[action].done });
        // The host's answer, not a guess at it: a merge that queued behind a
        // required check leaves the pull request open, and re-reading is the
        // only way the panel finds that out.
        await loadDetail();
      } catch (err) {
        notifyError(`Could not ${ACTION_LABELS[action].verb.toLowerCase()} #${number}`, err);
      } finally {
        setBusy(false);
      }
    },
    [conversationId, loadDetail, number]
  );

  if (loading && !detail) {
    return <PullRequestEmptyState title={`#${number}`} body="Loading…" />;
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col">
        <DetailHeaderBar onBack={onBack} />
        <PullRequestEmptyState
          title={`#${number} could not be read`}
          body={
            failed
              ? 'The GitHub CLI did not return this pull request. It may have been deleted, or belong to a repository this account cannot see.'
              : 'No pull request with that number.'
          }
        />
      </div>
    );
  }

  const presentation = resolvePullRequestState({
    state: detail.state,
    isDraft: detail.isDraft,
    mergeability: detail.mergeability,
    baseBranch: detail.baseRefName,
  });

  return (
    <div className="flex h-full flex-col">
      <DetailHeaderBar
        onBack={onBack}
        onRefresh={() => void loadDetail()}
        refreshing={loading}
        url={detail.url}
      />

      <div className="shrink-0 px-4">
        <div className="flex items-start gap-2.5 pb-1">
          <PullRequestStateGlyph
            state={detail.state}
            isDraft={detail.isDraft}
            mergeability={detail.mergeability}
            baseBranch={detail.baseRefName}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-snug text-text-primary">{detail.title}</h2>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-1 text-sm text-text-faint">
              <span className="tabular-nums">#{detail.number}</span>
              <span className={presentation.toneClassName}>{presentation.label}</span>
              <span>{pullRequestActorLabel(detail.author)}</span>
              <span className="font-mono text-xs">
                {detail.headRefName} → {detail.baseRefName}
              </span>
              <PullRequestDiffStat additions={detail.additions} deletions={detail.deletions} />
              {detail.changedFiles > 0 ? (
                <span>
                  {detail.changedFiles} {detail.changedFiles === 1 ? 'file' : 'files'}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 py-1.5">
          {/* Only the actions this state actually has. A merged pull request
              cannot be closed, and a draft is readied before it is merged —
              offering either as a disabled button would suggest a permission
              problem where there is only a state. */}
          {detail.state === 'open' && detail.isDraft ? (
            <button type="button" disabled={busy} className={ACTION_CLASS} onClick={() => void runAction('ready')}>
              Ready for review
            </button>
          ) : null}
          {detail.state === 'open' && !detail.isDraft ? (
            <>
              <label className="flex items-center gap-1 text-sm text-text-tertiary">
                <span className="sr-only">Merge method</span>
                <select
                  value={mergeMethod}
                  onChange={(event) => setMergeMethod(event.target.value as PullRequestMergeMethod)}
                  disabled={busy}
                  className="rounded bg-bg-surface px-1.5 py-0.5 text-sm text-text-secondary outline-none transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  {MERGE_METHODS.map((method) => (
                    <option key={method.value} value={method.value} title={method.title}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy}
                className={ACTION_CLASS}
                onClick={() => void runAction('merge', mergeMethod)}
              >
                Merge
              </button>
              <button type="button" disabled={busy} className={ACTION_CLASS} onClick={() => void runAction('draft')}>
                Convert to draft
              </button>
            </>
          ) : null}
          {detail.state === 'open' ? (
            <button type="button" disabled={busy} className={ACTION_CLASS} onClick={() => void runAction('close')}>
              Close
            </button>
          ) : null}
          {detail.state === 'closed' ? (
            <button type="button" disabled={busy} className={ACTION_CLASS} onClick={() => void runAction('reopen')}>
              Reopen
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 border-b border-border-subtle pb-1.5">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={tab === item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                'rounded px-2 py-0.5 text-sm transition-colors',
                tab === item.value
                  ? 'bg-bg-surface text-text-primary'
                  : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {tab === 'summary' ? (
          <SummaryTab
            conversationId={conversationId}
            detail={detail}
            onChanged={() => void loadDetail()}
          />
        ) : null}
        {tab === 'activity' ? (
          <ActivityTab conversationId={conversationId} number={number} />
        ) : null}
        {tab === 'diff' ? (
          <DiffTab conversationId={conversationId} number={number} state={detail.state} />
        ) : null}
      </div>
    </div>
  );
}

function DetailHeaderBar({
  onBack,
  onRefresh,
  refreshing,
  url,
}: {
  onBack: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  url?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-4 py-2">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Pull requests
      </button>

      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh this pull request"
          className="ml-auto rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'motion-spin-steps')} aria-hidden />
        </button>
      ) : null}

      {url ? (
        <button
          type="button"
          onClick={() => void window.atlasChat?.github?.openPr(url)}
          aria-label="Open on GitHub"
          className={cn(
            'rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary',
            onRefresh ? '' : 'ml-auto'
          )}
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function SummaryTab({
  conversationId,
  detail,
  onChanged,
}: {
  conversationId: string;
  detail: PullRequestDetail;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <LabelsEditor conversationId={conversationId} detail={detail} onChanged={onChanged} />

      {detail.body.trim() ? (
        <MessageResponseContent>{detail.body}</MessageResponseContent>
      ) : (
        <p className="text-sm text-text-faint">No description.</p>
      )}

      <ReviewersEditor conversationId={conversationId} detail={detail} onChanged={onChanged} />

      {detail.checks.length > 0 ? (
        <section>
          <h3 className="pb-1 pt-2 text-sm font-normal text-text-tertiary">
            Checks · {detail.checks.length}
          </h3>
          <ul>
            {detail.checks.map((check) => {
              const presentation = pullRequestCheckPresentation(check.status);
              return (
                <li
                  key={`${check.name}:${check.url ?? ''}`}
                  className="flex min-h-7 items-center gap-2.5 border-t border-border-subtle first:border-t-0"
                >
                  <presentation.Icon
                    role="img"
                    aria-label={presentation.label}
                    className={cn('size-3.5 shrink-0', presentation.toneClassName)}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-secondary" title={check.name}>
                    {check.name}
                  </span>
                  <span className="shrink-0 text-sm text-text-faint">{presentation.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The conversation, plus a box to add to it — and a review verdict.
 *
 * Loaded on the tab's first visit and kept afterwards, except when a comment or
 * review is posted — that is the one moment the panel knows its copy is stale.
 *
 * One body box carries all three actions. A review is a comment that also
 * says something about the change, so a separate form would only split what
 * the reader already wrote. Request-changes needs a body because GitHub does;
 * the button stays disabled until one is there.
 */
function ActivityTab({ conversationId, number }: { conversationId: string; number: number }) {
  const [activity, setActivity] = useState<PullRequestActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    if (!window.atlasChat?.github?.getPrActivity) return;
    setLoading(true);
    try {
      setActivity(await window.atlasChat.github.getPrActivity({ conversationId, number }));
    } catch (err) {
      notifyError('Could not load the pull request activity', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, number]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (verdict: PullRequestReviewVerdict | 'comment') => {
      const body = draft.trim();
      if (posting) return;
      if (verdict === 'comment' && !body) return;
      if (verdict === 'request-changes' && !body) return;

      setPosting(true);
      try {
        if (verdict === 'comment') {
          if (!window.atlasChat?.github?.commentOnPr) return;
          await window.atlasChat.github.commentOnPr({ conversationId, number, body });
        } else {
          if (!window.atlasChat?.github?.submitReviewOnPr) return;
          await window.atlasChat.github.submitReviewOnPr({ conversationId, number, verdict, body });
        }
        // Cleared only once the host has it. A failed post that emptied the box
        // would lose what the reader wrote.
        setDraft('');
        notify({
          tone: 'success',
          title:
            verdict === 'comment'
              ? 'Comment posted.'
              : verdict === 'approve'
                ? 'Pull request approved.'
                : 'Changes requested.',
        });
        await load();
      } catch (err) {
        notifyError(
          verdict === 'comment' ? 'Could not post the comment' : 'Could not submit the review',
          err
        );
      } finally {
        setPosting(false);
      }
    },
    [conversationId, draft, load, number, posting]
  );

  return (
    <div className="flex flex-col gap-3">
      {activity === null ? (
        <p className="text-sm text-text-faint">{loading ? 'Loading…' : 'Nothing to show.'}</p>
      ) : (
        <>
          {activity.comments.length === 0 ? (
            <p className="text-sm text-text-faint">No comments yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {activity.comments.map((comment, index) => (
                <li key={comment.id || `${comment.createdAt}:${index}`}>
                  <p className="flex items-center gap-2 pb-0.5 text-sm text-text-faint">
                    <span className="text-text-tertiary">{pullRequestActorLabel(comment.author)}</span>
                    {comment.verdict ? (
                      <span
                        className={
                          comment.verdict === 'approved'
                            ? 'text-emerald-600 dark:text-emerald-400/80'
                            : 'text-amber-600 dark:text-amber-400/80'
                        }
                      >
                        {comment.verdict === 'approved' ? 'approved' : 'requested changes'}
                      </span>
                    ) : null}
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </p>
                  {comment.body.trim() ? (
                    <MessageResponseContent className="text-sm">{comment.body}</MessageResponseContent>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {activity.commits.length > 0 ? (
            <section>
              <h3 className="pb-1 pt-2 text-sm font-normal text-text-tertiary">
                Commits · {activity.commits.length}
              </h3>
              <ul>
                {activity.commits.map((commit) => (
                  <li
                    key={commit.oid}
                    className="flex min-h-7 items-center gap-2.5 border-t border-border-subtle first:border-t-0"
                  >
                    <code className="shrink-0 font-mono text-sm text-text-tertiary">
                      {commit.oid.slice(0, 7)}
                    </code>
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-text-secondary"
                      title={commit.messageHeadline}
                    >
                      {commit.messageHeadline}
                    </span>
                    <span className="shrink-0 text-sm text-text-faint">
                      {pullRequestActorLabel(commit.author)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <div className="flex flex-col gap-1.5 pt-1">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Leave a comment, or write a review…"
          aria-label="Comment or review body"
          rows={3}
          className="w-full resize-y rounded-md bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-faint"
        />
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={posting || draft.trim().length === 0}
            onClick={() => void post('comment')}
            className={ACTION_CLASS}
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
          <button
            type="button"
            disabled={posting}
            onClick={() => void post('approve')}
            className={cn(ACTION_CLASS, 'text-emerald-700 dark:text-emerald-300/90')}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={posting || draft.trim().length === 0}
            title="Requesting changes needs a body explaining what to change"
            onClick={() => void post('request-changes')}
            className={cn(ACTION_CLASS, 'text-amber-700 dark:text-amber-300/90')}
          >
            Request changes
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The patch, plus the review that happens on it.
 *
 * `gh pr diff` prints one unified diff for the whole pull request, which is
 * exactly what `parseUnifiedDiff` already reads for tool output — so a pull
 * request's changes look like every other diff in the app rather than like a
 * second, nearly-identical renderer.
 *
 * Hover a line and press `+` to draft an inline comment. Drafts stay local
 * until a verdict is sent: GitHub keeps a review invisible until the whole of
 * it is posted, so a half-written one must stay invisible here too.
 */
function DiffTab({
  conversationId,
  number,
  state,
}: {
  conversationId: string;
  number: number;
  state: PullRequestDetail['state'];
}) {
  const [result, setResult] = useState<PullRequestDiffResult | null>(null);
  const [threads, setThreads] = useState<PullRequestReviewThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<PullRequestInlineCommentDraft[]>([]);
  const [summary, setSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!window.atlasChat?.github?.getPrDiff) return;
    setLoading(true);
    try {
      const [next, nextThreads] = await Promise.all([
        window.atlasChat.github.getPrDiff({ conversationId, number }),
        window.atlasChat.github.getPrThreads({ conversationId, number }).catch(() => []),
      ]);
      setResult(next);
      setThreads(nextThreads);
    } catch (err) {
      notifyError('Could not load the diff', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, number]);

  useEffect(() => {
    void load();
  }, [load]);

  const files = useMemo(() => (result ? parseUnifiedDiff(result.patch) : null), [result]);

  const commentsFor = useCallback(
    (line: DiffLine): ReviewComment[] => {
      const path = activePath;
      if (!path || line.lineNumber == null) return [];

      const side: PullRequestInlineCommentDraft['side'] = line.sign === '-' ? 'LEFT' : 'RIGHT';
      return drafts
        .filter((draft) => draft.path === path && draft.line === line.lineNumber && draft.side === side)
        .map((draft) => ({
          id: `${draft.path}:${draft.side}:${draft.line}`,
          path: draft.path,
          line: draft.line,
          code: line.content,
          body: draft.body,
        }));
    },
    [activePath, drafts]
  );

  const onAddComment = useCallback(
    (line: DiffLine) => {
      if (!activePath || line.lineNumber == null) return;
      const side: PullRequestInlineCommentDraft['side'] = line.sign === '-' ? 'LEFT' : 'RIGHT';
      setActiveLine(line.lineNumber);
      setDrafts((current) => [
        ...current,
        { path: activePath, line: line.lineNumber!, side, body: '' },
      ]);
    },
    [activePath]
  );

  const updateDraftBody = useCallback((index: number, body: string) => {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, body } : draft))
    );
  }, []);

  const removeDraft = useCallback((index: number) => {
    setDrafts((current) => current.filter((_, i) => i !== index));
  }, []);

  const submit = useCallback(
    async (verdict: PullRequestReviewVerdict) => {
      if (submitting || !window.atlasChat?.github?.submitReviewOnPr) return;
      const filled = drafts.filter((draft) => draft.body.trim());
      if (verdict === 'comment' && !summary.trim() && filled.length === 0) return;
      if (verdict === 'request-changes' && !summary.trim()) return;

      setSubmitting(true);
      try {
        await window.atlasChat.github.submitReviewOnPr({
          conversationId,
          number,
          verdict,
          body: summary.trim(),
          comments: filled,
        });
        setDrafts([]);
        setSummary('');
        notify({
          tone: 'success',
          title:
            verdict === 'approve'
              ? 'Pull request approved.'
              : verdict === 'request-changes'
                ? 'Changes requested.'
                : 'Review submitted.',
        });
        await load();
      } catch (err) {
        notifyError('Could not submit the review', err);
      } finally {
        setSubmitting(false);
      }
    },
    [conversationId, drafts, load, number, submitting, summary]
  );

  if (loading && !result) {
    return <p className="text-sm text-text-faint">Loading the diff…</p>;
  }

  if (!result || !result.patch.trim()) {
    return <p className="text-sm text-text-faint">This pull request changes nothing.</p>;
  }

  const openThreads = threads.filter((thread) => !thread.isResolved);
  const resolvedThreads = threads.filter((thread) => thread.isResolved);

  return (
    <div className="flex flex-col gap-3 pb-16">
      {result.truncated ? (
        <p className="text-sm text-amber-600 dark:text-amber-400/90">
          This patch is too large to show in full. What follows ends part-way through.
        </p>
      ) : null}

      {drafts.length > 0 || summary || state === 'open' ? (
        <ReviewBar
          drafts={drafts}
          summary={summary}
          submitting={submitting}
          canSubmit={state === 'open'}
          onSummaryChange={setSummary}
          onUpdateDraft={updateDraftBody}
          onRemoveDraft={removeDraft}
          onSubmit={submit}
        />
      ) : null}

      {files === null ? (
        <pre className="app-code-text m-0 overflow-x-auto whitespace-pre text-sm leading-[1.55] text-text-secondary">
          {result.patch}
        </pre>
      ) : (
        files.map((file, index) => {
          const isActive = activePath === file.path;
          return (
            <div key={`${file.path ?? 'file'}:${index}`} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  setActivePath(isActive ? null : file.path);
                  setActiveLine(null);
                }}
                className={cn(
                  'rounded px-1 py-0.5 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-bg-surface text-text-primary'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
                )}
              >
                {file.path}
              </button>
              {isActive ? (
                <DiffBlock file={file} onAddComment={onAddComment} commentsFor={commentsFor} />
              ) : (
                <DiffBlock file={file} />
              )}
            </div>
          );
        })
      )}

      {openThreads.length > 0 ? (
        <section>
          <h3 className="pb-1 pt-2 text-sm font-normal text-text-tertiary">
            Open threads · {openThreads.length}
          </h3>
          <div className="flex flex-col gap-2">
            {openThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                conversationId={conversationId}
                number={number}
                thread={thread}
                onChanged={load}
              />
            ))}
          </div>
        </section>
      ) : null}

      {resolvedThreads.length > 0 ? (
        <section>
          <h3 className="pb-1 pt-2 text-sm font-normal text-text-tertiary">
            Resolved · {resolvedThreads.length}
          </h3>
          <div className="flex flex-col gap-2 opacity-70">
            {resolvedThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                conversationId={conversationId}
                number={number}
                thread={thread}
                onChanged={load}
              />
            ))}
          </div>
        </section>
      ) : null}

      {activeLine != null ? (
        <p className="text-xs text-text-faint">
          Drafting on {activePath}:{activeLine}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The review form over the Code tab: pending line comments, a summary, and
 * the verdict that sends the lot. Hidden while the pull request is not open —
 * a closed change has no review left to submit.
 */
function ReviewBar({
  drafts,
  summary,
  submitting,
  canSubmit,
  onSummaryChange,
  onUpdateDraft,
  onRemoveDraft,
  onSubmit,
}: {
  drafts: PullRequestInlineCommentDraft[];
  summary: string;
  submitting: boolean;
  canSubmit: boolean;
  onSummaryChange: (body: string) => void;
  onUpdateDraft: (index: number, body: string) => void;
  onRemoveDraft: (index: number) => void;
  onSubmit: (verdict: PullRequestReviewVerdict) => void;
}) {
  const filled = drafts.filter((draft) => draft.body.trim());

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-base/95 p-2.5 backdrop-blur">
      {drafts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {drafts.map((draft, index) => (
            <li key={`${draft.path}:${draft.side}:${draft.line}:${index}`} className="flex flex-col gap-1">
              <p className="flex items-center gap-2 text-xs text-text-faint">
                <code className="font-mono">
                  {draft.path}:{draft.line}
                </code>
                <span>{draft.side === 'LEFT' ? 'old' : 'new'}</span>
                <button
                  type="button"
                  onClick={() => onRemoveDraft(index)}
                  className="ml-auto rounded px-1 text-text-tertiary hover:text-text-primary"
                >
                  Discard
                </button>
              </p>
              <textarea
                value={draft.body}
                onChange={(event) => onUpdateDraft(index, event.target.value)}
                placeholder="Leave a review comment on this line…"
                rows={2}
                className="w-full resize-y rounded bg-bg-surface px-2 py-1 text-sm text-text-primary outline-none placeholder:text-text-faint"
              />
            </li>
          ))}
        </ul>
      ) : null}

      <textarea
        value={summary}
        onChange={(event) => onSummaryChange(event.target.value)}
        placeholder="Review summary (optional for Comment and Approve)"
        rows={2}
        className="w-full resize-y rounded bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-faint"
      />

      {canSubmit ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={submitting || (filled.length === 0 && !summary.trim())}
            onClick={() => onSubmit('comment')}
            className={ACTION_CLASS}
          >
            {submitting ? 'Sending…' : 'Comment'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit('approve')}
            className={cn(ACTION_CLASS, 'text-emerald-700 dark:text-emerald-300/90')}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={submitting || !summary.trim()}
            title="Requesting changes needs a review summary"
            onClick={() => onSubmit('request-changes')}
            className={cn(ACTION_CLASS, 'text-amber-700 dark:text-amber-300/90')}
          >
            Request changes
          </button>
        </div>
      ) : (
        <p className="text-right text-xs text-text-faint">Reviews are closed on this pull request.</p>
      )}
    </div>
  );
}

function ThreadCard({
  conversationId,
  number,
  thread,
  onChanged,
}: {
  conversationId: string;
  number: number;
  thread: PullRequestReviewThread;
  onChanged: () => void | Promise<void>;
}) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (run: () => Promise<void>, done: string) => {
      setBusy(true);
      try {
        await run();
        notify({ tone: 'success', title: done });
        setReply('');
        await onChanged();
      } catch (err) {
        notifyError('Could not update the thread', err);
      } finally {
        setBusy(false);
      }
    },
    [onChanged]
  );

  return (
    <div className="rounded-md border border-border-subtle bg-bg-surface/40 p-2">
      <p className="flex flex-wrap items-center gap-2 pb-1 text-xs text-text-faint">
        <code className="font-mono">
          {thread.path}
          {thread.line != null ? `:${thread.line}` : ''}
        </code>
        {thread.isOutdated ? <span>outdated</span> : null}
        {thread.isResolved ? <span>resolved</span> : null}
      </p>

      <ul className="flex flex-col gap-2">
        {thread.comments.map((comment) => (
          <li key={comment.id}>
            <p className="flex items-center gap-2 text-xs text-text-faint">
              <span className="text-text-tertiary">{pullRequestActorLabel(comment.author)}</span>
              <span>{formatRelativeTime(comment.createdAt)}</span>
            </p>
            {comment.body.trim() ? (
              <MessageResponseContent className="text-sm">{comment.body}</MessageResponseContent>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1.5 pt-2">
        <textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Reply…"
          rows={2}
          className="w-full resize-y rounded bg-bg-base px-2 py-1 text-sm text-text-primary outline-none placeholder:text-text-faint"
        />
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={busy || !window.atlasChat?.github?.setPrThreadResolution}
            className={ACTION_CLASS}
            onClick={() =>
              void act(
                () =>
                  window.atlasChat!.github!.setPrThreadResolution({
                    conversationId,
                    number,
                    threadId: thread.id,
                    resolved: !thread.isResolved,
                  }),
                thread.isResolved ? 'Thread reopened.' : 'Thread resolved.'
              )
            }
          >
            {thread.isResolved ? 'Reopen' : 'Resolve'}
          </button>
          <button
            type="button"
            disabled={busy || !reply.trim() || !window.atlasChat?.github?.replyToPrThread}
            className={ACTION_CLASS}
            onClick={() =>
              void act(
                () =>
                  window.atlasChat!.github!.replyToPrThread({
                    conversationId,
                    number,
                    threadId: thread.id,
                    body: reply.trim(),
                  }),
                'Reply posted.'
              )
            }
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  );
}

function LabelsEditor({
  conversationId,
  detail,
  onChanged,
}: {
  conversationId: string;
  detail: PullRequestDetail;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<PullRequestLabelCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || candidates !== null) return;
    let cancelled = false;

    void window.atlasChat?.github
      ?.listPrLabels?.({ conversationId, number: detail.number })
      .then((next) => {
        if (!cancelled) setCandidates(next);
      })
      .catch((err) => notifyError('Could not load labels', err));

    return () => {
      cancelled = true;
    };
  }, [candidates, conversationId, detail.number, open]);

  const toggle = useCallback(
    async (label: PullRequestLabelCandidate) => {
      if (busy || !window.atlasChat?.github?.setPrLabels) return;
      setBusy(true);
      try {
        await window.atlasChat.github.setPrLabels({
          conversationId,
          number: detail.number,
          ...(label.isApplied ? { remove: [label.name] } : { add: [label.name] }),
        });
        setCandidates(null);
        await onChanged();
      } catch (err) {
        notifyError('Could not update labels', err);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, detail.number, onChanged]
  );

  return (
    <section>
      <div className="flex flex-wrap items-center gap-1.5">
        {detail.labels.map((label) => (
          <span
            key={label.name}
            className="rounded-full bg-bg-surface px-2 py-0.5 text-sm text-text-tertiary"
          >
            {label.name}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded px-1.5 py-0.5 text-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          {open ? 'Done' : 'Labels'}
        </button>
      </div>

      {open ? (
        <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-border-subtle">
          {(candidates ?? []).map((label) => (
            <li key={label.name}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggle(label)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm transition-colors hover:bg-bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-text-secondary">{label.name}</span>
                {label.isApplied ? <span className="text-xs text-emerald-600">on</span> : null}
              </button>
            </li>
          ))}
          {candidates !== null && candidates.length === 0 ? (
            <li className="px-2 py-1 text-sm text-text-faint">No labels on this repository.</li>
          ) : null}
          {candidates === null ? (
            <li className="px-2 py-1 text-sm text-text-faint">Loading…</li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

function ReviewersEditor({
  conversationId,
  detail,
  onChanged,
}: {
  conversationId: string;
  detail: PullRequestDetail;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<PullRequestReviewerCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || candidates !== null) return;
    let cancelled = false;

    void window.atlasChat?.github
      ?.listPrReviewers?.({ conversationId, number: detail.number })
      .then((next) => {
        if (!cancelled) setCandidates(next);
      })
      .catch((err) => notifyError('Could not load reviewers', err));

    return () => {
      cancelled = true;
    };
  }, [candidates, conversationId, detail.number, open]);

  const toggle = useCallback(
    async (login: string, isRequested: boolean) => {
      if (busy || !window.atlasChat?.github?.requestPrReviewers) return;
      setBusy(true);
      try {
        await window.atlasChat.github.requestPrReviewers({
          conversationId,
          number: detail.number,
          ...(isRequested ? { remove: [login] } : { add: [login] }),
        });
        setCandidates(null);
        await onChanged();
      } catch (err) {
        notifyError('Could not update the review request', err);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, detail.number, onChanged]
  );

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-normal text-text-tertiary">Reviewers</h3>
        <span className="text-sm text-text-secondary">
          {detail.reviewRequests.length > 0 ? detail.reviewRequests.join(', ') : 'None requested'}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded px-1.5 py-0.5 text-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          {open ? 'Done' : 'Edit'}
        </button>
      </div>

      {open ? (
        <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-border-subtle">
          {(candidates ?? []).map((candidate) => (
            <li key={candidate.login}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggle(candidate.login, candidate.isRequested)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm transition-colors hover:bg-bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-text-secondary">
                  {candidate.login}
                  {candidate.name ? ` · ${candidate.name}` : ''}
                </span>
                {candidate.isRequested ? <span className="text-xs text-emerald-600">requested</span> : null}
              </button>
            </li>
          ))}
          {candidates !== null && candidates.length === 0 ? (
            <li className="px-2 py-1 text-sm text-text-faint">No collaborators listed.</li>
          ) : null}
          {candidates === null ? (
            <li className="px-2 py-1 text-sm text-text-faint">Loading…</li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
