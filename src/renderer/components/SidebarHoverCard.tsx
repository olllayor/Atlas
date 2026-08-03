import { Folder, GitBranch, MessageSquare, Settings2 } from 'lucide-react';

import type { WorkspaceProject } from '../../shared/contracts';
import { cn } from '../lib/utils';
import { formatHomeRelativePath } from './sidebarViewModel';
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
};

export function SidebarProjectHoverCard({ project, chatCount, onEdit }: ProjectHoverCardProps) {
  return (
    <HoverCardContent side="right" align="start" sideOffset={10} className={CARD_CLASS}>
      <div className="px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <Folder className="size-4 shrink-0 text-text-tertiary" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-md font-medium text-text-primary">
            {project.title}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-sm text-text-secondary">
          <MessageSquare className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
          <span>{chatCount === 1 ? '1 chat' : `${chatCount} chats`}</span>
        </div>
      </div>

      <div className="border-t border-border-subtle">
        {/* The full path is the tooltip: the card is 256px and roots are not. */}
        <div className={ROW_CLASS} title={project.root}>
          <Folder className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{formatHomeRelativePath(project.root)}</span>
        </div>

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
};

export function SidebarConversationHoverCard({
  title,
  timestampLabel,
  project,
  isRunning,
  isFailed,
}: ConversationHoverCardProps) {
  return (
    <HoverCardContent side="right" align="start" sideOffset={10} className={CARD_CLASS}>
      <div className="flex items-start gap-2 px-3 pb-1.5 pt-2.5">
        {/* Two lines, then ellipsis: the row truncates at one, and the whole
            point of the card is to show more of the title than the row can. */}
        <span className="line-clamp-2 min-w-0 flex-1 text-md font-medium text-text-primary">
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

        {isRunning ? (
          <div className={cn(ROW_CLASS, 'py-1 text-text-tertiary')}>Working…</div>
        ) : isFailed ? (
          <div className={cn(ROW_CLASS, 'py-1 text-error-text')}>Last turn failed</div>
        ) : null}
      </div>
    </HoverCardContent>
  );
}
