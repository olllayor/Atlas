/**
 * S4 — Subagent projections (identity + timing + hasChildren).
 *
 * Simplified port of harness `packages/subagent/subagent/src/projection.ts`.
 * Atlas stores identity in `conversations` columns (origin/mode/label) rather
 * than folding `subagent/descriptor` events; hasChildren is a batched
 * header-only GROUP BY (partial index `WHERE origin='subagent'`); timing sums
 * persisted assistant-turn latencies for the settled part and overlays the
 * live open-turn interval from manager state.
 *
 * No extra table and no cache: every input is already O(1) or one indexed
 * query, so a module-level cache would only add staleness.
 */

import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { SubagentContinuationManager } from './SubagentContinuationManager';
import { formatTiming } from '../../../shared/subagentFormat';

export { formatTiming };
export type { SubagentTiming } from '../../../shared/subagentFormat';
import type { SubagentTiming } from '../../../shared/subagentFormat';

export type SubagentIdentity = {
  mode: 'one-shot' | 'continuable';
  label: string;
};

export type EnrichedSubagentEntry = {
  id: string;
  title: string;
  mode: 'one-shot' | 'continuable' | null;
  label: string | null;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  status: 'running' | 'inactive';
  timing: SubagentTiming;
  createdAt: string;
  updatedAt: string;
};

/** Status vocabulary: an activation with work in flight OR queued is running. */
function statusOf(
  live?: { processing: boolean; queued: number }
): 'running' | 'inactive' {
  return live && (live.processing || live.queued > 0) ? 'running' : 'inactive';
}

export function computeTiming(
  childId: string,
  manager?: Pick<SubagentContinuationManager, 'getActivationStatus'>,
  settledMs = 0
): SubagentTiming {
  const status = manager?.getActivationStatus(childId);
  if (status?.processing && status.since !== undefined) {
    return { settledMs, active: { since: status.since, through: Date.now() } };
  }
  return { settledMs };
}

/** S5 display contract lives in shared/subagentFormat (single source, no drift). */

/**
 * Batched hasChildren: one GROUP BY query for N parents, header-only (no log scan).
 * Mirrors ConversationsRepo.countSubagentChildrenByParent.
 */
export function computeHasChildrenMap(
  convRepo: Pick<ConversationsRepo, 'countSubagentChildrenByParent'>,
  parentIds: string[]
): Map<string, boolean> {
  const counts = convRepo.countSubagentChildrenByParent(parentIds);
  const out = new Map<string, boolean>();
  for (const id of parentIds) {
    out.set(id, (counts.get(id) ?? 0) > 0);
  }
  return out;
}

/**
 * Enrich a raw list from `listSubagentChildren` with hasChildren, status, timing.
 * Pure function over repo + manager live state.
 */
export function enrichSubagentEntries(
  raw: Array<{ id: string; title: string; mode: 'one-shot' | 'continuable' | null; label: string | null; depth: number; parentId: string | null; createdAt: string; updatedAt: string }>,
  convRepo: Pick<ConversationsRepo, 'countSubagentChildrenByParent' | 'sumAssistantLatencyByConversation'>,
  manager?: Pick<SubagentContinuationManager, 'getActivationStatus'>
): EnrichedSubagentEntry[] {
  if (raw.length === 0) return [];
  const hasChildrenMap = computeHasChildrenMap(convRepo, raw.map((r) => r.id));
  const settledMap = convRepo.sumAssistantLatencyByConversation(raw.map((r) => r.id));
  return raw.map((r) => {
    const live = manager?.getActivationStatus(r.id);
    return {
      id: r.id,
      title: r.title,
      mode: r.mode,
      label: r.label,
      depth: r.depth,
      parentId: r.parentId,
      hasChildren: hasChildrenMap.get(r.id) ?? false,
      status: statusOf(live),
      timing: computeTiming(r.id, manager, settledMap.get(r.id) ?? 0),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}
