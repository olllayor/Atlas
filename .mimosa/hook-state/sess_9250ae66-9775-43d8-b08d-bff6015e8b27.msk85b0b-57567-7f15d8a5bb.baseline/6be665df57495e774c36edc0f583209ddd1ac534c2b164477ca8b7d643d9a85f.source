import { SlotText } from 'slot-text/react';

import { useReducedMotion } from '../../lib/reducedMotion';

type SlotLabelProps = {
  text: string;
  /** Stagger between characters, in ms. Defaults to a snappy 28 for buttons. */
  stagger?: number;
  /** Per-character slide duration, in ms. */
  duration?: number;
  direction?: 'up' | 'down';
  className?: string;
};

/**
 * Tactile text-roll label. Same shape as <SlotText> from slot-text/react,
 * but short-circuits to plain text when motion is reduced — either because the
 * user set Settings → Appearance → Reduce motion, or because the OS asks for it.
 * Both resolve to <html data-reduce-motion>, which useReducedMotion tracks live.
 *
 * Tailored for short, state-toggle labels (Save / Saving, Copy / Copied, etc.).
 * Do not use for body copy, streaming content, or anything that updates more
 * often than a handful of times per second.
 */
export function SlotLabel({ text, stagger = 28, duration = 220, direction = 'up', className }: SlotLabelProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <span className={className}>{text}</span>;
  }

  return (
    <SlotText
      className={className}
      options={{ direction, stagger, duration, skipUnchanged: true, interrupt: true }}
      text={text}
    />
  );
}
