import { AlertTriangle, PanelRight } from 'lucide-react';

import type { WorkspaceMode } from '../../../shared/contracts';
import { WORKSPACE_MODES } from '../../../shared/workspaceModes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '../../lib/utils';

/**
 * The two modes, as a segmented control in the title bar.
 *
 * This replaced a Chat/Work pair that only toggled a side panel. The names now
 * mean something the runtime enforces: Work withholds every writing tool, Code
 * grants them inside one folder. The panel toggle moved out to its own button
 * so a layout preference can no longer masquerade as a capability.
 */
export function WorkspaceModeSwitch({
  mode,
  ready,
  disabled,
  onChange,
}: {
  mode: WorkspaceMode;
  /** False when Code is selected with no usable folder — shown, never auto-corrected. */
  ready: boolean;
  disabled?: boolean;
  onChange: (mode: WorkspaceMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Workspace mode"
      className="flex shrink-0 items-center rounded-full border border-border-default p-0.5"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {WORKSPACE_MODES.map((entry) => {
        const isActive = entry.value === mode;
        const isUnready = isActive && !ready;

        return (
          <Tooltip key={entry.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={disabled}
                onClick={() => onChange(entry.value)}
                className={cn(
                  'flex h-6 min-w-15 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-normal transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  isActive
                    ? 'bg-bg-active text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                {entry.label}
                {isUnready ? (
                  <AlertTriangle className="size-3 text-warning-text" strokeWidth={2} aria-hidden="true" />
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isUnready ? 'Code mode needs a project folder — choose one to enable editing.' : entry.hint}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
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
