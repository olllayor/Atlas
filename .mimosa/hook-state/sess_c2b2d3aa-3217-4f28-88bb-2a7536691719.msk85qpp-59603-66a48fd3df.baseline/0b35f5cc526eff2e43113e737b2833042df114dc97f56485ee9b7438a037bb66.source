import { useId } from 'react';

import { cn } from '../../lib/utils';

/**
 * The Atlas mark: the keycap from the app icon, flattened.
 *
 * The shipped icon is a 1024px render with lighting and a baked grey backdrop —
 * it is right for the dock and wrong for everything inside the window, where it
 * cannot sit on a panel and turns to mush below about 64px. This is the same
 * idea drawn as geometry, so it inherits the current text colour, works on any
 * surface in either theme, and stays legible at 16px.
 *
 * `solid` knocks the letter out of the keycap with a mask rather than painting
 * it in a background colour: the counter then shows whatever is actually behind
 * the mark, so no call site has to know which surface it landed on.
 */
export function AtlasMark({
  className,
  variant = 'solid',
  title,
}: {
  className?: string;
  variant?: 'solid' | 'outline';
  /** Give it one only where the mark is the sole label; otherwise it is decoration. */
  title?: string;
}) {
  // Mask ids are document-global, and the mark renders many times per screen.
  const maskId = useId();

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {variant === 'outline' ? (
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" strokeWidth="1.4" />
          <path d="M8.4 17 12 7.4 15.6 17" strokeWidth="1.5" />
          <path d="M9.95 14.2H14.05" strokeWidth="1.5" />
        </g>
      ) : (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="white" />
            <path
              d="M7.7 17.4 12 6.6 16.3 17.4"
              fill="none"
              stroke="black"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M9.55 14.6H14.45" stroke="black" strokeWidth="1.8" strokeLinecap="round" />
          </mask>
          <rect
            x="2.5"
            y="2.5"
            width="19"
            height="19"
            rx="5.5"
            fill="currentColor"
            mask={`url(#${maskId})`}
          />
        </>
      )}
    </svg>
  );
}
