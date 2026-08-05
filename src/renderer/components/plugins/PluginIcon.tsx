import { useState } from 'react';

import { cn } from '../../lib/utils';

/**
 * A plugin's artwork, with a monogram behind it.
 *
 * Two cases need the fallback and neither is an error: a bundle that ships no
 * icon, and a catalogue entry whose bundle has not been fetched yet. A grid
 * where a third of the tiles are empty boxes reads as broken, so the monogram
 * is the normal state rather than an error state — same shape, same weight, so
 * rows stay aligned either way.
 */
export function PluginIcon({
  name,
  iconUrl,
  size = 'md'
}: {
  name: string;
  iconUrl: string | null;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState(false);
  const box = size === 'sm' ? 'size-7 rounded-md text-2xs' : 'size-10 rounded-xl text-sm';

  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        onError={() => setFailed(true)}
        className={cn(box, 'shrink-0 object-cover')}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        box,
        'flex shrink-0 items-center justify-center bg-bg-hover font-medium uppercase text-text-tertiary'
      )}
      // Hue from the name so a grid is scannable and a plugin keeps the same
      // colour between sessions. Not decoration: it is the only thing
      // distinguishing two icon-less tiles at a glance.
      style={{ backgroundColor: `oklch(0.28 0.05 ${hueFor(name)})` }}
    >
      {name.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?'}
    </span>
  );
}

function hueFor(name: string): number {
  let hash = 0;

  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }

  return hash;
}
