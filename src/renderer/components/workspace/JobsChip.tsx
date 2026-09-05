import { Square, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { useConversationJobs } from '../../hooks/useConversationJobs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { StatusDot } from '../ui/status-dot';
import {
  activeJobCount,
  cappedDisplayRows,
  jobRowView,
  jobsChipLabel,
  jobsChipVisible
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
  const { jobs, reload, replace } = useConversationJobs(conversationId);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const nowRef = useRef(Date.now());

  // Tick every second while there are settled jobs so the 5 s fade-out
  // works without keeping a permanent interval.
  useEffect(() => {
    if (jobs.length === 0 || activeJobCount(jobs) > 0) {
      return;
    }
    const id = setInterval(() => {
      nowRef.current = Date.now();
      setTick((t) => t + 1);
    }, 1_000);
    return () => clearInterval(id);
  }, [jobs]);

  nowRef.current = Date.now();

  if (!conversationId || !jobsChipVisible(jobs, nowRef.current)) {
    return null;
  }

  const stop = async (jobId: string) => {
    setBusy(true);
    try {
      replace(await window.atlasChat.jobs.kill(conversationId, jobId));
    } catch (error) {
      notifyError('Could not stop the background job', error);
    } finally {
      setBusy(false);
    }
  };

  const active = activeJobCount(jobs);
  const { rows, overflow } = cappedDisplayRows(jobs);
  const rowViews = rows.map((job) => jobRowView(job, Date.now()));

  return (
    <DropdownMenu onOpenChange={(open) => open && void reload()}>
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
          {active > 0 ? (
            <StatusDot tone="running" label="Background jobs running" />
          ) : (
            <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
          )}
          <span>{jobsChipLabel(jobs)}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80 p-2">
        <p className="px-1 pb-2 text-2xs text-text-faint">
          Commands the agent started with run_in_background. Stop one here or ask the agent to.
        </p>

        <ul className="space-y-1">
          {rowViews.map((row) => (
            <li key={row.id} className="rounded-md px-1 py-1 hover:bg-bg-hover">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0" title={row.id}>
                  <p className="truncate text-xs text-text-secondary">{row.label}</p>
                  <p className="mt-0.5 text-2xs text-text-faint">
                    {row.statusLabel} · {row.subtitle}
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

        {overflow > 0 ? (
          <p className="px-1 pt-1 text-2xs text-text-faint">
            …and {overflow} more
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
