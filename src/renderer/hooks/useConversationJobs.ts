import { useCallback, useEffect, useState } from 'react';

import type { JobSnapshotView } from '../../shared/contracts';

/**
 * This conversation's background jobs, live.
 *
 * One subscription per consumer: loads the roster on mount/conversation
 * change, then applies registry pushes (registration and settlement) that
 * belong to this conversation. `reload` re-fetches on demand (the chip
 * refreshes when its dropdown opens); `replace` swaps one snapshot in place
 * (the kill IPC returns the updated job).
 */
export function useConversationJobs(conversationId?: string) {
  const [jobs, setJobs] = useState<JobSnapshotView[]>([]);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setJobs([]);
      return;
    }

    setJobs(await window.atlasChat.jobs.list(conversationId).catch(() => []));
  }, [conversationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    return window.atlasChat.jobs.subscribe((event) => {
      if (event.snapshot.conversationId !== conversationId) {
        return;
      }

      setJobs((current) => {
        const index = current.findIndex((job) => job.id === event.snapshot.id);
        if (index === -1) {
          return [...current, event.snapshot];
        }

        const next = [...current];
        next[index] = event.snapshot;
        return next;
      });
    });
  }, [conversationId]);

  const replace = useCallback((updated: JobSnapshotView) => {
    setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
  }, []);

  return { jobs, reload, replace };
}
