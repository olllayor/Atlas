import { AppWindow, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { DetectedIde, WorkspaceMode, WorkspaceProject } from '../../../shared/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';

/**
 * The application's own icon, straight from the OS.
 *
 * `alt` is empty on purpose: every place this is drawn already carries the
 * app's name in text or in a label, and a second announcement of "Cursor" is
 * noise to a screen reader.
 */
function AppIcon({ ide, className }: { ide: DetectedIde; className?: string }) {
  if (!ide.iconDataUrl) {
    return <AppWindow className={cn('text-text-tertiary', className)} strokeWidth={1.75} aria-hidden="true" />;
  }

  // Etched edge: full-bleed dark marks (Cursor's black tile) melt into a dark
  // button at 16px with no boundary. The ring draws the square's edge whatever
  // the icon's own shape, in a theme token so it inverts with the theme.
  return (
    <img
      src={ide.iconDataUrl}
      alt=""
      className={cn('rounded-[3px] object-contain ring-1 ring-border-subtle', className)}
    />
  );
}

/**
 * "Open in <app>" — the handoff back out of Atlas.
 *
 * It lives in the title bar rather than in the workspace strip above the
 * composer because the strip is only up on an untouched session, and the moment
 * you want this is the opposite one: the agent has just edited files and you
 * want to look at them. A control for reviewing work has to outlive the first
 * message.
 *
 * Code mode only. In work mode the folder is context the model reads, not a
 * checkout you are editing alongside Atlas, so the handoff has nothing to hand
 * off to.
 *
 * The face of the button is the target app's real icon, so the control answers
 * "where does this go" before it is read — which is also why the label is not
 * spelled out: the icon is the more specific thing, and the tooltip carries the
 * name for anyone who wants it.
 */
export function OpenInIdeButton({
  mode,
  project,
}: {
  mode: WorkspaceMode;
  project: WorkspaceProject | null;
}) {
  const [ides, setIdes] = useState<DetectedIde[]>([]);
  const [opening, setOpening] = useState(false);
  const enabled = mode === 'code' && Boolean(project?.exists);

  useEffect(() => {
    let cancelled = false;

    // Nothing is scanned until a conversation is actually in code mode with a
    // folder, so work-mode chats never pay for the filesystem walk.
    if (!enabled || !window.atlasChat?.projects?.listIdes) return;

    void window.atlasChat.projects
      .listIdes()
      .then((list) => {
        if (!cancelled) setIdes(list);
      })
      .catch((err) => {
        // A failed scan is the same outcome as an empty one: no button.
        console.warn('Failed to detect applications:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const preferred = ides.find((ide) => ide.preferred) ?? ides[0] ?? null;

  if (!enabled || !project || !preferred) return null;

  const open = async (ideId?: string) => {
    if (opening) return;
    setOpening(true);

    try {
      await window.atlasChat.projects.openInIde(project.id, ideId);

      // The main process just persisted this choice; mirror it so the face of
      // the button follows the click instead of waiting for the next mount.
      if (ideId) {
        setIdes((current) => current.map((ide) => ({ ...ide, preferred: ide.id === ideId })));
      }
    } catch (err) {
      notifyError(`Could not open ${project.title}`, err);
    } finally {
      setOpening(false);
    }
  };

  const hasChoice = ides.length > 1;

  return (
    <DropdownMenu>
      {/*
        A split button: the icon opens, the chevron chooses. They share one
        bordered shell so the pair reads as a single control rather than as two
        toggles that happen to be adjacent — the two beside it in this bar are
        borderless for exactly that contrast.
      */}
      <div
        className={cn(
          'flex h-7 items-center overflow-hidden rounded-lg border border-border-default bg-bg-surface',
          opening && 'opacity-60'
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Open ${project.title} in ${preferred.name}`}
              disabled={opening}
              onClick={() => void open()}
              className="flex h-full w-7 items-center justify-center transition-colors hover:bg-bg-hover disabled:cursor-not-allowed"
            >
              <AppIcon ide={preferred} className="size-4 rounded-[3px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open in {preferred.name}</TooltipContent>
        </Tooltip>

        {hasChoice ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Choose which application to open the folder in"
                  disabled={opening}
                  className="flex h-full w-5 items-center justify-center border-l border-border-default text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:cursor-not-allowed"
                >
                  <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in another application</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-60 rounded-xl border border-border-default bg-bg-overlay p-1.5 shadow-none"
      >
        {ides.map((ide) => (
          <DropdownMenuItem
            key={ide.id}
            onSelect={() => void open(ide.id)}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm"
          >
            <AppIcon ide={ide} className="size-5 shrink-0 rounded-[4px]" />
            <span className="truncate">{ide.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
