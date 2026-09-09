/**
 * The app-wide Pull requests page — t3code's `/pull-requests` shape.
 *
 * Title in the header. One controls row: search takes the width, Sort and
 * Filters are menus, Refresh sits with them. No pill strip under the search —
 * state and involvement live inside Filters, the way t3code keeps them.
 *
 * Groups are Authored / Review requested / Others. Selecting a row opens the
 * detail beside the list, not instead of it. The sidebar stays mounted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarArrowDown,
  CalendarArrowUp,
  Clock,
  Eye,
  Filter,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Layers,
  ListChecks,
  Maximize2,
  Minimize2,
  PenLine,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';

import type {
  PullRequestInvolvement,
  PullRequestListState,
  PullRequestWorkspaceEntry,
  PullRequestWorkspaceListResult,
} from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { PullRequestDetailPanel } from '../workbench/PullRequestDetailPanel';
import { PullRequestEmptyState } from '../workbench/PullRequestsPanel';
import {
  narrowPullRequests,
  parsePullRequestQuery,
  pullRequestLabelColor,
  sortPullRequests,
  type PullRequestListSort,
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

const STATE_OPTIONS: { value: PullRequestListState; label: string; Icon: typeof Layers }[] = [
  { value: 'all', label: 'All', Icon: Layers },
  { value: 'open', label: 'Open', Icon: GitPullRequest },
  { value: 'closed', label: 'Closed', Icon: GitPullRequestClosed },
  { value: 'merged', label: 'Merged', Icon: GitMerge },
];

const INVOLVEMENT_OPTIONS: { value: PullRequestInvolvement; label: string; Icon: typeof Layers }[] = [
  { value: 'all', label: 'All', Icon: Layers },
  { value: 'reviewing', label: 'Reviewing', Icon: Eye },
  { value: 'authored', label: 'Authored', Icon: PenLine },
];

const SORT_OPTIONS: { value: PullRequestListSort; label: string; Icon: typeof Layers }[] = [
  { value: 'ready', label: 'Merge readiness', Icon: ListChecks },
  { value: 'updated', label: 'Recently updated', Icon: Clock },
  { value: 'newest', label: 'Newest shown', Icon: CalendarArrowDown },
  { value: 'oldest', label: 'Oldest shown', Icon: CalendarArrowUp },
  { value: 'largest', label: 'Largest shown', Icon: Maximize2 },
  { value: 'smallest', label: 'Smallest shown', Icon: Minimize2 },
];

const LIVE_REFRESH_MS = 5 * 60_000;

type Selection = { projectRoot: string; number: number };

export function PullRequestsWorkspace({ onBack }: { onBack: () => void }) {
  const [result, setResult] = useState<PullRequestWorkspaceListResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PullRequestListState>('open');
  const [involvement, setInvolvement] = useState<PullRequestInvolvement>('all');
  const [sort, setSort] = useState<PullRequestListSort>('ready');
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visible = useMemo(() => {
    const parsed = parsePullRequestQuery(query);
    const narrowed = narrowPullRequests(result.entries, parsed, result.viewer);
    return sortPullRequests(narrowed, sort) as PullRequestWorkspaceEntry[];
  }, [query, result.entries, result.viewer, sort]);

  const groups = useMemo(
    () => groupByInvolvement(visible, result.viewer),
    [visible, result.viewer]
  );

  const sortLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Merge readiness';

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* List column. Title bar matches chat chrome so the pane does not jump. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to chat"
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
          </button>
          <h1 className="truncate text-base text-text-primary">Pull Requests</h1>
        </div>

        {/* One controls row: search owns the width; Sort, Filters, Refresh sit with it. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-3">
          <label className="flex min-w-0 flex-1 basis-full items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 sm:basis-0">
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

          <FilterMenu
            label="Sort"
            triggerIcon={<SlidersHorizontal className="size-3.5" aria-hidden />}
            triggerLabel={sortLabel}
            value={sort}
            options={SORT_OPTIONS}
            onChange={(next) => setSort(next)}
          />

          <FilterMenu
            label="Filters"
            triggerIcon={<Filter className="size-3.5" aria-hidden />}
            triggerLabel="Filters"
            value={state}
            options={STATE_OPTIONS}
            onChange={(next) => setState(next)}
            secondary={{
              label: 'Involvement',
              value: involvement,
              options: INVOLVEMENT_OPTIONS,
              onChange: (next) => setInvolvement(next as PullRequestInvolvement),
            }}
          />

          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh pull requests"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <RefreshCw className={cn('size-3.5', loading && 'motion-spin-steps')} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {result.unavailable && result.entries.length === 0 && !loading ? (
            <PullRequestEmptyState
              title="Pull requests unavailable"
              body={result.unavailable.hint}
              action={result.unavailable.action}
            />
          ) : groups.length === 0 ? (
            <EmptyListBody loading={loading} query={query} scanned={result.scanned} state={state} />
          ) : (
            groups.map((group) => (
              <section key={group.key} className="pb-3">
                <h2 className="pb-1 pt-2 text-xs font-normal uppercase tracking-wide text-text-faint">
                  {group.label}
                </h2>
                <ul>
                  {group.entries.map((entry) => (
                    <WorkspaceRow
                      key={`${entry.projectRoot}#${entry.number}`}
                      entry={entry}
                      selected={
                        selected?.projectRoot === entry.projectRoot && selected.number === entry.number
                      }
                      onSelect={(number) =>
                        setSelected({ projectRoot: entry.projectRoot, number })
                      }
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

      {/* Detail opens beside the list, the way t3code's right panel does. */}
      {selected ? (
        <div className="flex w-[min(28rem,45%)] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border-subtle">
          <PullRequestDetailPanel
            projectRoot={selected.projectRoot}
            number={selected.number}
            onBack={() => setSelected(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A compact outlined menu trigger, the t3code Sort / Filters shape.
 *
 * Two radio groups share the Filters popup so state and involvement stay out
 * of the header as separate pill strips — one control, two dimensions.
 */
function FilterMenu<Value extends string>({
  label,
  triggerIcon,
  triggerLabel,
  value,
  options,
  onChange,
  secondary,
}: {
  label: string;
  triggerIcon?: React.ReactNode;
  triggerLabel?: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string; Icon: typeof Layers }>;
  onChange: (value: Value) => void;
  secondary?: {
    label: string;
    value: string;
    options: ReadonlyArray<{ value: string; label: string; Icon: typeof Layers }>;
    onChange: (value: string) => void;
  };
}) {
  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={triggerLabel ? `${label}: ${current?.label ?? ''}` : label}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-subtle px-2.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        {triggerIcon}
        <span className="truncate">{triggerLabel ?? current?.label ?? label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as Value)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.Icon className="size-3.5 shrink-0" aria-hidden />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {secondary ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{secondary.label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={secondary.value}
              onValueChange={(next) => secondary.onChange(next)}
            >
              {secondary.options.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <option.Icon className="size-3.5 shrink-0" aria-hidden />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  selected,
  onSelect,
}: {
  entry: PullRequestWorkspaceEntry;
  selected: boolean;
  onSelect: (number: number) => void;
}) {
  const updated = formatRelativeTime(entry.updatedAt);

  return (
    <li className="[content-visibility:auto] [contain-intrinsic-block-size:66px]">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(entry.number)}
        className={cn(
          'grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors',
          selected ? 'bg-bg-hover' : 'hover:bg-bg-hover/60'
        )}
      >
        <PullRequestStateGlyph
          state={entry.state}
          isDraft={entry.isDraft}
          mergeability={entry.mergeability}
          baseBranch={entry.baseRefName}
        />

        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
          <span className="col-start-1 row-start-1 truncate text-sm font-medium text-text-primary">
            {entry.title}
          </span>

          <span className="col-start-2 row-start-1 flex max-w-36 items-center justify-self-end gap-2 text-xs">
            {entry.reviewDecision === 'approved' || entry.reviewDecision === 'changes-requested' ? (
              <span
                className={cn(
                  'truncate',
                  entry.reviewDecision === 'approved'
                    ? 'text-emerald-600/90 dark:text-emerald-400/80'
                    : 'text-amber-600/90 dark:text-amber-400/80'
                )}
              >
                {entry.reviewDecision === 'approved' ? 'Approved' : 'Changes requested'}
              </span>
            ) : null}
            {entry.checksState ? <PullRequestChecksGlyph checksState={entry.checksState} /> : null}
          </span>

          <span className="col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-text-faint">
            <span className="shrink-0 tabular-nums">#{entry.number}</span>
            <span className="min-w-0 truncate">{entry.repository}</span>
            <span className="min-w-0 max-w-28 truncate">{entry.projectTitle}</span>
            <span className="min-w-0 max-w-32 truncate">
              {pullRequestActorLabel(entry.author)}
            </span>
            {entry.labels.slice(0, 2).map((label) => {
              const dot = pullRequestLabelColor(label.color);
              return (
                <span
                  key={label.name}
                  className="inline-flex min-w-0 max-w-28 shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-bg-surface/40 py-0 pl-1 pr-1.5 text-[10px]"
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

          <span className="col-start-2 row-start-2 flex shrink-0 items-center gap-2 justify-self-end whitespace-nowrap text-xs text-text-faint">
            <PullRequestDiffStat additions={entry.additions} deletions={entry.deletions} />
            {updated ? <span>{updated}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}
