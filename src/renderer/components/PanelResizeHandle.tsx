/**
 * Drag handle between panels.
 *
 * Invisible at rest — the Codex reference separates panels by background
 * color alone — accent while hovered or dragging. The hit area is
 * deliberately wider than the visible line — a 1px target is a 1px target
 * no matter how it looks — and the indicator fades in rather than snapping,
 * with a short delay so merely crossing the seam does not light it up.
 */

import { cn } from '../lib/utils';

export function PanelResizeHandle({
  ariaLabel,
  isResizing,
  width,
  minWidth,
  maxWidth,
  onPointerDown,
  onKeyDown,
  onReset,
  orientation = 'vertical',
}: {
  ariaLabel: string;
  isResizing: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  /** Double-click / Home restores the shipped width. */
  onReset?: () => void;
  /**
   * ARIA's sense, not the drag's: a `vertical` separator is a vertical line
   * between two side-by-side panels; `horizontal` is the seam above a
   * bottom-docked panel.
   */
  orientation?: 'vertical' | 'horizontal';
}) {
  const isRow = orientation === 'horizontal';

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuetext={`${Math.round(width)} pixels`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className={cn(
        'group relative z-10 shrink-0 touch-none select-none',
        isRow ? '-my-1.5 h-3 cursor-row-resize' : '-mx-1.5 w-3 cursor-col-resize'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute rounded-full bg-brand',
          isRow
            ? 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2'
            : 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2',
          'opacity-0 transition-opacity duration-150 delay-75 group-hover:opacity-100 group-focus-visible:opacity-100',
          isResizing && 'opacity-100 delay-0'
        )}
      />
    </div>
  );
}
