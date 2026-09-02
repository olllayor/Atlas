import {
  AlertCircle,
  Cpu,
  FileDiff,
  Folder,
  GitBranch,
  MessageSquare,
  Pin,
  PinOff,
  Settings2,
} from 'lucide-react';

import type {
  ConversationChangeStats,
  WorkspaceMode,
  WorkspaceProject,
} from '../../shared/contracts';
import type { AttentionLevel } from '../lib/attention';
import { describeWorkspaceMode } from '../../shared/workspaceModes';
import { cn } from '../lib/utils';
import { formatConversationChangeStats, formatHomeRelativePath } from './sidebarViewModel';
import { HoverCardContent } from './ui/hover-card';

/**
 * Sidebar hover previews, per the Codex reference: a row says one line, and
 * pointing at it explains that line without a click, a navigation or a layout
 * shift in the list itself.
 *
 * Both cards are *read* surfaces with at most one action at the bottom — the
 * mutating verbs stay in the row's context menu and its hover icons, so a card
 * that opens by accident can never do anything by accident.
 */

/** Shared geometry: 15px title row, 13px metadata rows, hairline dividers. */
const CARD_CLASS = 'w-64 overflow-hidden p-0';
const ROW_CLASS = 'flex items-center gap-2 px-3 py-2 text-sm text-text-secondary';
const ICON_CLASS = 'size-3.5 shrink-0 text-text-tertiary';

type ProjectHoverCardProps = {
  project: WorkspaceProject;
  /** Chats filed under the project, including the ones behind "Show more". */
  chatCount: number;
  /** Opens the inline rename; omitted when the sidebar has no rename wiring. */
  onEdit?: () => void;
  /**
   * Reveals the root in the file manager. Optional like `onEdit`: without it
   * the path stays the label it always was rather than a button that no-ops.
   */
  onReveal?: () => void;
  /** Floats the project to the top of the list. Renders the header's pin. */
  onTogglePin?: () => void;
};

export function SidebarProjectHoverCard({
  project,
  chatCount,
  onEdit,
  onReveal,
  onTogglePin,
}: ProjectHoverCardProps) {
  const isPinned = Boolean(project.pinnedAt);
  // The full path is the tooltip in both states: the card is 256px and roots
  // are not. When the folder has moved, the tooltip says so — the row is
  // disabled and a disabled control that only reads "~/Code/Atlas" gives no
  // reason for being dead.
  const pathTitle = project.exists ? project.root : `Folder is missing — ${project.root}`;
  const pathLabel = formatHomeRelativePath(project.root);

  return (
    <HoverCardContent side="right" align="start" sideOffset={10} className={CARD_CLASS}>
      <div className="px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <Folder className="size-4 shrink-0 text-text-tertiary" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-md font-medium text-text-primary">
            {project.title}
          </span>
          {/* The one mutating control the reference card carries, and the only
              one here that is instantly reversible by clicking it again. */}
          {onTogglePin ? (
            <button
              type="button"
              onClick={onTogglePin}
              aria-pressed={isPinned}
              aria-label={isPinned ? 'Unpin project' : 'Pin project'}
              title={isPinned ? 'Unpin project' : 'Pin project'}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-hover hover:text-text-primary',
                isPinned ? 'text-text-primary' : 'text-text-faint'
              )}
            >
              {isPinned ? (
                <PinOff className="size-3.5" strokeWidth={1.75} aria-hidden />
              ) : (
                <Pin className="size-3.5" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-sm text-text-secondary">
          <MessageSquare className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
          <span>{chatCount === 1 ? '1 chat' : `${chatCount} chats`}</span>
        </div>
      </div>

      <div className="border-t border-border-subtle">
        {/* The rows in the reference card are targets, not labels — the path is
            the one line here you would actually want to act on, so it reveals
            the folder rather than sitting there being read. */}
        {onReveal ? (
          <button
            type="button"
            onClick={onReveal}
            disabled={!project.exists}
            title={pathTitle}
            className={cn(
              ROW_CLASS,
              'w-full text-left transition-colors hover:bg-bg-hover hover:text-text-primary',
              !project.exists && 'cursor-default hover:bg-transparent hover:text-text-secondary'
            )}
          >
            <Folder className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{pathLabel}</span>
          </button>
        ) : (
          <div className={ROW_CLASS} title={pathTitle}>
            <Folder className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{pathLabel}</span>
          </div>
        )}

        {project.branch ? (
          <div className={ROW_CLASS}>
            <GitBranch className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{project.branch}</span>
          </div>
        ) : null}

        {/* A folder that has moved is the one thing a preview must not hide. */}
        {!project.exists ? (
          <div className="flex items-center gap-2 px-3 pb-2 text-sm text-warning-text">
            Folder is missing
          </div>
        ) : null}
      </div>

      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <Settings2 className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
          Edit project
        </button>
      ) : null}
    </HoverCardContent>
  );
}

