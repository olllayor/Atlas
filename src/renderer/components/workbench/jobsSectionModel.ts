import type { JobSnapshotView, JobStatusView } from '../../../shared/contracts';
import type { ToolCellStatus } from '../../../shared/toolCellGrammar';
import {
  jobElapsedLabel,
  jobIsKillable,
  jobStatusLabel,
  sortJobsForDisplay,
  truncateLabel
} from '../workspace/jobsChipViewModel';

/**
 * Pure presentation logic for the workbench Tasks tab's "Background jobs"
 * section. Same data as the context-bar chip, rendered in the task-row
 * grammar (spec §5: glyph + name + dim kind label + right-aligned status).
 */

/** Which TaskStatusGlyph a job maps to (`running` renders as the live spinner). */
export type JobGlyph = Extract<ToolCellStatus, 'running' | 'success' | 'failed'>;

export function jobGlyph(status: JobStatusView): JobGlyph {
  switch (status) {
    case 'running':
    case 'stopping':
      return 'running';
    case 'failed':
      return 'failed';
    case 'completed':
    case 'killed':
      return 'success';
  }
}

export type JobTaskRow = {
  id: string;
  label: string;
  kindLabel: string;
  statusText: string;
  statusClass: string;
  killable: boolean;
  glyph: JobGlyph;
  /** Last lines of live output; absent for settled or quiet jobs. */
  tail?: string[];
};

const STATUS_CLASS: Record<JobStatusView, string> = {
  running: 'text-text-faint',
  stopping: 'text-text-faint',
  completed: 'text-text-faint',
  killed: 'text-text-faint',
  failed: 'text-error'
};

/**
 * Rows for the section, live first. Status text prefers the producer's
 * detail ('exit code: 3'), then elapsed time — same rule as the chip.
 */
export function jobTaskRows(jobs: readonly JobSnapshotView[], now: number): JobTaskRow[] {
  return sortJobsForDisplay(jobs).map((job) => {
    // Tail rides only on live rows: a preview next to 'Completed' would be a
    // stale lie, so the guard lives here rather than trusting snapshots.
    const liveTail =
      jobIsKillable(job.status) && job.tail && job.tail.length > 0
        ? { tail: job.tail.slice(-JOB_ROW_TAIL_LINES) }
        : {};

    return {
      id: job.id,
      label: truncateLabel(job.label),
      kindLabel: 'Job',
      statusText: job.detail ?? `${jobStatusLabel(job.status)} · ${jobElapsedLabel(job, now)}`,
      statusClass: STATUS_CLASS[job.status],
      killable: jobIsKillable(job.status),
      glyph: jobGlyph(job.status),
      ...liveTail
    };
  });
}

/** Tail lines a row previews — more than this needs the terminal. */
const JOB_ROW_TAIL_LINES = 2;
