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
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
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
      className="group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize touch-none select-none"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-brand',
          'opacity-0 transition-opacity duration-150 delay-75 group-hover:opacity-100 group-focus-visible:opacity-100',
          isResizing && 'opacity-100 delay-0'
        )}
      />
    </div>
  );
}
