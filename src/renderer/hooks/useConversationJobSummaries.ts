import { useEffect, useState } from 'react';

import type { JobSnapshotView } from '../../shared/contracts';
import {
  summarizeJobsByConversation,
  type ConversationJobSummary
} from '../lib/jobActivity';

/**
 * Live per-conversation job rollups for whole-app views (sidebar rows, the
 * activity bell, ⌘⌥A cycling).
 *
 * One subscription per window — registry events carry the owning conversation
 * id, so a single listener maintains every conversation's counts. Seeded from
 * `listAll()` on mount so jobs started before this window opened (or in
 * another window) are counted, not just ones registered while watching.
 *
 * Per-conversation consumers keep using `useConversationJobs(conversationId)`;
 * this hook exists because attention must not depend on which chat is open.
 */
export function useConversationJobSummaries(): ReadonlyMap<string, ConversationJobSummary> {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, ConversationJobSummary>>(
    () => new Map()
  );

  useEffect(() => {
    let disposed = false;

    const recompute = (jobs: readonly JobSnapshotView[]) => {
      if (!disposed) setSummaries(summarizeJobsByConversation(jobs));
    };

    // Seed from the registry's current roster, then apply pushes to a local
    // copy so a settlement that arrives between seed and subscribe cannot be
    // lost. The fold is cheap; correctness beats cleverness here.
    let roster: JobSnapshotView[] = [];
    void window.atlasChat.jobs
      .listAll()
      .then((jobs) => {
        roster = jobs;
        recompute(roster);
      })
      .catch(() => {
        recompute(roster);
      });

    const unsubscribe = window.atlasChat.jobs.subscribe((event) => {
      const index = roster.findIndex((job) => job.id === event.snapshot.id);
      if (index === -1) {
        roster = [...roster, event.snapshot];
      } else {
        const next = [...roster];
        next[index] = event.snapshot;
        roster = next;
      }
      recompute(roster);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return summaries;
}
