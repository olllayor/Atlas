/**
 * How a pull request reads on the workbench.
 *
 * The rules here are t3code's (`pullRequestPresentation.tsx`), kept because
 * each is a decision rather than a style:
 *
 * - One state, one glyph, one colour, everywhere. A pull request cannot look
 *   like two different things in the list and on the detail.
 * - Draft outranks conflicts. A draft is not heading for a merge yet, so
 *   conflicts only surface once it is real work.
 * - Failing outranks pending in a check rollup: a run still going cannot
 *   un-fail the one that already did.
 * - A verdict is shown only when somebody gave one. "Review required" is the
 *   absence of a verdict, and printing it on every unreviewed row says nothing.
 */

import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import type {
  PullRequestActor,
  PullRequestCheckStatus,
  PullRequestChecksState,
  PullRequestMergeability,
  PullRequestState,
} from '../../../shared/contracts';
import { cn } from '../../lib/utils';

type StatePresentation = {
  label: string;
  toneClassName: string;
  Icon: LucideIcon;
};

export function resolvePullRequestState(input: {
  state: PullRequestState;
  isDraft: boolean;
  mergeability?: PullRequestMergeability;
  baseBranch?: string;
}): StatePresentation {
  if (input.state === 'merged') {
    return { label: 'Merged', toneClassName: 'text-violet-600 dark:text-violet-300/90', Icon: GitMerge };
  }
  if (input.state === 'closed') {
    return {
      label: 'Closed',
      toneClassName: 'text-red-600 dark:text-red-300/90',
      Icon: GitPullRequestClosed,
    };
  }
  if (input.isDraft) {
    return {
      label: 'Draft',
      toneClassName: 'text-text-faint',
      Icon: GitPullRequestDraft,
    };
  }
  if (input.mergeability === 'conflicting') {
    return {
      // "Has conflicts" leaves out the one thing a reader wants once the
      // triangle catches their eye, so name the branch wherever the caller
      // knows it.
      label: input.baseBranch ? `Conflicts with ${input.baseBranch}` : 'Has conflicts',
      toneClassName: 'text-red-600 dark:text-red-400/90',
      Icon: TriangleAlert,
    };
  }
  return {
    label: 'Open',
    toneClassName: 'text-emerald-600 dark:text-emerald-300/90',
    Icon: GitPullRequest,
  };
}

export function PullRequestStateGlyph({
  state,
  isDraft,
  mergeability,
  baseBranch,
  className,
}: {
  state: PullRequestState;
  isDraft: boolean;
  mergeability?: PullRequestMergeability;
  baseBranch?: string;
  className?: string;
}) {
  const presentation = resolvePullRequestState({
    state,
    isDraft,
    ...(mergeability ? { mergeability } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  });

  // The list row is itself a button, so this stays a plain glyph inside a span
  // carrying the native title: an interactive tooltip trigger would nest a
  // control inside that button and steal the row's click target.
  return (
    <span className="inline-flex shrink-0" title={presentation.label}>
      <presentation.Icon
        role="img"
        aria-label={presentation.label}
        className={cn('size-4 shrink-0', presentation.toneClassName, className)}
      />
    </span>
  );
}

const CHECK_STATUS_PRESENTATION: Record<
  PullRequestCheckStatus,
  { label: string; Icon: LucideIcon; toneClassName: string }
> = {
  pending: { label: 'Running', Icon: CircleDot, toneClassName: 'text-amber-600 dark:text-amber-400/90' },
  success: {
    label: 'Passed',
    Icon: CircleCheck,
    toneClassName: 'text-emerald-600 dark:text-emerald-300/90',
  },
  failure: { label: 'Failed', Icon: CircleX, toneClassName: 'text-red-600 dark:text-red-400/90' },
  skipped: { label: 'Skipped', Icon: CircleDashed, toneClassName: 'text-text-faint' },
  cancelled: { label: 'Cancelled', Icon: CircleDashed, toneClassName: 'text-text-faint' },
};

export function pullRequestCheckPresentation(status: PullRequestCheckStatus) {
  return CHECK_STATUS_PRESENTATION[status];
}

const CHECKS_STATE_PRESENTATION: Record<
  PullRequestChecksState,
  { label: string; Icon: LucideIcon; toneClassName: string }
> = {
  passing: {
    label: 'All checks passing',
    Icon: CircleCheck,
    toneClassName: 'text-emerald-600 dark:text-emerald-300/90',
  },
  failing: { label: 'Some checks failing', Icon: CircleX, toneClassName: 'text-red-600 dark:text-red-400/90' },
  pending: {
    label: 'Checks running',
    Icon: CircleDot,
    toneClassName: 'text-amber-600 dark:text-amber-400/90',
  },
};

export function PullRequestChecksGlyph({
  checksState,
  className,
}: {
  checksState: PullRequestChecksState;
  className?: string;
}) {
  const presentation = CHECKS_STATE_PRESENTATION[checksState];
  return (
    <span className="inline-flex shrink-0" title={presentation.label}>
      <presentation.Icon
        role="img"
        aria-label={presentation.label}
        className={cn('size-3.5 shrink-0', presentation.toneClassName, className)}
      />
    </span>
  );
}

/**
 * `+n −n`, with each half hidden when it is zero.
 *
 * A minus sign rather than a hyphen: the numbers are tabular, and a hyphen at
 * this size reads as a dash between them.
 */
export function PullRequestDiffStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className={cn('flex shrink-0 items-center gap-1.5 tabular-nums', className)}>
      {additions > 0 ? <span className="text-emerald-600 dark:text-emerald-400/80">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-red-600 dark:text-red-400/80">−{deletions}</span> : null}
    </span>
  );
}

/** The author's login, which is the name that matches what the host shows. */
export function pullRequestActorLabel(actor: PullRequestActor | null): string {
  return actor?.login ?? 'unknown';
}

const RELATIVE_UNITS: [limitSeconds: number, perUnit: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, 'second'],
  [3_600, 60, 'minute'],
  [86_400, 3_600, 'hour'],
  [604_800, 86_400, 'day'],
  [2_629_800, 604_800, 'week'],
  [31_557_600, 2_629_800, 'month'],
  [Number.POSITIVE_INFINITY, 31_557_600, 'year'],
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/**
 * "3 hours ago", from an ISO timestamp.
 *
 * A timestamp that does not parse comes back as an empty string rather than
 * "Invalid Date", so the caller renders nothing where it would have rendered
 * a lie.
 */
export function formatRelativeTime(raw: string, now: number = Date.now()): string {
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return '';

  const seconds = (at - now) / 1000;
  const magnitude = Math.abs(seconds);

  for (const [limit, perUnit, unit] of RELATIVE_UNITS) {
    if (magnitude < limit) {
      return relativeFormatter.format(Math.round(seconds / perUnit), unit);
    }
  }

  return '';
}
