import { FileDiff, Folder, GitBranch, MessageSquare, Pin, PinOff, Settings2 } from 'lucide-react';

import type {
  ConversationChangeStats,
  WorkspaceMode,
  WorkspaceProject,
} from '../../shared/contracts';
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
  /** Raw model id; it names the title's tooltip, never a row of its own. */
  modelId?: string | null;
  /** What the chat did to the working tree. Zeros mean the row stays silent. */
  changeStats?: ConversationChangeStats | null;
};

export function SidebarConversationHoverCard({
  title,
  timestampLabel,
  project,
  isRunning,
  isFailed,
  workspaceMode = null,
  modelId = null,
  changeStats = null,
}: ConversationHoverCardProps) {
  const statusLabel = isRunning ? 'Working…' : isFailed ? 'Last turn failed' : null;
  /**
   * Status, diff stats and mode share the fourth and last row, in that order.
   *
   * The reference card never runs past four lines, and title + project + branch
   * already spend three. Status wins the slot because it is the transient fact —
   * it is true for the next few seconds and it is why you are pointing at the
   * row — while the mode is a standing property that is still there to read once
   * the turn ends.
   *
   * The diff stats went in *between* them rather than on a fifth line. They beat
   * the mode for the same reason the mode beat nothing: they are the fact that
   * differs from row to row. Mode is near-uniform across a project — every chat
   * under Atlas says "Code mode", so the row confirms what the section header
   * already implied — whereas the stats are the only line on the card that
   * separates the session that rewrote forty files from the one that answered a
   * question. So the mode now yields whenever the chat touched the filesystem,
   * not only while a turn is running; a chat that changed nothing still shows it.
   *
   * The model never gets a row of its own: the sidebar has no model catalog to
   * resolve a short name from, and the raw ids are gateway spellings
   * (`vendor/deepseek-v4-flash-0325`) that would truncate to nothing legible in
   * a 256px card. It hangs off the title instead of off the mode row, which is
   * the one row here that can disappear — parking it there made the model
   * unreachable on exactly the chats worth asking about.
   */
  const stats = statusLabel ? null : formatConversationChangeStats(changeStats);
  const modeLabel =
    statusLabel || stats || !workspaceMode
      ? null
      : `${describeWorkspaceMode(workspaceMode).label} mode`;

  return (
    <HoverCardContent side="right" align="start" sideOffset={10} className={CARD_CLASS}>
      <div className="flex items-start gap-2 px-3 pb-1.5 pt-2.5">
        {/* Two lines, then ellipsis: the row truncates at one, and the whole
            point of the card is to show more of the title than the row can. */}
        <span
          className="line-clamp-2 min-w-0 flex-1 text-md font-medium text-text-primary"
          title={modelId ?? undefined}
        >
          {title || 'Untitled chat'}
        </span>
        {timestampLabel ? (
          <span className="shrink-0 pt-0.5 text-sm tabular-nums text-text-faint">
            {timestampLabel}
          </span>
        ) : null}
      </div>

      <div className="pb-2">
        {project ? (
          <div className={cn(ROW_CLASS, 'py-1')} title={project.root}>
            <Folder className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{project.title}</span>
          </div>
        ) : null}

        {project?.branch ? (
          <div className={cn(ROW_CLASS, 'py-1')}>
            <GitBranch className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{project.branch}</span>
          </div>
        ) : null}

        {statusLabel ? (
          <div className={cn(ROW_CLASS, 'py-1', isRunning ? 'text-text-tertiary' : 'text-error-text')}>
            {statusLabel}
          </div>
        ) : stats ? (
          // `detail` is the tooltip because the counts are compacted above four
          // digits: `+12.5k` is the readable number, and pointing at it is how
          // you get the exact one back.
          <div className={cn(ROW_CLASS, 'py-1')} title={stats.detail}>
            <FileDiff className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{stats.files}</span>
            {/* Right-aligned and tabular so the counts line up between two
                cards opened one after the other, the way the changed-files bar
                in the transcript already reads. */}
            {stats.added ? (
              <span className="shrink-0 tabular-nums text-success">{stats.added}</span>
            ) : null}
            {stats.removed ? (
              <span className="shrink-0 tabular-nums text-error">{stats.removed}</span>
            ) : null}
          </div>
        ) : modeLabel ? (
          <div className={cn(ROW_CLASS, 'py-1 text-text-tertiary')}>
            {modeLabel}
          </div>
        ) : null}
      </div>
    </HoverCardContent>
  );
}
