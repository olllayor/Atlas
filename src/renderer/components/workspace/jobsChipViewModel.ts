import type { JobSnapshotView, JobStatusView } from '../../../shared/contracts';

/**
 * Pure presentation logic for the background-jobs chip.
 *
 * The chip and its dropdown are thin; everything that decides *what to show*
 * lives here so it can be tested without mounting Radix. Mirrors the
 * `executionTargetViewModel` / `sidebarViewModel` convention: the component
 * owns fetching and subscription, this module owns the shape of the render.
 */

/** The chip renders nothing unless the conversation owns at least one job. */
export function jobsChipVisible(jobs: readonly JobSnapshotView[]): boolean {
  return jobs.length > 0;
}

/** How many jobs are still live (`running` or `stopping`). */
export function activeJobCount(jobs: readonly JobSnapshotView[]): number {
  return jobs.filter((job) => job.status === 'running' || job.status === 'stopping').length;
}

/**
 * The chip's headline number. While anything is live it reads `active/total`
 * (matching the plugin-tools chip's `active/total` shape); once everything has
 * settled it just shows the total so the strip stays quiet.
 */
export function jobsChipLabel(jobs: readonly JobSnapshotView[]): string {
  const active = activeJobCount(jobs);
  return active > 0 ? `${active}/${jobs.length}` : `${jobs.length}`;
}

/** A human status word for one job, used both in the row and its tooltip. */
export function jobStatusLabel(status: JobStatusView): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'stopping':
      return 'Stopping';
    case 'completed':
      return 'Completed';
    case 'killed':
      return 'Stopped';
    case 'failed':
      return 'Failed';
  }
}

/** Whether the row should offer a stop action (only while live). */
export function jobIsKillable(status: JobStatusView): boolean {
  return status === 'running' || status === 'stopping';
}

/**
 * Elapsed wall-clock for a job, formatted compactly. Live jobs count against
 * `now`; settled jobs use their own start→finish span so the number stops
 * moving once they end.
 */
export function jobElapsedLabel(job: JobSnapshotView, now: number): string {
  const end = job.finishedAt ?? now;
  const ms = Math.max(0, end - job.startedAt);

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * One dropdown row. `subtitle` prefers the producer's detail ('exit code: 3')
 * and falls back to the elapsed time, so a settled row explains itself without
 * a second line of chrome.
 */
export function jobRowView(job: JobSnapshotView, now: number): {
  id: string;
  label: string;
  status: JobStatusView;
  statusLabel: string;
  subtitle: string;
  killable: boolean;
} {
  return {
    id: job.id,
    label: job.label,
    status: job.status,
    statusLabel: jobStatusLabel(job.status),
    subtitle: job.detail ?? jobElapsedLabel(job, now),
    killable: jobIsKillable(job.status)
  };
}

/**
 * Sort for the dropdown: live jobs first (most recent start first), then
 * settled jobs most-recently-finished first. Keeps the actionable rows on top.
 */
export function sortJobsForDisplay(jobs: readonly JobSnapshotView[]): JobSnapshotView[] {
  return [...jobs].sort((a, b) => {
    const aLive = a.status === 'running' || a.status === 'stopping' ? 1 : 0;
    const bLive = b.status === 'running' || b.status === 'stopping' ? 1 : 0;
    if (aLive !== bLive) {
      return bLive - aLive;
    }

    const aTime = a.finishedAt ?? a.startedAt;
    const bTime = b.finishedAt ?? b.startedAt;
    return bTime - aTime;
  });
}
