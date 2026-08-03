import { AlertTriangle, Check, ChevronDown, PanelBottom, PanelRight } from 'lucide-react';

import type { WorkspaceMode } from '../../../shared/contracts';
import { WORKSPACE_MODES, describeWorkspaceMode } from '../../../shared/workspaceModes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '../../lib/utils';

const UNREADY_HINT = 'Code mode needs a project folder — choose one to enable editing.';

/**
 * The mode reads as a product name, the way "ChatGPT Work" and "Codex" do —
 * this control took the wordmark's place in the sidebar header, so the app name
 * comes along with it rather than disappearing from the window.
 */
const modeTitle = (label: string) => `Atlas ${label}`;

/**
 * The two modes, as the current mode plus a menu — the shape Codex and ChatGPT
 * use for the same choice.
 *
 * It was a segmented control, which spent title-bar width on the mode you are
 * not in and had nowhere to say what either one does. A menu shows the active
 * mode as a word, and gives each option a line of prose at the moment of
 * choosing. The names mean something the runtime enforces: Work withholds every
 * writing tool, Code grants them inside one folder. The panel toggle is its own
 * button so a layout preference cannot masquerade as a capability.
 */
export function WorkspaceModeSwitch({
  mode,
  ready,
  disabled,
  variant = 'toolbar',
  onChange,
}: {
  mode: WorkspaceMode;
  /** False when Code is selected with no usable folder — shown, never auto-corrected. */
  ready: boolean;
  disabled?: boolean;
  /**
   * `heading` is the sidebar-header slot, where this control stands in for the
   * wordmark and is therefore set at wordmark size — the same place Codex puts
   * it. `toolbar` is the smaller chip for a row of other controls.
   */
  variant?: 'heading' | 'toolbar';
  onChange: (mode: WorkspaceMode) => void;
}) {
  const active = describeWorkspaceMode(mode);
  const isHeading = variant === 'heading';

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Workspace mode: ${modeTitle(active.label)}. Change mode.`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className={cn(
                'group flex items-center rounded-lg transition-colors',
                'text-text-primary hover:bg-bg-hover data-[state=open]:bg-bg-active',
                'disabled:cursor-not-allowed disabled:opacity-50',
                // Heading sits in a resizable sidebar, so it truncates rather
                // than pushing the collapse toggle off the edge.
                isHeading
                  ? 'h-8 min-w-0 gap-1.5 px-2 text-lg font-bold leading-none'
                  : 'h-7 shrink-0 gap-1 px-2 text-sm font-medium'
              )}
            >
              <span className="truncate">{modeTitle(active.label)}</span>
              {!ready ? (
                <AlertTriangle
                  className={cn('text-warning-text', isHeading ? 'size-4' : 'size-3.5')}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              ) : null}
              <ChevronDown
                className={cn(
                  'shrink-0 text-text-tertiary transition-transform group-data-[state=open]:rotate-180',
                  isHeading ? 'size-4' : 'size-3.5'
                )}
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{ready ? active.hint : UNREADY_HINT}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="min-w-[240px] border-border-default bg-bg-overlay p-1.5"
      >
        {WORKSPACE_MODES.map((entry) => {
          const isActive = entry.value === mode;
          // Only the *selected* mode can be unready — the alternative has not
          // been asked to run yet, so flagging it here would be a warning about
          // a state nobody is in.
          const isUnready = isActive && !ready;

          return (
            <DropdownMenuItem
              key={entry.value}
              onSelect={() => onChange(entry.value)}
              // The check is the selection marker; the row does not also need
              // an active background, which read as a hover on the wrong item.
              className="items-start gap-3 rounded-md px-3 py-2"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                  {modeTitle(entry.label)}
                  {isUnready ? (
                    <AlertTriangle className="size-3 text-warning-text" strokeWidth={2} aria-hidden="true" />
                  ) : null}
                </span>
                <span className="text-2xs leading-4 text-text-tertiary">
                  {isUnready ? UNREADY_HINT : entry.tagline}
                </span>
              </span>
              {isActive ? <Check className="mt-0.5 size-4 shrink-0 text-text-secondary" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Panel visibility, finally its own control rather than a mode. */
export function WorkbenchToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Toggle workbench panel"
          aria-pressed={open}
          onClick={() => onToggle(!open)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            'flex size-7 items-center justify-center rounded-md transition-colors',
            open ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          )}
        >
          <PanelRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{open ? 'Hide workbench' : 'Show workbench'}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The bottom dock's visibility, beside the workbench's own toggle.
 *
 * Two separate buttons rather than one panel menu: the terminal and the
 * workbench occupy different edges of the window and are routinely wanted
 * one without the other.
 */
export function TerminalToggle({
  open,
  onToggle,
  shortcutLabel,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  shortcutLabel?: string | null;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Toggle terminal"
          aria-pressed={open}
          onClick={() => onToggle(!open)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            'flex size-7 items-center justify-center rounded-md transition-colors',
            open ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          )}
        >
          <PanelBottom className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {open ? 'Hide terminal' : 'Show terminal'}
        {shortcutLabel ? ` · ${shortcutLabel}` : ''}
      </TooltipContent>
    </Tooltip>
  );
}
