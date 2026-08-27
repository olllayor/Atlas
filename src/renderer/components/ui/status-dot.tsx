import { cn } from '../../lib/utils';

type StatusDotTone = 'running' | 'failed' | 'attention' | 'unread';

/**
 * `sm` fronts a conversation row, `md` stands alone in the collapsed rail's
 * 36px button where it is the only mark in the target and needs the presence.
 */
type StatusDotSize = 'sm' | 'md';

type StatusDotProps = {
  tone: StatusDotTone;
  /**
   * Announced and shown on hover — the dot carries no text of its own. Omit it
   * only where an ancestor already names the state (the collapsed rail's button
   * has both an `aria-label` and a tooltip); the dot is then decorative and is
   * hidden from assistive tech rather than announced twice.
   */
  label?: string;
  size?: StatusDotSize;
  className?: string;
};

const SLOT: Record<StatusDotSize, string> = {
  sm: 'size-3',
  md: 'size-4',
};

const DOT: Record<StatusDotSize, string> = {
  sm: 'size-1.5',
  md: 'size-2',
};

/**
 * The state mark in front of a sidebar conversation: running, or last-turn-failed.
 *
 * **Why a dot and not a spinner.** This replaced `BrushSpinner`, a rotating 70%
 * arc driven by a hand-rolled `requestAnimationFrame` loop that wrote a transform
 * through `motion` on every vsync — 120 times a second on a ProMotion display, and
 * once per instance, so N running conversations meant N loops. The reference app
 * has no spinner at all: `docs/codex-parity/design-audit.md` §10 records its running
 * indicator as a shimmering `•`, budgeted at ~31fps and phase-locked across every
 * element that shows one. A duty-cycled opacity pulse on a drawn dot is the honest
 * web reading of that, and it costs the compositor frames only while the value is
 * actually changing (see `atlas-glyph-pulse` in `styles.css`).
 *
 * `.motion-glyph-pulse` is named for a text glyph but is opacity-only, so it applies
 * to a drawn dot unchanged — and it shares the 2s period with `.motion-shimmer`, so
 * a sidebar dot and a shimmering label in the transcript stay in step.
 *
 * **Why both tones live in one component.** They occupy the same slot, and that is
 * the entire point: a row must not shift by a few pixels at the moment a task ends.
 * Two separate spans drifted apart once already — the old running mark was 12px wide
 * and the failed mark 6px, so every failure nudged the title. Making the slot a
 * property of the component rather than of each call site means it cannot recur.
 */
export function StatusDot({ tone, label, size = 'sm', className }: StatusDotProps) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
      className={cn('flex shrink-0 items-center justify-center', SLOT[size], className)}
    >
      <span
        className={cn(
          'rounded-full',
          DOT[size],
          // Reduce motion is handled centrally: the root `[data-reduce-motion]`
          // rule and the `prefers-reduced-motion` block both leave the dot
          // painted and static. "Running" stays legible without the motion.
          tone === 'running'
            ? 'motion-glyph-pulse bg-text-secondary'
            : tone === 'failed'
              ? 'bg-error'
              : tone === 'attention'
                ? // An approval or error wants a hand, not just an eye —
                  // accent + pulse separates it from ambient activity.
                  'motion-glyph-pulse bg-accent'
                : // Unread output waits patiently; static and quiet.
                  'bg-text-tertiary'
        )}
      />
    </span>
  );
}