type ConversationHoverCardProps = {
  title: string;
  timestampLabel: string | null;
  /** The chat's project, or null when it lives in Recents. */
  project: WorkspaceProject | null;
  isRunning: boolean;
  isFailed: boolean;
  /** What the chat is allowed to do. Null on summaries that predate modes. */
  workspaceMode?: WorkspaceMode | null;
  /**
   * The model's human name, already resolved against the catalog by the
   * caller. Null when the id is unset or the catalog does not know it — the
   * row is dropped rather than showing a title-cased gateway id as a name.
   */
  modelLabel?: string | null;
  /** Raw model id; it names the title's tooltip, never a row of its own. */
  modelId?: string | null;
  /** What the chat did to the working tree. Zeros mean the row stays silent. */
  changeStats?: ConversationChangeStats | null;
  attentionLevel?: AttentionLevel;
};

export function SidebarConversationHoverCard({
  title,
  timestampLabel,
  project,
  isRunning,
  isFailed,
  workspaceMode = null,
  modelLabel = null,
  modelId = null,
  changeStats = null,
  attentionLevel = 'idle',
}: ConversationHoverCardProps) {
  const stats = formatConversationChangeStats(changeStats);
  const modeLabel = workspaceMode ? `${describeWorkspaceMode(workspaceMode).label} mode` : null;
  const needsApproval = attentionLevel === 'needsInput' && !isFailed;

  return (
    <HoverCardContent
      side="right"
      align="start"
      sideOffset={10}
      className="w-72 overflow-hidden rounded-xl border border-border-strong bg-popover/95 p-3.5 shadow-elevated"
    >
      {/*
        Title and time share the header row: the row truncates the title at one
        line, and the whole point of the card is to show more of it than the row
        can. The raw model id hangs off the title as its tooltip — a gateway
        spelling is unreadable in a 288px card but is still the string you want
        when a model misbehaves.
      */}
      <div className="mb-2.5 flex items-start gap-2">
        <div
          className="line-clamp-3 min-w-0 flex-1 text-sm font-medium leading-snug text-text-primary"
          title={modelId ?? undefined}
        >
          {title || 'Untitled chat'}
        </div>
        {timestampLabel ? (
          <span className="shrink-0 pt-0.5 text-xs tabular-nums text-text-faint">
            {timestampLabel}
          </span>
        ) : null}
      </div>

      {/*
        Metadata stack. Every row here is conditional on the fact existing.
        A chat filed under no project has no folder and no branch, and a card
        that fills those slots with plausible defaults ("Atlas", "dev") reads
        as information while being invention — the one thing a read-only
        preview must never do.
      */}
      <div className="flex flex-col gap-1.5 text-xs text-text-secondary">
        {project ? (
          <div className="flex items-center gap-2" title={project.root}>
            <Folder className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{project.title}</span>
          </div>
        ) : null}

        {project?.branch ? (
          <div className="flex items-center gap-2">
            <GitBranch className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{project.branch}</span>
          </div>
        ) : null}

        {isFailed ? (
          <div className="flex items-center gap-2 font-normal text-error-text">
            <AlertCircle className="size-3.5 shrink-0 text-error-text" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Error occurred</span>
          </div>
        ) : null}

        {needsApproval ? (
          <div className="flex items-center gap-2 font-normal text-warning-text">
            <AlertCircle className="size-3.5 shrink-0 text-warning-text" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Waiting for your approval</span>
          </div>
        ) : null}

        {/* `motion-glyph-pulse`, not `animate-pulse`: phase-locked with the
            rest of the app's live marks and reduced-motion aware. */}
        {isRunning ? (
          <div className="flex items-center gap-2 text-text-tertiary">
            <span className="size-1.5 shrink-0 rounded-full bg-accent motion-glyph-pulse" />
            <span className="min-w-0 flex-1 truncate">Working…</span>
          </div>
        ) : null}

        {modelLabel ? (
          <div className="flex items-center gap-2">
            <Cpu className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{modelLabel}</span>
          </div>
        ) : null}

        {/* The mode is near-uniform across a project, so it sits below the
            facts that differ row to row rather than above them. */}
        {modeLabel ? (
          <div className="flex items-center gap-2">
            <Settings2 className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{modeLabel}</span>
          </div>
        ) : null}

        {stats ? (
          <div
            className="mt-1 flex items-center gap-2 border-t border-border-subtle pt-1.5 text-3xs"
            title={stats.detail}
          >
            <FileDiff className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-text-tertiary">{stats.files}</span>
            {stats.added ? (
              <span className="shrink-0 tabular-nums text-success">{stats.added}</span>
            ) : null}
            {stats.removed ? (
              <span className="shrink-0 tabular-nums text-error">{stats.removed}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </HoverCardContent>
  );
}

