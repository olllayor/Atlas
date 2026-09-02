import type {
  ConversationChangeStats,
  ConversationSummary,
  ModelSummary,
  WorkspaceProject,
  WorkspaceMode,
} from '../../shared/contracts';
import { deriveAttentionState, type AttentionLevel } from '../lib/attention';
import { liveJobCountFor, type ConversationJobSummary } from '../lib/jobActivity';
import type { DraftSummary } from '../stores/draftSummaries';

export type SidebarConversationItem = {
  id: string;
  /** Which project's section the row belongs under; null means Recents. */
  projectId: string | null;
  isRunning: boolean;
  /** The turn ended in an error the user has not seen yet. */
  isFailed: boolean;
  status: DraftSummary['status'] | 'idle';
  /**
   * What this thread needs from a human right now (Codex "Activity" model):
   * an approval/error to answer, work in flight, a queued turn, or unread
   * output. Rows render one mark for it; the popover groups by it.
   */
  attention: AttentionLevel;
  /** Finished turns nobody has read yet; >0 pairs with `attention: 'unread'`. */
  unreadCount: number;
  primaryLabel: string;
  secondaryLabel: string | null;
  timestampLabel: string | null;
  /** Epoch ms of the row's timestamp, or null when it is unparseable. */
  timestampMs: number | null;
  /**
   * What the chat can do — the one property of a chat that is invisible from
   * the list and changes what the next message is allowed to touch. Read by the
   * hover card; the row itself stays one line.
   *
   * Nullable because a summary written before modes existed carries none, and a
   * card that guesses "Work" at a Code chat is worse than a card that says
   * nothing.
   */
  workspaceMode: WorkspaceMode | null;
  /** Raw provider spelling (`vendor/deepseek-v4-flash`) — tooltip material. */
  modelId: string | null;
  /**
   * What the chat did to the working tree. Read by the hover card, which is the
   * only place a row can say whether it wrote forty files or answered a
   * question — until now every row looked identical either way.
   *
   * Not nullable, unlike `workspaceMode`: a mode that was never recorded has
   * nothing truthful to render, but "changed nothing" is a fact, and zeros say
   * it. Callers branch on `fileCount === 0`, never on the field being absent.
   */
  changeStats: ConversationChangeStats;
  /** When the chat was pinned, or null. Orders the Pinned section. */
  pinnedAt: string | null;
};

export type SidebarConversationGroup = {
  /** Stable key — the label is user-visible and may repeat across years. */
  key: string;
  label: string;
  items: SidebarConversationItem[];
};

