import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderPlus,
  PanelBottom,
  PanelRight,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';

import type { ToolPermissionMode } from '../../../shared/chatParameters';
import { TOOL_PERMISSION_MODES, describeToolPermissionMode } from '../../../shared/chatParameters';
import { WORKSPACE_MODES, describeWorkspaceMode } from '../../../shared/workspaceModes';
import type { WorkspaceMode } from '../../../shared/workspaceModes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '../../lib/utils';
import { UNREADY_HINT, describeAccessState, modeTitle } from './workspaceAccessViewModel';

const ACCESS_ICONS: Record<ToolPermissionMode, typeof ShieldCheck> = {
  'read-only': ShieldCheck,
  ask: ShieldQuestion,
  'full-access': ShieldAlert,
};

type AccessMenuProps = {
  mode: WorkspaceMode;
  ready: boolean;
  permissionMode?: ToolPermissionMode;
  /** Streaming or a tool-less model: the ladder rows grey out, the modes stay live. */
  permissionDisabled?: boolean;
  /** The composer chip is the access door, not the mode door — it skips the
      mode rows (and the folder row, which belongs to them) entirely. */
  hideModes?: boolean;
  onModeChange: (mode: WorkspaceMode) => void;
  onPermissionModeChange?: (mode: ToolPermissionMode) => void;
  /** When Code is selected but unready, renders a "Choose project folder…" row. */
  onRequestProject?: () => void;
};

/**
 * The menu the sidebar heading opens: what the agent is (mode), then what it
 * may do (access), the way Codex's /approvals folds approval policy and
 * sandbox scope into one list. The composer chip reuses it with `hideModes`,
 * so the ladder can never drift apart between the two doors.
 *
 * Two selection idioms sit in it — a right check on the mode rows, Radix's left
 * dot on the ladder — because both are already the app's, and the label plus
 * separator read the change as a new section rather than an inconsistency.
 */
