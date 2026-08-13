/**
 * A file named inside a reply, drawn as a chip rather than as a link.
 *
 * When a turn says which file it changed, the filename is the load-bearing
 * word in the sentence — the reader scans for it. A blue underlined URL buries
 * it in the prose and promises a navigation the app cannot perform; a chip with
 * an extension badge lets the eye find every file in a paragraph at a glance
 * and says what kind of file it is before the name is read.
 *
 * The directory is kept in the title attribute rather than on screen: inside a
 * sentence the path is noise, and the chip already carries the disambiguating
 * part in its tooltip for the two-`index.ts` case.
 */

import type { ReactNode } from 'react';

import { fileRefBadge, parseFileRef } from '../../../shared/fileRef';
import { cn } from '../../lib/utils';

export function FileRefChip({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  /** The link's own text, used when it says something other than the path. */
  children?: ReactNode;
}) {
  const ref = parseFileRef(href);

  if (!ref) return null;

  // A link written as `[the composer](src/.../Composer.tsx)` keeps its words;
  // one written as `[Composer.tsx](src/.../Composer.tsx)` — which is what the
  // model is asked for — shows the filename, and the line number if it named
  // one.
  const label = children ?? `${ref.name}${ref.line ? `:${ref.line}` : ''}`;

  return (
    <span
      className={cn(
        'inline-flex max-w-full translate-y-[0.1em] items-center gap-1 align-baseline',
        className
      )}
      title={ref.line ? `${ref.path}:${ref.line}` : ref.path}
    >
      {/*
        Fixed 16px rather than an em box: the badge sets its own font-size, so
        an em here would size the tile against the 10px inside it and collapse
        to a speck.
      */}
      <span
        aria-hidden
        className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] bg-brand-surface px-1 font-mono text-[10px] font-semibold leading-none text-brand"
      >
        {fileRefBadge(ref.extension)}
      </span>
      <span className="truncate text-brand">{label}</span>
    </span>
  );
}
