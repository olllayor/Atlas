/**
 * The app-wide Pull requests page.
 *
 * Structured after t3code's `/pull-requests`: one content pane beside the
 * sidebar (never a full-window takeover), every project that has a GitHub
 * remote, grouped by who the work is waiting on rather than by which folder
 * it lives in. A reader arrives here asking "what needs me", not "which
 * project shall I open first".
 *
 * Detail is a right panel on the same page, not a second route — the row they
 * came from stays where they left it. Unavailability prints the command that
 * fixes it, the same way the workbench panel does.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';

import type {
  PullRequestInvolvement,
  PullRequestListState,
  PullRequestWorkspaceEntry,
  PullRequestWorkspaceListResult,
} from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { PullRequestDetailPanel } from '../workbench/PullRequestDetailPanel';
import { PullRequestEmptyState } from '../workbench/PullRequestsPanel';
import {
  narrowPullRequests,
  parsePullRequestQuery,
  pullRequestLabelColor,
  sortPullRequestsByUpdated,
} from '../workbench/pullRequestList.logic';
import {
  PullRequestChecksGlyph,
  PullRequestDiffStat,
  PullRequestStateGlyph,
  formatRelativeTime,
  pullRequestActorLabel,
} from '../workbench/pullRequestPresentation';

const EMPTY_RESULT: PullRequestWorkspaceListResult = {
  unavailable: null,
  entries: [],
  truncated: false,
  viewer: null,
  scanned: { projects: 0, git: 0, github: 0, repositories: [] },
};

const STATE_TABS: { value: PullRequestListState; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const INVOLVEMENT_TABS: { value: PullRequestInvolvement; label: string; title: string }[] = [
  { value: 'all', label: 'Everyone', title: 'Every pull request on these repositories' },
  { value: 'authored', label: 'Mine', title: 'Pull requests you opened' },
  { value: 'reviewing', label: 'Review', title: 'Pull requests waiting on your review' },
];

const SEGMENT_CLASS =
  'rounded px-2 py-0.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** How often an open page quietly re-reads, matching t3code's live refresh. */
const LIVE_REFRESH_MS = 5 * 60_000;

type Selection = { projectRoot: string; number: number };

