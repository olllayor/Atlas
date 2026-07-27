import { SlotText } from 'slot-text/react';
import { useEffect, useState } from 'react';

type SlotLabelProps = {
  text: string;
  /** Stagger between characters, in ms. Defaults to a snappy 28 for buttons. */
  stagger?: number;
  /** Per-character slide duration, in ms. */
  duration?: number;
  direction?: 'up' | 'down';
  className?: string;
};

const MOTION_OFF_SELECTOR = '[data-atlas-motion="off"]';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);

  return reduced;
}

function useAtlasMotionOff(): boolean {
  const [off, setOff] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setOff(root.matches(MOTION_OFF_SELECTOR));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-atlas-motion'] });
    return () => observer.disconnect();
  }, []);

  return off;
}

/**
 * Tactile text-roll label. Same shape as <SlotText> from slot-text/react,
 * but short-circuits to plain text when:
 *  - the user has prefers-reduced-motion: reduce enabled
 *  - the document root has data-atlas-motion="off" (project-wide kill switch)
 *
 * Tailored for short, state-toggle labels (Save / Saving, Copy / Copied, etc.).
 * Do not use for body copy, streaming content, or anything that updates more
 * often than a handful of times per second.
 */
export function SlotLabel({ text, stagger = 28, duration = 220, direction = 'up', className }: SlotLabelProps) {
  const reduced = usePrefersReducedMotion();
  const motionOff = useAtlasMotionOff();

  if (reduced || motionOff) {
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
