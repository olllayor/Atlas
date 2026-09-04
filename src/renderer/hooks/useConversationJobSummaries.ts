import { useEffect, useState } from 'react';

import type { JobSnapshotView } from '../../shared/contracts';
import {
  summarizeJobsByConversation,
  type ConversationJobSummary
} from '../lib/jobActivity';
import { notify } from '../lib/notify';
import { useAppStore } from '../stores/useAppStore';

/**
 * Live per-conversation job rollups for whole-app views (sidebar rows, the
 * activity bell, ⌥⌘A cycling).
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

      if (event.type === 'done' && event.snapshot) {
        const store = useAppStore.getState();
        const convId = event.snapshot.conversationId;
        if (convId && convId !== store.selectedConversationId) {
          store.markConversationUnread(convId);
          const conv = store.conversations.find((c) => c.id === convId);
          const title = conv?.title ?? 'A conversation';
          const isFailed = event.snapshot.status === 'failed';
          notify({
            tone: isFailed ? 'error' : 'info',
            title: isFailed ? 'Background job failed' : 'Background job completed',
            description: `${event.snapshot.label} · ${title}`,
            actionLabel: 'Open',
            onAction: () => {
              void store.loadConversation(convId);
            },
          });
        }
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return summaries;
}
