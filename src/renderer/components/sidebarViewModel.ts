import type { ConversationSummary, WorkspaceProject } from '../../shared/contracts';
import type { DraftStateLike } from './types';

export type SidebarConversationItem = {
  id: string;
  /** Which project's section the row belongs under; null means Recents. */
  projectId: string | null;
  isRunning: boolean;
  /** The turn ended in an error the user has not seen yet. */
  isFailed: boolean;
  status: DraftStateLike['status'] | 'idle';
  primaryLabel: string;
  secondaryLabel: string | null;
  timestampLabel: string | null;
  /** Epoch ms of the row's timestamp, or null when it is unparseable. */
  timestampMs: number | null;
};

export type SidebarConversationGroup = {
  /** Stable key — the label is user-visible and may repeat across years. */
  key: string;
  label: string;
  items: SidebarConversationItem[];
};

type BuildSidebarConversationItemsParams = {
  conversations: ConversationSummary[];
  draftsByConversation: Record<string, DraftStateLike | undefined>;
  now: number;
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
  draft: DraftStateLike | undefined,
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
}: BuildSidebarConversationItemsParams) {
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
    // left behind. The draft wins where both speak.
    const isRunning = draft ? draft.status === 'streaming' : conversation.status === 'running';
    const isFailed = draft ? draft.status === 'error' : conversation.status === 'failed';
    const startedMs = isRunning
      ? parseTimestamp(draft?.startedAt ?? conversation.startedAt ?? null)
      : null;

    return {
      id: conversation.id,
      projectId: conversation.projectId,
      isRunning,
      isFailed,
      status: draft?.status ?? 'idle',
      primaryLabel,
      secondaryLabel: buildSecondaryLabel(conversation, draft, primaryLabel),
      // A running task reports how long it has been going, which is the only
      // number that changes while you watch it. Everything else reports age.
      timestampLabel:
        startedMs != null
          ? formatElapsedSince(startedMs, now)
          : formatRelativeTimestamp(timestampMs, now),
      timestampMs,
    };
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
