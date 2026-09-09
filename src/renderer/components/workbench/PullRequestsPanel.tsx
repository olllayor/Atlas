/**
 * The workbench Pull requests tab: a listing, and one pull request at a time.
 *
 * Structured after t3code's pull request page, cut to what one repository and
 * one host need. Three of its shapes are kept deliberately:
 *
 * - The list and the detail are one surface, not two tabs. A reader arrives at
 *   a pull request by clicking a row, and leaves it by going back, so the row
 *   they came from is still where they left it.
 * - One filter box carries both text and qualifiers, so every narrowing is
 *   undone by deleting a word. See `pullRequestList.logic.ts`.
 * - Unavailability prints the command that fixes it. A missing `gh` and a
 *   signed-out `gh` are different problems, and an empty list says neither.
 *
 * Presentation follows the rest of the workbench — borderless rows, hairline
 * separators, opacity for hierarchy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitPullRequest, Plus, RefreshCw, Search, X } from 'lucide-react';

import type {
  PullRequestCreateResult,
  PullRequestInvolvement,
  PullRequestListEntry,
  PullRequestListResult,
  PullRequestListState,
} from '../../../shared/contracts';
import { notify, notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { PullRequestDetailPanel } from './PullRequestDetailPanel';
import {
  narrowPullRequests,
  parsePullRequestQuery,
  pullRequestLabelColor,
  sortPullRequestsByUpdated,
} from './pullRequestList.logic';
import {
  PullRequestChecksGlyph,
  PullRequestDiffStat,
  PullRequestStateGlyph,
  formatRelativeTime,
  pullRequestActorLabel,
} from './pullRequestPresentation';

const EMPTY_RESULT: PullRequestListResult = {
  unavailable: null,
  entries: [],
  truncated: false,
  repository: null,
  viewer: null,
};

const STATE_TABS: { value: PullRequestListState; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const INVOLVEMENT_TABS: { value: PullRequestInvolvement; label: string; title: string }[] = [
  { value: 'all', label: 'Everyone', title: 'Every pull request on this repository' },
  { value: 'authored', label: 'Mine', title: 'Pull requests you opened' },
  { value: 'reviewing', label: 'Review', title: 'Pull requests waiting on your review' },
];

const SEGMENT_CLASS =
  'rounded px-2 py-0.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40';

export function PullRequestsPanel({ conversationId }: { conversationId?: string }) {
  const [result, setResult] = useState<PullRequestListResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PullRequestListState>('open');
  const [involvement, setInvolvement] = useState<PullRequestInvolvement>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  /**
   * Guards against a slow page landing on top of a fast one. Two listings are
   * in flight whenever a reader switches tabs while the first is still running,
   * and the older answer must not win.
   */
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!conversationId || !window.atlasChat?.github?.listPrs) return;

    const token = ++requestRef.current;
    setLoading(true);

    try {
      const next = await window.atlasChat.github.listPrs({
        conversationId,
        state,
        involvement,
      });
      if (requestRef.current !== token) return;
      setResult(next);
    } catch (err) {
      if (requestRef.current !== token) return;
      // The listing keeps whatever it last had rather than blanking: a failed
      // refresh of a page that loaded is not a reason to lose the page.
      notifyError('Could not load pull requests', err);
    } finally {
      if (requestRef.current === token) setLoading(false);
    }
  }, [conversationId, involvement, state]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The query narrows what already arrived rather than re-asking the host on
  // every keystroke: the page is at most a hundred rows, and a local filter is
  // instant where a round trip through `gh` is not.
  const visible = useMemo(() => {
    const parsed = parsePullRequestQuery(query);
    return sortPullRequestsByUpdated(narrowPullRequests(result.entries, parsed, result.viewer));
  }, [query, result.entries, result.viewer]);

  if (!conversationId) {
    return (
      <PullRequestEmptyState
        title="No conversation open"
        body="Open a conversation to read the pull requests on its project."
      />
    );
  }

  if (selected !== null) {
    return (
      <PullRequestDetailPanel
        conversationId={conversationId}
        number={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (result.unavailable) {
    return (
      <PullRequestEmptyState
        title="Pull requests unavailable"
        body={result.unavailable.hint}
        action={result.unavailable.action}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 py-2">
        <div className="flex items-center gap-2 py-1.5">
          <span className="min-w-0 truncate text-base text-text-primary">
            {result.repository ?? 'Pull requests'}
          </span>
          <button
            type="button"
            onClick={() => setShowCreate((open) => !open)}
            aria-expanded={showCreate}
            title="Open a pull request for the current branch"
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            {showCreate ? <X className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
            {showCreate ? 'Cancel' : 'New'}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh pull requests"
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <RefreshCw className={cn('size-3.5', loading && 'motion-spin-steps')} aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2">
          <div className="flex items-center gap-0.5" role="group" aria-label="State">
            {STATE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={state === tab.value}
                onClick={() => setState(tab.value)}
                className={cn(
                  SEGMENT_CLASS,
                  state === tab.value
                    ? 'bg-bg-surface text-text-primary'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-0.5" role="group" aria-label="Involvement">
            {INVOLVEMENT_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                title={
                  // `Mine` and `Review` are both defined in terms of the
                  // signed-in login, so they say so rather than silently
                  // matching nothing when `gh` could not name one.
                  result.viewer ? tab.title : `${tab.title} — no signed-in account was found`
                }
                aria-pressed={involvement === tab.value}
                disabled={tab.value !== 'all' && !result.viewer}
                onClick={() => setInvolvement(tab.value)}
                className={cn(
                  SEGMENT_CLASS,
                  involvement === tab.value
                    ? 'bg-bg-surface text-text-primary'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-md bg-bg-surface px-2 py-1">
          <Search className="size-3.5 shrink-0 text-text-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter — try author:me, label:bug, is:draft, review:approved"
            aria-label="Filter pull requests"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="shrink-0 rounded px-1 text-sm text-text-tertiary transition-colors hover:text-text-primary"
            >
              Clear
            </button>
          ) : null}
        </label>

        {showCreate && conversationId ? (
          <CreatePullRequestForm
            conversationId={conversationId}
            onCreated={(created) => {
              setShowCreate(false);
              setState('open');
              setSelected(created.number);
              void refresh();
            }}
            onCancel={() => setShowCreate(false)}
          />
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {visible.length === 0 ? (
          <p className="py-3 text-sm text-text-faint">
            {result.entries.length === 0
              ? loading
                ? 'Loading…'
                : 'No pull requests here.'
              : 'Nothing matches this filter.'}
          </p>
        ) : (
          <ul>
            {visible.map((entry) => (
              <PullRequestRow key={entry.number} entry={entry} onSelect={setSelected} />
            ))}
          </ul>
        )}

        {result.truncated ? (
          <p className="pt-2 text-sm text-text-faint">
            Showing the most recently updated {result.entries.length}. Narrow the filter to reach
            older ones.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PullRequestRow({
  entry,
  onSelect,
}: {
  entry: PullRequestListEntry;
  onSelect: (number: number) => void;
}) {
  const updated = formatRelativeTime(entry.updatedAt);

  return (
    <li
      // Offscreen rows are skipped for style, layout and paint, so a long list
      // costs what the viewport shows. The intrinsic size keeps the scrollbar
      // honest while a row is skipped.
      className="border-t border-border-subtle first:border-t-0 [content-visibility:auto] [contain-intrinsic-block-size:58px]"
    >
      <button
        type="button"
        onClick={() => onSelect(entry.number)}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-md px-1 py-2 text-left transition-colors hover:bg-bg-hover"
      >
        <PullRequestStateGlyph
          state={entry.state}
          isDraft={entry.isDraft}
          mergeability={entry.mergeability}
          baseBranch={entry.baseRefName}
        />

        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="col-start-1 row-start-1 truncate text-base text-text-primary">
            {entry.title}
          </span>

          <span className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 justify-self-end text-sm">
            {/* Only a verdict somebody actually gave: "review required" is the
                absence of one, and saying so on every unreviewed row would
                say nothing. */}
            {entry.reviewDecision === 'approved' || entry.reviewDecision === 'changes-requested' ? (
              <span
                className={cn(
                  entry.reviewDecision === 'approved'
                    ? 'text-emerald-600 dark:text-emerald-400/80'
                    : 'text-amber-600 dark:text-amber-400/80'
                )}
              >
                {entry.reviewDecision === 'approved' ? 'Approved' : 'Changes requested'}
              </span>
            ) : null}
            {entry.checksState ? <PullRequestChecksGlyph checksState={entry.checksState} /> : null}
          </span>

          <span className="col-start-1 row-start-2 flex min-w-0 items-center gap-2 overflow-hidden text-sm text-text-faint">
            <span className="shrink-0 tabular-nums">#{entry.number}</span>
            <span className="min-w-0 truncate">{pullRequestActorLabel(entry.author)}</span>
            {entry.labels.slice(0, 2).map((label) => {
              const dot = pullRequestLabelColor(label.color);
              return (
                <span
                  key={label.name}
                  className="flex min-w-0 max-w-32 shrink-0 items-center gap-1 rounded-full bg-bg-surface px-1.5 text-xs"
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-text-faint"
                    {...(dot ? { style: { backgroundColor: dot } } : {})}
                  />
                  <span className="truncate">{label.name}</span>
                </span>
              );
            })}
            {entry.labels.length > 2 ? (
              <span className="shrink-0">+{entry.labels.length - 2}</span>
            ) : null}
          </span>

          <span className="col-start-2 row-start-2 flex shrink-0 items-center gap-3 justify-self-end whitespace-nowrap text-sm text-text-faint">
            <PullRequestDiffStat additions={entry.additions} deletions={entry.deletions} />
            {updated ? <span>{updated}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Nothing to show, and why.
 *
 * `action` is the one command that fixes it, printed as code because it is
 * meant to be typed. Absent where there is nothing to type — an unattached
 * project is fixed in the app, not in a shell.
 */
export function PullRequestEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-base text-text-secondary">{title}</p>
      <p className="max-w-[38ch] text-sm leading-relaxed text-text-faint">{body}</p>
      {action ? (
        <code className="mt-1 rounded bg-bg-surface px-2 py-1 font-mono text-sm text-text-tertiary">
          {action}
        </code>
      ) : null}
    </div>
  );
}

/**
 * Open a pull request for the current branch.
 *
 * Push is folded into the request the way the agent tool folds it: a pull
 * request cannot exist without the branch on the remote, and discovering
 * "no upstream" after typing a title is a pointless round trip. An existing
 * pull request is returned rather than treated as a failure — the common
 * follow-up-commit case is not an error.
 */
function CreatePullRequestForm({
  conversationId,
  onCreated,
  onCancel,
}: {
  conversationId: string;
  onCreated: (result: PullRequestCreateResult) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [base, setBase] = useState('');
  const [draft, setDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBranch() {
      if (!window.atlasChat?.github?.getPrStatus) return;
      try {
        const status = await window.atlasChat.github.getPrStatus(conversationId);
        if (!cancelled && status.branch) setBranch(status.branch);
      } catch {
        // The form still works without the branch name; the create request
        // resolves HEAD on the main side either way.
      }
    }

    void loadBranch();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const submit = useCallback(async () => {
    const nextTitle = title.trim();
    if (!nextTitle || submitting || !window.atlasChat?.github?.createPr) return;

    setSubmitting(true);
    try {
      const result = await window.atlasChat.github.createPr({
        conversationId,
        title: nextTitle,
        body: body.trim(),
        base: base.trim() || undefined,
        draft,
      });

      notify({
        tone: 'success',
        title: result.alreadyExisted
          ? 'This branch already has an open pull request.'
          : 'Pull request opened.',
      });
      onCreated(result);
    } catch (err) {
      notifyError('Could not open the pull request', err);
    } finally {
      setSubmitting(false);
    }
  }, [base, body, conversationId, draft, onCreated, submitting, title]);

  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-surface/40 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="flex items-center gap-1.5 text-sm text-text-tertiary">
        <GitPullRequest className="size-3.5" aria-hidden />
        {branch ? (
          <>
            Open a pull request from <code className="font-mono text-text-secondary">{branch}</code>
          </>
        ) : (
          'Open a pull request for the current branch'
        )}
      </p>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
        aria-label="Pull request title"
        className="rounded-md bg-bg-base px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-faint"
        autoFocus
      />

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Description (optional)"
        aria-label="Pull request description"
        rows={3}
        className="w-full resize-y rounded-md bg-bg-base px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-faint"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-text-tertiary">
          <span className="shrink-0">Base</span>
          <input
            value={base}
            onChange={(event) => setBase(event.target.value)}
            placeholder="default"
            aria-label="Base branch"
            className="min-w-0 flex-1 rounded-md bg-bg-base px-2 py-1 font-mono text-xs text-text-primary outline-none placeholder:text-text-faint"
          />
        </label>

        <label className="flex shrink-0 items-center gap-1.5 text-sm text-text-tertiary">
          <input
            type="checkbox"
            checked={draft}
            onChange={(event) => setDraft(event.target.checked)}
            className="size-3.5 accent-emerald-600"
          />
          Draft
        </label>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded bg-transparent px-2 py-0.5 text-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || title.trim().length === 0}
          className="rounded bg-bg-surface px-2 py-0.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Opening…' : 'Open pull request'}
        </button>
      </div>
    </form>
  );
}