type BuildSidebarConversationItemsParams = {
  conversations: ConversationSummary[];
  /**
   * Turn-level draft state only. The rows never render tokens, so taking the
   * summary rather than the live draft keeps the sidebar out of the 33ms
   * stream flush entirely.
   */
  draftsByConversation: Record<string, DraftSummary | undefined>;
  now: number;
  livenessByConversation?: Map<string, 'working' | 'monitoring' | null>;
  /** Whole-window background-job rollups (`useConversationJobSummaries`). */
  jobSummariesByConversation?: ReadonlyMap<string, ConversationJobSummary>;
  unreadByConversation?: Record<string, number>;
  /** Per-conversation /goal projections; active goals suppress unread bumps. */
  goalsByConversation?: Record<string, import('../../shared/contracts').ConversationGoalView>;
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAY_MS = 86_400_000;

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function clipLabel(value: string | null | undefined, maxLength = 90) {
  const safe = value ?? '';
  const normalized = compactWhitespace(safe);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return null;
  }

  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

/**
 * Relative time that stays short and stays honest.
 *
 * `now` · `5m` · `4h` · `3d` up to a week, then a calendar date (`Mar 4`),
 * then month + year (`Mar 2025`). The old formatter degraded to `412d`,
 * which is both unreadable and wider than the slot it lives in.
 */
/** Elapsed time for a live task: `12s`, `4m`, `1h 05m`. */
export function formatElapsedSince(startedMs: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - startedMs) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatRelativeTimestamp(timestampMs: number | null, now: number) {
  if (timestampMs == null) {
    return null;
  }

  const diffMs = Math.max(0, now - timestampMs);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return 'now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d`;
  }

  const then = new Date(timestampMs);
  const nowDate = new Date(now);
  const sameYear = then.getFullYear() === nowDate.getFullYear();

  if (sameYear || diffMs < 365 * DAY_MS) {
    return `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  }

  return `${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
}

/**
 * The minus the transcript's changed-files bar already uses (U+2212). An ASCII
 * hyphen renders a third of the height of the `+` beside it, so a diff written
 * with one reads as `+240 -18` with a speck where the minus should be.
 */
const CHANGE_MINUS = '−';

const NO_CHANGE_STATS: ConversationChangeStats = {
  fileCount: 0,
  linesAdded: 0,
  linesRemoved: 0,
};

export type ConversationChangeStatsLabel = {
  /** `1 file` · `12 files`. */
  files: string;
  /** `+240`, or null when nothing was added. */
  added: string | null;
  /** `−18`, or null when nothing was removed. */
  removed: string | null;
  /** Long form for a `title`: exact, ungrouped-free, and never compacted. */
  detail: string;
};

function normalizeCount(value: number | null | undefined) {
  // A negative or NaN count can only come from a malformed row, and a card
  // reading `+NaN` is a worse bug report than a card reading `+0`.
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 0;
}

/** `1204` → `1,204`. Hand-rolled: see `formatChangeCount`. */
function groupThousands(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A line count that survives a 256px card: `240` · `1,204` · `12.5k` · `1.4M`.
 *
 * Exact up to four digits, then compacted. A raw `+12480` is both unreadable
 * and — next to `−9812` — impossible to compare at a glance, which is the only
 * thing the row is for. The exact numbers are not lost: they are the row's
 * tooltip.
 *
 * Grouping is done by hand rather than with `toLocaleString`, which renders
 * `12 480` (narrow no-break space) under a French locale and `12.480` under a
 * German one — a separator that changes both the width and the meaning of the
 * string depending on who is looking at it.
 */
export function formatChangeCount(value: number) {
  const count = normalizeCount(value);

  if (count < 1_000) {
    return String(count);
  }

  if (count < 10_000) {
    return groupThousands(count);
  }

  // Below 100 units keep one decimal (`12.5k`); above it the decimal is noise
  // (`124.3k` is no more useful than `124k` and is two characters wider).
  const compact = (scaled: number, suffix: string) => {
    const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
    return `${rounded}${suffix}`;
  };

  // 999_500 rather than 1_000_000: anything above it rounds to `1000k`, which
  // is a unit that should have carried.
  return count < 999_500 ? compact(count / 1_000, 'k') : compact(count / 1_000_000, 'M');
}

/**
 * `12 files · +240 −18`, or null when the chat never touched the filesystem.
 *
 * Returned in pieces, not as one string: the two counts are coloured as a diff
 * by the caller, and a pre-joined string would force the card to re-parse its
 * own label to do that.
 *
 * Three judgement calls, all of them about not printing noise:
 *
 * - The count stays at `1 file` rather than collapsing to `file`. Every other
 *   row in the sidebar shows a number in that position, and a row that drops it
 *   for the singular breaks the column the eye is scanning down.
 * - A zero side is dropped entirely instead of rendering `−0`. `+240` already
 *   says nothing was removed; `+240 −0` says we measured a removal and it came
 *   back zero, which is a different and untrue claim.
 * - Files with no line counts at all (an empty file created, a pure rename)
 *   render as `3 files` alone. Following rule four one level down: a count that
 *   is only ever zero is a row that only ever wastes a line.
 */
export function formatConversationChangeStats(
  stats: ConversationChangeStats | null | undefined
): ConversationChangeStatsLabel | null {
  const fileCount = normalizeCount(stats?.fileCount);

  if (fileCount === 0) {
    return null;
  }

  const linesAdded = normalizeCount(stats?.linesAdded);
  const linesRemoved = normalizeCount(stats?.linesRemoved);
  const files = `${groupThousands(fileCount)} ${fileCount === 1 ? 'file' : 'files'}`;

  return {
    files,
    added: linesAdded > 0 ? `+${formatChangeCount(linesAdded)}` : null,
    removed: linesRemoved > 0 ? `${CHANGE_MINUS}${formatChangeCount(linesRemoved)}` : null,
    detail:
      linesAdded === 0 && linesRemoved === 0
        ? `${files} changed`
        : `${files} changed, ${groupThousands(linesAdded)} lines added, ${groupThousands(
            linesRemoved
          )} removed`,
  };
}

/**
 * `/Users/ada/Code/Atlas` → `~/Code/Atlas`.
 *
 * The renderer has no home directory to compare against, so the prefix is
 * matched structurally — the two user roots every platform we ship on uses.
 * Anything else (`/opt/src`, a network mount) passes through untouched rather
 * than being guessed at.
 */
export function formatHomeRelativePath(root: string) {
  const home =
    /^\/(?:Users|home)\/[^/]+(?=\/|$)/.exec(root) ?? /^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/.exec(root);

  if (!home) {
    return root;
  }

  const rest = root.slice(home[0].length);
  return rest ? `~${rest}` : '~';
}

/**
 * The human name for a chat's model, resolved from the catalog rather than
 * guessed from the id.
 *
 * The gateway spellings the sidebar stores (`vendor/deepseek-v4-flash-0325`)
 * are not names, and a hardcoded id-to-name table only stays right until the
 * next model ships. The catalog already carries the label the model picker
 * shows, so a card and a chip never disagree about what a chat is running.
 *
 * `null` when nothing truthful can be said — an unset model, or an id the
 * catalog does not know (an archived model, or a provider the user removed).
 * Callers drop the row rather than render a title-cased id as a name.
 */
export function resolveModelDisplayLabel(
  modelId: string | null | undefined,
  models: readonly ModelSummary[]
): string | null {
  if (!modelId) return null;

  const match = models.find((model) => model.id === modelId);
  if (!match) return null;

  return match.label && match.label !== match.id
    ? match.label
    : match.id.split('/').slice(-1)[0]?.replace(/[:@](free|beta|preview|latest)$/i, '') || null;
}

export type SidebarRowVariant = 'card' | 'slim';

/**
 * Resolves whether a sidebar row should render as a three-line card or a
 * one-line slim row. Only archived/settled chats collapse into slim rows;
 * live and pinned threads remain full cards.
 */
export function resolveSidebarRowVariant(
  sectionOrOptions?: 'pinned' | 'project' | 'recents' | 'archived' | { archived?: boolean } | null
): SidebarRowVariant {
  if (typeof sectionOrOptions === 'string') {
    return sectionOrOptions === 'archived' ? 'slim' : 'card';
  }
  return sectionOrOptions?.archived ? 'slim' : 'card';
}

/**
 * Formats the Settled section header label. Shows the count only while
 * collapsed, and never renders a trailing space.
 */
export function formatSettledSectionLabel(params: {
  expanded: boolean;
  count: number;
}): string {
  if (params.expanded || params.count <= 0) {
    return 'Settled';
  }
  return `Settled (${params.count})`;
}

function startOfDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Which date bucket a row belongs to, as a stable key + a visible label. */
function resolveGroup(timestampMs: number | null, now: number) {
  if (timestampMs == null) {
    return { key: 'earlier', label: 'Earlier' };
  }

  const todayStart = startOfDay(now);

  if (timestampMs >= todayStart) {
    return { key: 'today', label: 'Today' };
  }

  if (timestampMs >= todayStart - DAY_MS) {
    return { key: 'yesterday', label: 'Yesterday' };
  }

  if (timestampMs >= todayStart - 6 * DAY_MS) {
    return { key: 'week', label: 'This week' };
  }

  const nowDate = new Date(now);
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  if (timestampMs >= monthStart) {
    return { key: 'month', label: 'This month' };
  }

  const then = new Date(timestampMs);
  const year = then.getFullYear();
  const month = then.getMonth();
  const label =
    year === nowDate.getFullYear()
      ? MONTHS_LONG[month]!
      : `${MONTHS_LONG[month]} ${year}`;

  return { key: `m-${year}-${month}`, label };
}

function buildSecondaryLabel(
  conversation: ConversationSummary,
  draft: DraftSummary | undefined,
  primaryLabel: string
) {
  if (draft?.status === 'streaming') {
    return 'Thinking…';
  }

  if (draft?.status === 'error') {
    return draft.errorMessage ? clipLabel(draft.errorMessage, 70) : 'Something went wrong';
  }

  if (draft?.status === 'aborted') {
    return 'Generation stopped';
  }

  const assistantPreview = clipLabel(conversation.lastAssistantMessagePreview ?? '');
  if (assistantPreview && assistantPreview !== primaryLabel) {
    return assistantPreview;
  }

  const summaryPreview = clipLabel(conversation.lastMessagePreview ?? '');
  if (summaryPreview && summaryPreview !== primaryLabel) {
    return summaryPreview;
  }

  return null;
}

export function buildSidebarConversationItems({
  conversations,
  draftsByConversation,
  now,
  livenessByConversation,
  jobSummariesByConversation,
  unreadByConversation,
  goalsByConversation,
  queuedByConversation,
}: BuildSidebarConversationItemsParams & {
  queuedByConversation?: Record<string, readonly unknown[]>;
}) {
  return conversations.map<SidebarConversationItem>((conversation) => {
    const draft = draftsByConversation[conversation.id];
    // No pre-clipping: the row truncates with CSS, and the `title` tooltip
    // needs the *whole* title — an ellipsis baked into the string made the
    // tooltip as useless as the row it was explaining.
    const conversationTitle = compactWhitespace(conversation.title ?? '');
    // The Codex reference lists chats by title (single line, right-aligned
    // relative time). Fall back to message previews for untitled chats.
    const primaryLabel =
      conversationTitle ||
      compactWhitespace(conversation.lastUserMessagePreview ?? '') ||
      compactWhitespace(conversation.lastMessagePreview ?? '');
    const timestampMs = parseTimestamp(draft?.startedAt ?? conversation.updatedAt);
    // The draft is what this window is streaming right now; the persisted
    // status is what a turn started before a reload — or in another window —
    // left behind. The draft wins where both speak, but background liveness
    // (S6) outranks a settled draft: a parent with a running subagent is still
    // working even after its own turn settles.
    const backgroundLiveness = livenessByConversation?.get(conversation.id) ?? null;
    const backgroundJobsLive = liveJobCountFor(jobSummariesByConversation, conversation.id);
    // A live background job is work in progress exactly like a running turn —
    // the row dot and the bell must agree with the chip about it.
    const isRunning =
      backgroundLiveness === 'working' || backgroundJobsLive > 0
        ? true
        : draft
          ? draft.status === 'streaming'
          : conversation.status === 'running';
    const isFailed = draft ? draft.status === 'error' : conversation.status === 'failed';
    const startedMs = isRunning
      ? parseTimestamp(draft?.startedAt ?? conversation.startedAt ?? null)
      : null;

    const unreadCount = unreadByConversation?.[conversation.id] ?? 0;
    const attention = deriveAttentionState({
      draftStatus: draft?.status,
      hasPendingApproval: draft?.hasPendingApproval ?? false,
      backgroundLiveness,
      backgroundJobsLive,
      conversationStatus: conversation.status,
      queuedFollowups: queuedByConversation?.[conversation.id]?.length ?? 0,
      unreadCount,
      hasActiveGoal: goalsByConversation?.[conversation.id]?.status === 'active',
    });

    return {
      id: conversation.id,
      projectId: conversation.projectId,
      isRunning,
      isFailed,
      status: draft?.status ?? 'idle',
      attention,
      unreadCount,
      primaryLabel,
      secondaryLabel: buildSecondaryLabel(conversation, draft, primaryLabel),
      // A running task reports how long it has been going, which is the only
      // number that changes while you watch it. Everything else reports age.
      timestampLabel:
        startedMs != null
          ? formatElapsedSince(startedMs, now)
          : formatRelativeTimestamp(timestampMs, now),
      timestampMs,
      workspaceMode: conversation.workspaceMode ?? null,
      modelId: conversation.defaultModelId ?? null,
      // The contract promises zeros rather than null, but the sidebar also
      // renders summaries that were cached before the column existed; falling
      // back here keeps that one row from reading `undefined files`.
      changeStats: conversation.changeStats ?? NO_CHANGE_STATS,
      pinnedAt: conversation.pinnedAt ?? null,
    };
  });
}

/**
 * Lift pinned chats out of the list into their own section, newest pin first.
 *
 * They are *moved*, not copied: the reference sidebar has one row per chat, and
 * a pinned chat that also sits in its project section reads as two chats with
 * the same name until you click one.
 */
export function splitPinnedSidebarItems(items: SidebarConversationItem[]) {
  const pinned: SidebarConversationItem[] = [];
  const rest: SidebarConversationItem[] = [];

  for (const item of items) {
    (item.pinnedAt ? pinned : rest).push(item);
  }

  pinned.sort((left, right) => (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? ''));

  return { pinned, rest };
}

/**
 * Pinned projects float to the top of the Projects list, newest pin first.
 *
 * Unlike chats they keep their section rather than moving into Pinned: a
 * project *is* its chats, and lifting the header away from them would leave the
 * chats orphaned under a header that moved.
 */
export function sortProjectsByPin(projects: WorkspaceProject[]) {
  return [...projects].sort((left, right) => {
    if (Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) {
      return left.pinnedAt ? -1 : 1;
    }

    if (left.pinnedAt && right.pinnedAt) {
      return right.pinnedAt.localeCompare(left.pinnedAt);
    }

    return 0;
  });
}

/**
 * Split an already-ordered (newest first) item list into date buckets:
 * Today / Yesterday / This week / This month / one bucket per older month.
 *
 * Ordering comes from the input, so the buckets come out newest-first too
 * without a second sort.
 */
export function groupSidebarConversationItems(
  items: SidebarConversationItem[],
  now: number
): SidebarConversationGroup[] {
  const groups: SidebarConversationGroup[] = [];
  const byKey = new Map<string, SidebarConversationGroup>();

  for (const item of items) {
    const { key, label } = resolveGroup(item.timestampMs, now);
    let group = byKey.get(key);

    if (!group) {
      group = { key, label, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }

    group.items.push(item);
  }

  return groups;
}

export type SidebarProjectSection = {
  project: WorkspaceProject;
  items: SidebarConversationItem[];
};

/**
 * Split the sidebar into per-project sections and everything else.
 *
 * Project order comes from the projects list (most recently used first), not
 * from conversation activity: a section that jumps position because a chat
 * inside it got a reply is a section you cannot learn the position of. Within a
 * section the conversation order is preserved, so it stays newest-first.
 *
 * A conversation pointing at a project that has since been detached falls back
 * to Recents rather than vanishing.
 */
export function splitSidebarItemsByProject(
  items: SidebarConversationItem[],
  projects: WorkspaceProject[]
): { sections: SidebarProjectSection[]; ungrouped: SidebarConversationItem[] } {
  if (projects.length === 0) {
    return { sections: [], ungrouped: items };
  }

  const sections = new Map<string, SidebarProjectSection>(
    projects.map((project) => [project.id, { project, items: [] }])
  );
  const ungrouped: SidebarConversationItem[] = [];

  for (const item of items) {
    const section = item.projectId ? sections.get(item.projectId) : undefined;

    if (section) {
      section.items.push(item);
      continue;
    }

    ungrouped.push(item);
  }

  return { sections: [...sections.values()], ungrouped };
}