function AccessMenuContent({
  mode,
  ready,
  permissionMode,
  permissionDisabled,
  hideModes,
  onModeChange,
  onPermissionModeChange,
  onRequestProject,
}: AccessMenuProps) {
  return (
    <>
      {!hideModes ? (
        <>
          {WORKSPACE_MODES.map((entry) => {
        const isActive = entry.value === mode;
        // Only the *selected* mode can be unready — the alternative has not
        // been asked to run yet, so flagging it here would be a warning about
        // a state nobody is in.
        const isUnready = isActive && !ready;

        return (
          <DropdownMenuItem
            key={entry.value}
            onSelect={() => onModeChange(entry.value)}
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
        </>
      ) : null}

      {/* Sits with the modes rather than the ladder: a folder is what the
          selected mode is missing, not another rung of access. It appears only
          in the state the rows above are already complaining about. */}
      {!hideModes && !ready && onRequestProject ? (
        <>
          <DropdownMenuSeparator className="my-1 bg-border-default" />
          <DropdownMenuItem
            onSelect={onRequestProject}
            className="items-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary"
          >
            <FolderPlus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            Choose project folder…
          </DropdownMenuItem>
        </>
      ) : null}

      {/* Half a ladder is worse than none: without a handler the rows would
          look live and change nothing, so the whole section stays away. */}
      {permissionMode && onPermissionModeChange ? (
        <>
          {!hideModes ? <DropdownMenuSeparator className="my-1.5 bg-border-subtle" /> : null}
          {/* Visual only — Radix does not associate a label with the group, so
              the group carries its own `aria-label` as well. */}
          <DropdownMenuLabel className="px-3 pb-0.5 pt-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
            Agent access
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-label="Agent access"
            value={permissionMode}
            onValueChange={(value) => onPermissionModeChange(value as ToolPermissionMode)}
          >
            {TOOL_PERMISSION_MODES.map((entry) => (
              <DropdownMenuRadioItem
                key={entry.value}
                value={entry.value}
                disabled={permissionDisabled}
                className="items-start rounded-md py-2 pr-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={cn(
                      'text-sm leading-5',
                      entry.risk === 'high' ? 'text-warning-text' : 'text-text-primary'
                    )}
                  >
                    {entry.label}
                  </span>
                  <span className="text-2xs leading-4 text-text-tertiary">{entry.hint}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </>
      ) : null}
    </>
  );
}

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
  permissionMode,
  permissionDisabled,
  onPermissionModeChange,
  onRequestProject,
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
  /** When present, the menu grows the "Agent access" section. Optional so a bare mode switch stays expressible. */
  permissionMode?: ToolPermissionMode;
  permissionDisabled?: boolean;
  onPermissionModeChange?: (mode: ToolPermissionMode) => void;
  /** When Code is selected but unready, renders a "Choose project folder…" row. */
  onRequestProject?: () => void;
}) {
  const isHeading = variant === 'heading';
  const state = describeAccessState({ mode, permissionMode: permissionMode ?? 'ask', ready });

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={state.headingAriaLabel}
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
              <span className="truncate">{modeTitle(describeWorkspaceMode(mode).label)}</span>
              {state.showUnreadyWarning ? (
                <AlertTriangle
                  className={cn('text-warning-text', isHeading ? 'size-4' : 'size-3.5')}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              ) : null}
              {/*
                Only full access earns a standing mark: `ask` is the default and
                `read-only` is safe, so a glyph on either would be a badge for
                being ordinary. It can sit beside the unready triangle — the two
                say different things.
              */}
              {state.showFullAccessWarning ? (
                <ShieldAlert
                  className={cn('shrink-0 text-warning-text', isHeading ? 'size-4' : 'size-3.5')}
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
        <TooltipContent side="bottom">{state.tooltip}</TooltipContent>
      </Tooltip>

      {/* 260px, not 240: the ladder rows carry a sentence each. */}
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="min-w-[260px] border-border-default bg-bg-overlay p-1.5"
      >
        <AccessMenuContent
          mode={mode}
          ready={ready}
          permissionMode={permissionMode}
          permissionDisabled={permissionDisabled}
          onModeChange={onChange}
          onPermissionModeChange={onPermissionModeChange}
          onRequestProject={onRequestProject}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The composer's door into the access ladder.
 *
 * Access-only by design: the mode lives in the sidebar heading, and the
 * composer is where the consequence lands, so this chip answers "what may it
 * do on this send" and nothing else. Codex echoes the approval policy below
 * its chat input for the same reason.
 */
export function WorkspaceAccessChip({
  mode,
  ready,
  permissionMode,
  disabled,
  permissionDisabled,
  onModeChange,
  onPermissionModeChange,
  onRequestProject,
}: {
  mode: WorkspaceMode;
  ready: boolean;
  permissionMode: ToolPermissionMode;
  disabled?: boolean;
  permissionDisabled?: boolean;
  onModeChange: (mode: WorkspaceMode) => void;
  onPermissionModeChange: (mode: ToolPermissionMode) => void;
  /** Unused here (the mode rows are hidden) — kept so both doors share one prop shape. */
  onRequestProject?: () => void;
}) {
  const state = describeAccessState({ mode, permissionMode, ready });
  const access = describeToolPermissionMode(permissionMode);
  const title = modeTitle(describeWorkspaceMode(mode).label);
  const Icon = ACCESS_ICONS[permissionMode] ?? ShieldQuestion;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label={state.chipAriaLabel}
              // `group` so the chevron can react to the open state Radix stamps
              // on the button (the SVG itself never gets `data-state`).
              className={cn(
                'group flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-normal outline-none transition',
                'focus-visible:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-bg-hover',
                state.showFullAccessWarning
                  ? 'text-warning-text hover:bg-bg-hover'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {/* Below ~26rem of composer width the pill drops to its shield
                  glyph so the model chip and send button keep their room. */}
              <span className="hidden min-w-0 truncate @min-[26rem]:inline">{access.label}</span>
              {/* No chevron here, unlike the sidebar heading: the composer row
                  already carries a shield glyph naming the same menu, and a
                  second affordance on a coloured warning label reads as two
                  controls. */}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {title} · <span className="text-text-secondary">{access.label}</span>
        </TooltipContent>
      </Tooltip>

      {/*
        Radix portals the content to the body, which matters here: the composer
        shell is `overflow-hidden`, so a plain absolutely-positioned panel gets
        clipped by its own container.
      */}
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="min-w-[260px] border-border-default bg-bg-overlay p-1.5"
      >
        <AccessMenuContent
          mode={mode}
          ready={ready}
          permissionMode={permissionMode}
          permissionDisabled={permissionDisabled}
          hideModes
          onModeChange={onModeChange}
          onPermissionModeChange={onPermissionModeChange}
          onRequestProject={onRequestProject}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Panel visibility, finally its own control rather than a mode. */
export function WorkbenchToggle({
  open,
  onToggle,
  /** Live subagents (running/waiting). Forced to 0 while Agents surface visible. */
  liveAgentCount = 0,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  liveAgentCount?: number;
}) {
  const showBadge = liveAgentCount > 0;
  const label = showBadge
    ? `${liveAgentCount} agent${liveAgentCount === 1 ? '' : 's'} working`
    : 'Toggle workbench panel';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={open}
          title={showBadge ? label : undefined}
          onClick={() => onToggle(!open)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            'relative flex size-7 items-center justify-center rounded-md transition-colors',
            open ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          )}
        >
          <PanelRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {showBadge ? (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bg-elevated px-1 text-[10px] tabular-nums text-text-primary"
            >
              {liveAgentCount}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {showBadge ? label : open ? 'Hide workbench' : 'Show workbench'}
      </TooltipContent>
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