export function PullRequestsWorkspace({ onBack }: { onBack: () => void }) {
  const [result, setResult] = useState<PullRequestWorkspaceListResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PullRequestListState>('open');
  const [involvement, setInvolvement] = useState<PullRequestInvolvement>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);

  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!window.atlasChat?.github?.listWorkspacePrs) return;

    const token = ++requestRef.current;
    setLoading(true);

    try {
      const next = await window.atlasChat.github.listWorkspacePrs({ state, involvement });
      if (requestRef.current !== token) return;
      setResult(next);
    } catch (err) {
      if (requestRef.current !== token) return;
      notifyError('Could not load pull requests', err);
    } finally {
      if (requestRef.current === token) setLoading(false);
    }
  }, [involvement, state]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Quiet re-read while the page is open. Stopped when the tab is hidden so a
  // background window does not burn `gh` processes for nobody.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visible = useMemo(() => {
    const parsed = parsePullRequestQuery(query);
    return sortPullRequestsByUpdated(
      narrowPullRequests(result.entries, parsed, result.viewer)
    ) as PullRequestWorkspaceEntry[];
  }, [query, result.entries, result.viewer]);

  const groups = useMemo(
    () => groupByInvolvement(visible, result.viewer),
    [visible, result.viewer]
  );

  if (selected) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <PullRequestDetailPanel
          projectRoot={selected.projectRoot}
          number={selected.number}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Title bar matches the chat chrome height so the main pane does not
          jump when switching destinations. Sidebar stays mounted beside this. */}
      <div className="flex shrink-0 items-center gap-2 px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chat"
          className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
        </button>
        <h1 className="text-base text-text-primary">Pull Requests</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh pull requests"
          className="ml-auto rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <RefreshCw className={cn('size-3.5', loading && 'motion-spin-steps')} aria-hidden />
        </button>
      </div>

      <div className="shrink-0 px-5 pb-3">
        <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-3 py-2">
          <Search className="size-4 shrink-0 text-text-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pull requests, or label:bug"
            aria-label="Search pull requests"
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {result.unavailable && result.entries.length === 0 && !loading ? (
          <PullRequestEmptyState
            title="Pull requests unavailable"
            body={result.unavailable.hint}
            action={result.unavailable.action}
          />
        ) : groups.length === 0 ? (
          <EmptyListBody
            loading={loading}
            query={query}
            scanned={result.scanned}
            state={state}
          />
        ) : (
          groups.map((group) => (
            <section key={group.key} className="pb-4">
              <h2 className="pb-1 pt-2 text-sm font-normal text-text-tertiary">{group.label}</h2>
              <ul>
                {group.entries.map((entry) => (
                  <WorkspaceRow
                    key={`${entry.projectRoot}#${entry.number}`}
                    entry={entry}
                    onSelect={(number) => setSelected({ projectRoot: entry.projectRoot, number })}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {result.truncated ? (
          <p className="pt-2 text-sm text-text-faint">
            Showing the most recently updated pull requests. Narrow the filter to reach older ones.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Why the list is empty, in the reader's terms.
 *
 * "No pull requests" alone reads like a bug. Naming the scan — how many
 * projects, how many git checkouts, how many GitHub remotes — is what tells
 * a reader whether the page is wrong or their workspace simply has nothing
 * open.
 */
function EmptyListBody({
  loading,
  query,
  scanned,
  state,
}: {
  loading: boolean;
  query: string;
  scanned: PullRequestWorkspaceListResult['scanned'];
  state: PullRequestListState;
}) {
  if (loading) {
    return <p className="py-3 text-sm text-text-faint">Loading…</p>;
  }

  if (query.trim()) {
    return <p className="py-3 text-sm text-text-faint">Nothing matches this filter.</p>;
  }

  const repoNote =
    scanned.github === 1
      ? `1 GitHub repository (${scanned.repositories[0]})`
      : `${scanned.github} GitHub repositories`;

  return (
    <div className="flex flex-col gap-1 py-3">
      <p className="text-sm text-text-secondary">
        {state === 'open' ? 'No open pull requests.' : `No ${state} pull requests.`}
      </p>
      <p className="text-sm text-text-faint">
        Scanned {repoNote}
        {scanned.git > scanned.github
          ? ` · ${scanned.git - scanned.github} project${scanned.git - scanned.github === 1 ? '' : 's'} without a GitHub origin`
          : ''}
        .
      </p>
    </div>
  );
}

function groupByInvolvement(
  entries: PullRequestWorkspaceEntry[],
  viewer: string | null
): Array<{ key: string; label: string; entries: PullRequestWorkspaceEntry[] }> {
  if (!viewer) {
    return entries.length > 0 ? [{ key: 'all', label: 'Pull requests', entries }] : [];
  }

  const login = viewer.toLowerCase();
  const authored: PullRequestWorkspaceEntry[] = [];
  const reviewing: PullRequestWorkspaceEntry[] = [];
  const others: PullRequestWorkspaceEntry[] = [];

  for (const entry of entries) {
    if (entry.author?.login?.toLowerCase() === login) {
      authored.push(entry);
    } else if (entry.reviewRequests.some((request) => request.toLowerCase() === login)) {
      reviewing.push(entry);
    } else {
      others.push(entry);
    }
  }

  return [
    { key: 'authored', label: 'Authored', entries: authored },
    { key: 'reviewing', label: 'Review requested', entries: reviewing },
    { key: 'others', label: 'Others', entries: others },
  ].filter((group) => group.entries.length > 0);
}

function WorkspaceRow({
  entry,
  onSelect,
}: {
  entry: PullRequestWorkspaceEntry;
  onSelect: (number: number) => void;
}) {
  const updated = formatRelativeTime(entry.updatedAt);

  return (
    <li className="border-t border-border-subtle first:border-t-0 [content-visibility:auto] [contain-intrinsic-block-size:64px]">
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
            {entry.reviewDecision === 'approved' || entry.reviewDecision === 'changes-requested' ? (
              <span
                className={
                  entry.reviewDecision === 'approved'
                    ? 'text-emerald-600 dark:text-emerald-400/80'
                    : 'text-amber-600 dark:text-amber-400/80'
                }
              >
                {entry.reviewDecision === 'approved' ? 'Approved' : 'Changes requested'}
              </span>
            ) : null}
            {entry.checksState ? <PullRequestChecksGlyph checksState={entry.checksState} /> : null}
          </span>

          <span className="col-start-1 row-start-2 flex min-w-0 items-center gap-2 overflow-hidden text-sm text-text-faint">
            <span className="shrink-0 tabular-nums">#{entry.number}</span>
            <span className="min-w-0 truncate font-mono text-xs">{entry.repository}</span>
            <span className="min-w-0 truncate">{entry.projectTitle}</span>
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
          </span>

          <span className="col-start-2 row-start-2 flex shrink-0 items-center gap-3 justify-self-end whitespace-nowrap text-sm text-text-faint">
            <span className="min-w-0 truncate">{pullRequestActorLabel(entry.author)}</span>
            <PullRequestDiffStat additions={entry.additions} deletions={entry.deletions} />
            {updated ? <span>{updated}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}
