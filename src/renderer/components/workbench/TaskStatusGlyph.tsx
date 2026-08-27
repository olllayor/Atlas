import { Check, X } from 'lucide-react';

import type { ToolCellStatus } from '../../../shared/toolCellGrammar';
import { cn } from '../../lib/utils';

export const STATUS_ARIA_LABEL: Record<ToolCellStatus | 'job-live', string> = {
  pending: 'Queued',
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
  'awaiting-approval': 'Awaiting approval',
  'job-live': 'Job running'
};

/**
 * Status glyph vocabulary per the reference status list (spec §5): spinner
 * ring while running, hollow circle while queued, dim check when done, and
 * the theme's error hue on failure. Shared by the Tasks tab's tool rows and
 * its background-jobs section — the spinner is reserved for this surface.
 */
export function TaskStatusGlyph({
  status,
  className
}: {
  status: ToolCellStatus | 'job-live';
  className?: string;
}) {
  const label = STATUS_ARIA_LABEL[status];

  if (status === 'success') {
    return <Check role="img" aria-label={label} className={cn('size-3.5 text-text-faint', className)} />;
  }

  if (status === 'failed') {
    return <X role="img" aria-label={label} className={cn('size-3.5 text-error', className)} />;
  }

  if (status === 'running' || status === 'job-live') {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn(
          'size-3 motion-spin-steps rounded-full border-[1.5px] border-text-tertiary border-t-transparent',
          className
        )}
      />
    );
  }

  // Queued / awaiting approval: hollow circle. Approval borrows the
  // warning hue so a blocked task is findable without a badge.
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'size-3 rounded-full border-[1.5px]',
        status === 'awaiting-approval' ? 'border-warning' : 'border-text-faint',
        className
      )}
    />
  );
}
