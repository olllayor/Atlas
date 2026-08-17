import { Square, Terminal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { JobSnapshotView } from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  activeJobCount,
  jobRowView,
  jobsChipLabel,
  jobsChipVisible,
  sortJobsForDisplay
} from './jobsChipViewModel';

/**
 * Background jobs this conversation owns: what is running, what finished, and
 * a stop button for the live ones.
 *
 * The model starts these with `run_in_background`, but until now the user had
 * no way to see or stop them — the only surface was the model's own tool
 * results. This chip makes the roster visible and controllable.
 *
 * Renders nothing when the conversation owns no jobs, so the ordinary case
 * costs no chrome.
 */
export function JobsChip({ conversationId }: { conversationId?: string }) {
  const [jobs, setJobs] = useState<JobSnapshotView[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!conversationId) {
      setJobs([]);
      return;
    }

    setJobs(await window.atlasChat.jobs.list(conversationId).catch(() => []));
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: the registry pushes registration and settlement to every
  // window; keep only this conversation's snapshots.
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

  if (!conversationId || !jobsChipVisible(jobs)) {
    return null;
  }

  const stop = async (jobId: string) => {
    setBusy(true);
    try {
      const updated = await window.atlasChat.jobs.kill(conversationId, jobId);
      setJobs((current) => current.map((job) => (job.id === jobId ? updated : job)));
    } catch (error) {
      notifyError('Could not stop the background job', error);
    } finally {
      setBusy(false);
    }
  };

  const active = activeJobCount(jobs);
  const rows = sortJobsForDisplay(jobs).map((job) => jobRowView(job, Date.now()));

  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs transition-colors',
            active > 0 ? 'text-text-secondary' : 'text-text-faint',
            'hover:bg-bg-hover'
          )}
          title="Background jobs for this chat"
        >
          <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span>{jobsChipLabel(jobs)}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80 p-2">
        <p className="px-1 pb-2 text-2xs text-text-faint">
          Commands the agent started with run_in_background. Stop one here or ask the agent to.
        </p>

        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md px-1 py-1 hover:bg-bg-hover">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-text-secondary" title={row.label}>
                    {row.label}
                  </p>
                  <p className="mt-0.5 text-2xs text-text-faint">
                    {row.id} · {row.statusLabel} · {row.subtitle}
                  </p>
                </div>

                {row.killable ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void stop(row.id)}
                    className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                    title={`Stop ${row.id}`}
                  >
                    <Square className="size-3" strokeWidth={1.75} aria-hidden />
                    Stop
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
