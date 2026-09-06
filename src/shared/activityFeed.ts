/**
 * R3 — a read-model over the persisted runtime activity log, for any "activity
 * feed" / quiet-timeline surface.
 *
 * The one spine is `conversation_events` → `deriveWorkLogEntry` (see
 * `runtimeActivity.ts`) → `WorkLogEntry[]`. This module is the grouping layer
 * *above* that: it folds a flat, sequence-ordered list of `WorkLogEntry` into
 * turn-grouped rows keyed by the entry's stable subject id, so recurring rows
 * for the same tool call / task / approval collapse instead of appending.
 *
 * Two rules make the fold order-robust (they mirror the sub-agent principles in
 * `docs/plans/agents`):
 * 1. A terminal row is sticky — a late non-final event (a start row that beat
 *    its own completion through an aged-out cache) only fills metadata and never
 *    regresses a `status`/`isFinal` already reached.
 * 2. A terminal event with no prior row creates one; the fold must not assume a
 *    start row exists.
 *
 * This module is deliberately UI-free. The Agents panel / quiet-timeline render
 * layer it feeds is planned in `docs/plans/agents/03`; this read-model is the
 * shared, testable source both it and a future general activity feed use.
 */
import type { ActivityType, WorkLogEntry, WorkLogEntryStatus } from './contracts';

export type ActivityFeedRowKind = 'tool' | 'task' | 'approval' | 'turn' | 'other';

export type ActivityFeedRow = {
  /** Stable subject key — `tool:<callId>`, `task:<taskId>`, `approval:<id>`, … */
  key: string;
  kind: ActivityFeedRowKind;
  headline: string;
  status: WorkLogEntryStatus;
  isFinal: boolean;
  /** Number of entries that folded onto this row. */
  count: number;
  /** Every entry that folded onto this row, in arrival order. */
  entries: WorkLogEntry[];
  firstAt: string;
  lastAt: string;
};

export type ActivityFeedTurn = {
  turnId: string;
  requestId: string | null;
  rows: ActivityFeedRow[];
};

export type ActivityFeed = ActivityFeedTurn[];

/**
 * Which activities belong in a feed. Message deltas and reasoning tokens are the
 * answer itself — that is the transcript, not the feed of "what the conversation
 * did" — so they are excluded here.
 */
function kindOf(activityType: ActivityType): ActivityFeedRowKind | null {
  if (activityType.startsWith('tool.')) return 'tool';
  if (activityType.startsWith('task.')) return 'task';
  if (activityType.startsWith('approval.')) return 'approval';
  if (activityType.startsWith('turn.')) return 'turn';
  if (activityType === 'runtime.warning' || activityType === 'runtime.error') return 'other';

  return null;
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function headlineFor(entry: WorkLogEntry): string {
  if (entry.title) return entry.title;
  if (entry.summary) return entry.summary;
  return humanize(entry.toolType ?? entry.activityType);
}

/**
 * `entry.id` is already the stable subject id (`tool:<callId>` / `task:<id>` /
 * `approval:<id>` / `turn:<...>`); we just namespace the "other" rows so a
 * runtime warning can never collide with a sibling tool key.
 */
function rowKey(entry: WorkLogEntry, kind: ActivityFeedRowKind): string {
  return kind === 'other' ? `other:${entry.id}` : entry.id;
}

/**
 * Terminal wins, never regresses. If the row is already final, a later event
 * cannot un-final it; otherwise an incoming final event settles it.
 */
function mergeStatus(
  current: { status: WorkLogEntryStatus; isFinal: boolean },
  incoming: WorkLogEntry
): { status: WorkLogEntryStatus; isFinal: boolean } {
  if (current.isFinal) {
    return current;
  }

  if (incoming.isFinal) {
    return { status: incoming.status, isFinal: true };
  }

  return { status: incoming.status, isFinal: false };
}

/**
 * Quiet-timeline exclusion for the main work log.
 *
 * - `timelineBypass` rows never render in the timeline; they still update the
 *   fold/panel and fold into the CTA.
 * - Agent-attributed `tool.*` rows re-home to the owning agent's progress /
 *   recent-activity; the parent chat keeps only the batch CTA.
 * - Background rows (unstamped, shells, monitors) stay ordinary rows.
 * - `task.*` rows stay: recurring ticks already collapse onto one lifecycle
 *   row per task via stable ids, which is the direct-agent row / run card.
 */
function isQuietExcluded(entry: WorkLogEntry): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  if (payload.timelineBypass === true) return true;
  if (!entry.activityType.startsWith('tool.')) return false;
  if (payload.agentKind !== 'agent') return false;
  const agentId =
    entry.agentId ??
    (payload.agentId as string | undefined) ??
    (payload.taskId as string | undefined) ??
    null;
  return agentId != null && agentId !== '';
}

export function buildActivityFeed(entries: WorkLogEntry[]): ActivityFeed {
  const turns: ActivityFeedTurn[] = [];
  const turnIndex = new Map<string, ActivityFeedTurn>();
  // Scoped per turn so two turns can never collide on a key.
  const rowIndex = new Map<string, ActivityFeedRow>();

  for (const entry of entries) {
    // Quiet timeline: agent-attributed tool rows re-home to the panel and
    // timelineBypass rows fold into the CTA. Background shells stay ordinary
    // work-log rows.
    if (isQuietExcluded(entry)) {
      continue;
    }

    const kind = kindOf(entry.activityType);
    if (!kind) {
      continue;
    }

    let turn = turnIndex.get(entry.turnId);
    if (!turn) {
      turn = { turnId: entry.turnId, requestId: entry.requestId, rows: [] };
      turnIndex.set(entry.turnId, turn);
      turns.push(turn);
    }

    const key = rowKey(entry, kind);
    const mapKey = `${entry.turnId}|${key}`;
    const existing = rowIndex.get(mapKey);

    if (!existing) {
      const row: ActivityFeedRow = {
        key,
        kind,
        headline: headlineFor(entry),
        status: entry.status,
        isFinal: entry.isFinal,
        count: 1,
        entries: [entry],
        firstAt: entry.createdAt,
        lastAt: entry.updatedAt,
      };
      rowIndex.set(mapKey, row);
      turn.rows.push(row);
      continue;
    }

    const merged = mergeStatus({ status: existing.status, isFinal: existing.isFinal }, entry);
    existing.status = merged.status;
    existing.isFinal = merged.isFinal;

    if (entry.createdAt < existing.firstAt) existing.firstAt = entry.createdAt;
    if (entry.updatedAt > existing.lastAt) existing.lastAt = entry.updatedAt;
    if (entry.title) existing.headline = entry.title;
    else if (entry.summary) existing.headline = entry.summary;

    existing.count += 1;
    existing.entries.push(entry);
  }

  return turns;
}
