/**
 * The right panel's tab strip: one tab per open surface, plus the `+` that
 * opens another.
 *
 * Tabs carry an icon and a close affordance because a surface is a thing the
 * user opened, not a section of a fixed panel — the strip has to make closing
 * as obvious as opening. The `+` menu lists every surface, including the ones
 * this conversation cannot open, each with the reason it cannot.
 */

import { PanelRightClose, Plus, X } from 'lucide-react';

import { cn } from '../../lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { StatusDot } from '../ui/status-dot';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import type { RightPanelKind, RightPanelSurface, SurfaceId } from './rightPanelModel';
import { SURFACE_DEFINITIONS, type SurfaceContext, surfaceDefinition } from './surfaceRegistry';

export type SurfaceTabStripProps = {
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: SurfaceId | null;
  context: SurfaceContext;
  /** Kinds with work in flight; they carry a pulse so the strip reads as alive. */
  liveKinds?: ReadonlySet<RightPanelKind>;
  /** Trailing counts, where a count means something. Zero is not drawn. */
  counts?: Partial<Record<RightPanelKind, number>>;
  /**
   * Overrides the registry label for one surface. A terminal names itself
   * after whatever it is running, which the registry cannot know.
   */
  labelFor?: (surface: RightPanelSurface) => string | undefined;
  onActivate: (id: SurfaceId) => void;
  onOpen: (kind: RightPanelKind) => void;
  onClose: (id: SurfaceId) => void;
  onCloseOthers: (id: SurfaceId) => void;
  onCloseToRight: (id: SurfaceId) => void;
  onCloseAll: () => void;
  /** Hides the whole panel, leaving the open surfaces where they were. */
  onHidePanel: () => void;
};

export function SurfaceTabStrip({
  surfaces,
  activeSurfaceId,
  context,
  liveKinds,
  counts,
  labelFor,
  onActivate,
  onOpen,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onHidePanel,
}: SurfaceTabStripProps) {
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (surfaces.length === 0) return;
    event.preventDefault();

    const index = surfaces.findIndex((surface) => surface.id === activeSurfaceId);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? surfaces.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % surfaces.length
            : (index - 1 + surfaces.length) % surfaces.length;

    const target = surfaces[next];
    if (!target) return;
    onActivate(target.id);
    document.getElementById(`workbench-tab-${target.id}`)?.focus();
  };

  return (
    <div className="flex h-titlebar-height shrink-0 items-center gap-1 pr-2 pl-2">
      <div
        role="tablist"
        aria-label="Right panel surfaces"
        onKeyDown={moveFocus}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-auto-hide"
      >
        {surfaces.map((surface) => (
          <SurfaceTab
            key={surface.id}
            surface={surface}
            active={surface.id === activeSurfaceId}
            live={liveKinds?.has(surface.kind) ?? false}
            count={counts?.[surface.kind] ?? 0}
            label={labelFor?.(surface)}
            onActivate={() => onActivate(surface.id)}
            onClose={() => onClose(surface.id)}
            onCloseOthers={() => onCloseOthers(surface.id)}
            onCloseToRight={() => onCloseToRight(surface.id)}
            onCloseAll={onCloseAll}
            canCloseOthers={surfaces.length > 1}
            canCloseToRight={surfaces.at(-1)?.id !== surface.id}
          />
        ))}
      </div>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              aria-label="Open a surface"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Plus className="size-4" aria-hidden />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open a surface</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          {SURFACE_DEFINITIONS.filter((definition) => definition.launcher).map((definition) => {
            const availability = definition.availability(context);
            const Icon = definition.icon;

            return (
              <DropdownMenuItem
                key={definition.kind}
                disabled={!availability.available}
                onSelect={() => onOpen(definition.kind)}
                className="gap-2"
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {definition.label}
                  {availability.available ? null : (
                    <span className="block truncate text-xs text-text-faint">
                      {availability.hint}
                    </span>
                  )}
                </span>
                <DropdownMenuShortcut>{definition.shortcut}</DropdownMenuShortcut>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onHidePanel}
            aria-label="Hide right panel"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <PanelRightClose className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Hide panel</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SurfaceTab({
  surface,
  active,
  live,
  count,
  label: labelOverride,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  canCloseOthers,
  canCloseToRight,
}: {
  surface: RightPanelSurface;
  active: boolean;
  live: boolean;
  count: number;
  label?: string;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  canCloseOthers: boolean;
  canCloseToRight: boolean;
}) {
  const definition = surfaceDefinition(surface.kind);
  const Icon = definition?.icon;
  const label = labelOverride ?? definition?.label ?? surface.kind;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={`workbench-tab-${surface.id}`}
          role="tab"
          aria-selected={active}
          aria-controls="workbench-panel"
          tabIndex={active ? 0 : -1}
          onClick={onActivate}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onActivate();
          }}
          // Middle click closes, the way every tab strip does.
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onClose();
          }}
          className={cn(
            'group flex shrink-0 cursor-default items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-sm transition-colors',
            active
              ? 'bg-bg-active text-text-primary'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          )}
        >
          {live ? (
            <StatusDot tone="running" label={`${label} running`} />
          ) : Icon ? (
            <Icon className="size-3.5 shrink-0" aria-hidden />
          ) : null}
          <span className="max-w-36 truncate">{label}</span>
          {count > 0 ? <span className="shrink-0 tabular-nums text-text-faint">{count}</span> : null}
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className={cn(
              'flex size-4 items-center justify-center rounded text-text-faint transition-opacity hover:bg-bg-hover hover:text-text-primary',
              // Reserved space either way, so hovering a tab does not shift
              // the whole strip sideways.
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onClose}>Close</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers} disabled={!canCloseOthers}>
          Close others
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseToRight} disabled={!canCloseToRight}>
          Close to the right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCloseAll}>Close all</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
