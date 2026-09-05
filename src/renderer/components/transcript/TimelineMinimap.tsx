import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import {
  MINIMAP_MIN_ITEMS,
  isRowInView,
  resolveMinimapHasPersistentGutter,
  resolveMinimapHeightStyle,
  resolveMinimapHitStripWidth,
  resolveMinimapIndexFromPointer,
  resolveMinimapInteractiveWidth,
  resolveMinimapTopPercent,
  type MinimapItem,
  type VirtualRange,
} from '../../lib/timelineMinimap';

/**
 * Left-gutter jump rail for the transcript, ported from t3code's timeline
 * minimap: one tick per user turn, evenly spaced (the transcript's own
 * scrollbar already encodes true pixel distance), active tick widened and
 * neighbours shrinking with distance, in-view ticks brightened via
 * `data-in-view` synced by the parent from the virtualizer's range.
 *
 * The whole surface is `pointer-events-none` except a hit strip that is
 * width-capped to the side gutter, so it can never swallow selections in the
 * message column on narrow panes. With no usable gutter it hides until hover.
 */
export function TimelineMinimap({
  items,
  stripMap,
  viewportElement,
  range,
  onSelect,
}: {
  items: readonly MinimapItem[];
  /** Parent-owned so the in-view sync effect can run against virtualizer state. */
  stripMap: Map<string, HTMLSpanElement>;
  viewportElement: HTMLElement | null;
  range: VirtualRange | null;
  onSelect: (rowIndex: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hasPersistentGutter, setHasPersistentGutter] = useState(false);
  const [hitStripWidth, setHitStripWidth] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Gutter measurement tracks the scroller's box, not the window: sidebar,
  // workbench, and zoom all change the room the rail actually has.
  useEffect(() => {
    if (!viewportElement) return;

    const measure = () => {
      const viewportWidth = viewportElement.getBoundingClientRect().width;
      const nextPersistent = resolveMinimapHasPersistentGutter(viewportWidth);
      setHasPersistentGutter((current) => (current === nextPersistent ? current : nextPersistent));
      setHitStripWidth(resolveMinimapHitStripWidth(viewportWidth));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [viewportElement]);

  useEffect(() => {
    for (const item of items) {
      const strip = stripMap.get(item.id);
      if (!strip) continue;
      strip.dataset.inView = isRowInView(item.rowIndex, range) ? 'true' : 'false';
    }
  }, [items, range, stripMap]);

  useEffect(() => {
    if (items.length < MINIMAP_MIN_ITEMS) {
      setActiveIndex(null);
    }
  }, [items.length]);

  const resolveActiveIndexFromPointer = useCallback(
    (event: { clientY: number }): number | null => {
      const button = buttonRef.current;
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return resolveMinimapIndexFromPointer({
        itemCount: items.length,
        railTop: rect.top,
        railHeight: rect.height,
        pointerY: event.clientY,
      });
    },
    [items.length]
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        if (items.length === 0) return null;
        const base = current ?? 0;
        return Math.max(0, Math.min(items.length - 1, base + delta));
      });
    },
    [items.length]
  );

  if (items.length < MINIMAP_MIN_ITEMS) return null;

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex >= 0 && activeIndex < items.length ? activeIndex : null;
  const activeItem = resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null);

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 z-20 hidden w-18 [@media(pointer:fine)]:block',
        hasPersistentGutter
          ? 'opacity-100'
          : 'opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100'
      )}
      data-testid="timeline-minimap"
      data-persistent-gutter={hasPersistentGutter ? 'true' : 'false'}
    >
      <div className="relative h-full w-full select-none">
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Jump to message: ${activeItem?.userText ?? 'User message'}`}
          className={cn(
            'absolute top-1/2 left-3 -translate-y-1/2 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
            // The strip is width-capped to the side gutter so it never overlays
            // the centered content column; with no usable gutter it goes inert.
            hitStripWidth > 0 ? 'pointer-events-auto' : 'pointer-events-none'
          )}
          onBlur={() => setActiveIndex(null)}
          onClick={(event) => {
            if (minimapEventTargetsPreview(event.target)) return;
            const nextIndex = resolveActiveIndexFromPointer(event);
            const nextItem = nextIndex === null ? null : (items[nextIndex] ?? null);
            if (nextItem) onSelect(nextItem.rowIndex);
            event.currentTarget.blur();
          }}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveActiveIndex(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveActiveIndex(-1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActiveIndex(items.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (activeItem) onSelect(activeItem.rowIndex);
            }
          }}
          onMouseLeave={() => setActiveIndex(null)}
          onMouseMove={updateActiveIndexFromPointer(resolveActiveIndexFromPointer, setActiveIndex)}
          onMouseDown={(event) => {
            if (minimapEventTargetsPreview(event.target)) return;
            event.preventDefault();
          }}
          style={{
            height: resolveMinimapHeightStyle(items.length),
            width: resolveMinimapInteractiveWidth(hitStripWidth, activeItem !== null),
          }}
        >
          <div className="absolute top-0 left-3 h-full w-px bg-border-default/15" />
          {items.map((item, index) => {
            const top = `${resolveMinimapTopPercent(index, items.length)}%`;
            const activeDistance =
              resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);
            return (
              <span
                key={item.id}
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute left-0 h-0.5 -translate-y-1/2 rounded-full bg-text-faint/35 transition-[background-color,width] duration-150 data-[in-view=true]:bg-text-primary/90',
                  activeDistance === 0
                    ? 'w-6 bg-text-faint/75'
                    : activeDistance === 1
                      ? 'w-4'
                      : activeDistance === 2
                        ? 'w-2.5'
                        : 'w-2'
                )}
                data-in-view="false"
                data-minimap-strip
                ref={(node) => {
                  if (node) {
                    stripMap.set(item.id, node);
                  } else {
                    stripMap.delete(item.id);
                  }
                }}
                style={{ top }}
              />
            );
          })}
          {activeItem ? (
            <span
              className="pointer-events-auto absolute left-8 w-80 cursor-text select-text"
              data-minimap-preview
              onMouseMove={(event) => event.stopPropagation()}
              style={{
                top: `${resolveMinimapTopPercent(resolvedActiveIndex ?? 0, items.length)}%`,
                transform: 'translateY(-50%)',
              }}
            >
              {/* Flat popover per the codex-parity direction — no glass. */}
              <span className="block rounded-xl border border-border-subtle bg-bg-overlay p-3 text-left shadow-elevated">
                <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5 text-text-primary">
                  {activeItem.userText || 'User message'}
                </span>
                {activeItem.assistantText ? (
                  <span className="mt-1 line-clamp-3 overflow-hidden text-sm leading-5 text-text-muted">
                    {activeItem.assistantText}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function minimapEventTargetsPreview(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-minimap-preview]') !== null;
}

function updateActiveIndexFromPointer(
  resolve: (event: { clientY: number }) => number | null,
  setActiveIndex: (index: number | null) => void
) {
  return (event: React.MouseEvent<HTMLButtonElement>) => {
    if (minimapEventTargetsPreview(event.target)) return;
    setActiveIndex(resolve(event));
  };
}
