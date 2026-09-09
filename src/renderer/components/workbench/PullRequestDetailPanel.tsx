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
} from '../../../shared/contracts';
import { parseUnifiedDiff } from '../../../shared/toolCellGrammar';
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
  merge: { verb: 'Merge', done: 'Pull request merged.' },
};

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
    async (action: PullRequestAction) => {
      if (!window.atlasChat?.github?.runPrAction) return;
      setBusy(true);

      try {
        await window.atlasChat.github.runPrAction({ conversationId, number, action });
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
            <button type="button" disabled={busy} className={ACTION_CLASS} onClick={() => void runAction('merge')}>
              Merge
            </button>
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
        {tab === 'summary' ? <SummaryTab detail={detail} /> : null}
        {tab === 'activity' ? (
          <ActivityTab conversationId={conversationId} number={number} />
        ) : null}
        {tab === 'diff' ? <DiffTab conversationId={conversationId} number={number} /> : null}
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

function SummaryTab({ detail }: { detail: PullRequestDetail }) {
  return (
    <div className="flex flex-col gap-3">
      {detail.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {detail.labels.map((label) => (
            <span key={label.name} className="rounded-full bg-bg-surface px-2 py-0.5 text-sm text-text-tertiary">
              {label.name}
            </span>
          ))}
        </div>
      ) : null}

      {detail.body.trim() ? (
        <MessageResponseContent>{detail.body}</MessageResponseContent>
      ) : (
        <p className="text-sm text-text-faint">No description.</p>
      )}

      {detail.reviewRequests.length > 0 ? (
        <section>
          <h3 className="pb-1 pt-2 text-sm font-normal text-text-tertiary">Review requested</h3>
          <p className="text-sm text-text-secondary">{detail.reviewRequests.join(', ')}</p>
        </section>
      ) : null}

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
 * The conversation, plus a box to add to it.
 *
 * Loaded on the tab's first visit and kept afterwards, except when a comment is
 * posted — that is the one moment the panel knows its copy is stale.
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

  const post = useCallback(async () => {
    const body = draft.trim();
    if (!body || !window.atlasChat?.github?.commentOnPr) return;

    setPosting(true);
    try {
      await window.atlasChat.github.commentOnPr({ conversationId, number, body });
      // Cleared only once the host has it. A failed post that emptied the box
      // would lose what the reader wrote.
      setDraft('');
      notify({ tone: 'success', title: 'Comment posted.' });
      await load();
    } catch (err) {
      notifyError('Could not post the comment', err);
    } finally {
      setPosting(false);
    }
  }, [conversationId, draft, load, number]);

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
          placeholder="Leave a comment…"
          aria-label="Comment on this pull request"
          rows={3}
          className="w-full resize-y rounded-md bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-faint"
        />
        <button
          type="button"
          disabled={posting || draft.trim().length === 0}
          onClick={() => void post()}
          className={cn(ACTION_CLASS, 'self-end')}
        >
          {posting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

/**
 * The patch, through the workbench's own diff chrome.
 *
 * `gh pr diff` prints one unified diff for the whole pull request, which is
 * exactly what `parseUnifiedDiff` already reads for tool output — so a pull
 * request's changes look like every other diff in the app rather than like a
 * second, nearly-identical renderer.
 */
function DiffTab({ conversationId, number }: { conversationId: string; number: number }) {
  const [result, setResult] = useState<PullRequestDiffResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!window.atlasChat?.github?.getPrDiff) return;
      setLoading(true);
      try {
        const next = await window.atlasChat.github.getPrDiff({ conversationId, number });
        if (!cancelled) setResult(next);
      } catch (err) {
        if (!cancelled) notifyError('Could not load the diff', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId, number]);

  const files = useMemo(
    () => (result ? parseUnifiedDiff(result.patch) : null),
    [result]
  );

  if (loading && !result) {
    return <p className="text-sm text-text-faint">Loading the diff…</p>;
  }

  if (!result || !result.patch.trim()) {
    return <p className="text-sm text-text-faint">This pull request changes nothing.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {result.truncated ? (
        <p className="text-sm text-amber-600 dark:text-amber-400/90">
          This patch is too large to show in full. What follows ends part-way through.
        </p>
      ) : null}

      {files === null ? (
        // The parser refused it, so the raw patch is shown rather than nothing:
        // an unparseable diff is still readable, and hiding it would be worse
        // than showing it plainly.
        <pre className="app-code-text m-0 overflow-x-auto whitespace-pre text-sm leading-[1.55] text-text-secondary">
          {result.patch}
        </pre>
      ) : (
        files.map((file, index) => <DiffBlock key={`${file.path ?? 'file'}:${index}`} file={file} />)
      )}
    </div>
  );
}
