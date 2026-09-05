import { useState } from 'react';

import type { JobSnapshotView } from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { StatusDot } from '../ui/status-dot';
import { activeJobCount } from '../workspace/jobsChipViewModel';
import { useConversationJobs } from '../../hooks/useConversationJobs';
import { cn } from '../../lib/utils';
import { jobTaskRows } from './jobsSectionModel';
import { TaskStatusGlyph } from './TaskStatusGlyph';

/**
 * The Tasks tab's "Background jobs" section — commands the agent started
 * with `run_in_background`, in the same row grammar as tool tasks, with a
 * stop action while live. Renders nothing when the conversation owns none,
 * so an ordinary thread shows no extra section.
 */
export function JobsSection({ conversationId }: { conversationId?: string }) {
  const { jobs, replace } = useConversationJobs(conversationId);
  const [busy, setBusy] = useState(false);

  if (!conversationId || jobs.length === 0) {
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

  const live = activeJobCount(jobs) > 0;
  const rows = jobTaskRows(jobs, Date.now());

  return (
    <section>
      <h3 className="flex items-center gap-1.5 pb-1 pt-3 text-sm font-normal text-text-tertiary">
        Background jobs
        <span className="tabular-nums text-text-faint">{jobs.length}</span>
        {/* Pulse only while something is actually running — settled rows
            keep the section quiet. */}
        {live ? <StatusDot tone="running" label="Background jobs running" /> : null}
      </h3>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className="group py-0.5" title={row.id}>
            <div className="flex min-h-9 items-center gap-2.5">
              <TaskStatusGlyph status={row.glyph === 'running' ? 'job-live' : row.glyph} className="shrink-0" />
              <span className="min-w-0 truncate text-base text-text-primary">{row.label}</span>
              <span className="shrink-0 text-sm text-text-faint">{row.kindLabel}</span>
              <span className={cn('ml-auto shrink-0 pl-3 tabular-nums text-sm', row.statusClass)}>
                {row.statusText}
              </span>

              {row.killable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void stop(row.id)}
                  className="shrink-0 rounded-md px-1 py-0.5 text-2xs text-text-faint opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  Stop
                </button>
              ) : null}
            </div>

            {/* Live output preview — the CLI `/ps` ↳ pattern. Read-only:
                the model's job_output cursor is untouched by this render. */}
            {row.tail?.map((line, index) => (
              <p
                key={`${row.id}-tail-${index}`}
                className="truncate pl-[22px] font-mono text-2xs leading-relaxed text-text-faint"
              >
                <span className="mr-1 select-none">↳</span>
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
