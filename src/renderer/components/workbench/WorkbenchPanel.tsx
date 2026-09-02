/**
 * The right-hand workbench — Codex's diff / terminal / task surfaces.
 *
 * Codex backs these with a repository, a PTY and an agent fleet. Atlas binds a
 * repository in Code mode (the attached project) and hosts one PTY per
 * conversation; the task list is still this conversation's tool calls rather
 * than a fleet.
 *
 *   Review   — the repository's diff, by scope, with stage / revert / comment
 *   Git      — branch, working tree, history, and commit
 *   Tasks    — every tool call in the thread with its status
 *
 * The shell is not here: it is docked along the bottom of the window
 * (`TerminalDock`), the way Codex's desktop app places it, so a diff and a
 * running command are readable at the same time.
 *
 * That keeps the Codex silhouette while remaining honest: each panel says
 * plainly what it is showing and what it is not.
 *
 * Presentation follows `docs/codex-parity/reference-visual-spec.md`:
 * §5's IDE changed-files rows and task/status lists, §6's calm feel —
 * borderless rows, hairline separators only, opacity-based hierarchy.
 */

import { useMemo } from 'react';
import { X } from 'lucide-react';

import type { ChatMessage, ChatToolPart, WorkspaceMode } from '../../../shared/contracts';
import {
  type ToolCell,
  type ToolCellKind,
  type ToolCellStatus,
  buildToolCells,
  formatElapsed,
  toolCellStatus,
} from '../../../shared/toolCellGrammar';
import { cn } from '../../lib/utils';
import { GitPanel } from './GitPanel';
import { ReviewPanel } from './ReviewPanel';
import { JobsSection } from './JobsSection';
import { TaskStatusGlyph } from './TaskStatusGlyph';

import { AgentsPanel } from '../agents/AgentsPanel';
import type { WorkLogEntry } from '../../../shared/contracts';
import { foldAgents } from '../../lib/agentFold';
import { useConversationJobs } from '../../hooks/useConversationJobs';
import { activeJobCount } from '../workspace/jobsChipViewModel';
import { StatusDot } from '../ui/status-dot';

export type WorkbenchTab = 'review' | 'git' | 'tasks' | 'agents';

/**
 * `modes` decides where a tab is worth showing. Work mode cannot produce a diff
 * or touch a repository, so offering Review and Git there would be tabs where
 * only one can ever have content.
 */
export const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string; modes: WorkspaceMode[] }> = [
  { id: 'review', label: 'Review', modes: ['code'] },
  { id: 'git', label: 'Git', modes: ['code'] },
  { id: 'tasks', label: 'Tasks', modes: ['work', 'code'] },
  { id: 'agents', label: 'Agents', modes: ['work', 'code'] },
];

export function workbenchTabsForMode(mode: WorkspaceMode) {
  return WORKBENCH_TABS.filter((tab) => tab.modes.includes(mode));
}

export type WorkbenchPanelProps = {
  conversationId?: string;
  mode: WorkspaceMode;
  messages: ChatMessage[];
  activities?: WorkLogEntry[];
  activeTab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  onClose: () => void;
  /** Where the review pane's line comments go when the user sends them. */
  onSendComments?: (text: string) => void;
  onOpenOutputFile?: (filePath: string) => void;
};

/** Every tool part in the thread, in order. */
function collectToolParts(messages: ChatMessage[]): ChatToolPart[] {
  const parts: ChatToolPart[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool') parts.push(part);
    }
  }
  return parts;
}

export function WorkbenchPanel({
  conversationId,
  mode,
  messages,
  activities = [],
  activeTab,
  onTabChange,
  onClose,
  onSendComments,
  onOpenOutputFile,
}: WorkbenchPanelProps) {
  const toolParts = useMemo(() => collectToolParts(messages), [messages]);
  // The roster is folded once per activity change, not once per render: it
  // walks every persisted row in the conversation.
  const agentCount = useMemo(() => foldAgents(activities).agents.length, [activities]);
  // Agents is a conditional tab: a conversation that never spawned one has no
  // roster to open, and an empty tab in the strip reads as a missing feature.
  const tabs = useMemo(
    () => workbenchTabsForMode(mode).filter((tab) => tab.id !== 'agents' || agentCount > 0),
    [mode, agentCount]
  );
  // Switching a conversation to Work with Review open would otherwise leave a
  // selected tab that is no longer in the bar.
  const visibleTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? 'tasks');

  // Background jobs power the Tasks tab's pulse: live work should read as
  // alive from the tab strip, not only after opening the tab.
  const { jobs } = useConversationJobs(conversationId);
  const liveJobs = activeJobCount(jobs);
  const runningTools = useMemo(
    () =>
      toolParts.some((part) => {
        const status = toolCellStatus(part.state);
        return status === 'running' || status === 'awaiting-approval';
      }),
    [toolParts]
  );
  const tasksLive = runningTools || liveJobs > 0;
  const hasJobs = jobs.length > 0;

  // Only Tasks and Agents carry counts.
  const counts: Record<WorkbenchTab, number> = {
    review: 0,
    git: 0,
    tasks: toolParts.length,
    agents: agentCount,
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg-base">
      {/* Plain text tabs — active is text-primary, inactive text-tertiary,
          no pill, no border under the bar (spec §6: no dividers). Arrow keys
          move between tabs per the tablist contract; only the active tab is
          in the tab order. */}
      <div className="flex h-titlebar-height shrink-0 items-center gap-1 px-3">
        <div
          role="tablist"
          aria-label="Workbench"
          className="flex min-w-0 flex-1 items-center gap-4 px-1"
          onKeyDown={(event) => {
            if (
              event.key !== 'ArrowLeft' &&
              event.key !== 'ArrowRight' &&
              event.key !== 'Home' &&
              event.key !== 'End'
            ) {
              return;
            }
            event.preventDefault();
            const index = tabs.findIndex((tab) => tab.id === visibleTab);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : (index - 1 + tabs.length) % tabs.length;
            const nextTab = tabs[next];
            if (!nextTab) return;
            onTabChange(nextTab.id);
            document.getElementById(`workbench-tab-${nextTab.id}`)?.focus();
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === visibleTab;
            const count = counts[tab.id];
            const live = tab.id === 'tasks' && tasksLive;

            return (
              <button
                key={tab.id}
                id={`workbench-tab-${tab.id}`}
                role="tab"
                type="button"
                aria-selected={isActive}
                aria-controls="workbench-panel"
                tabIndex={isActive ? 0 : -1}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 py-1.5 text-sm transition-colors',
                  isActive ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                {live ? <StatusDot tone="running" label="Tasks running" /> : null}
                <span>{tab.label}</span>
                {count > 0 && <span className="tabular-nums text-text-faint">{count}</span>}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close workbench"
          className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/*
        Review owns its own scroller: the scope selector and the diff-wide
        actions have to stay put while a long patch scrolls under them.
      */}
      <div
        className={cn(
          'min-h-0 flex-1',
          visibleTab === 'review' || visibleTab === 'agents' ? 'overflow-hidden' : 'overflow-y-auto scrollbar-auto-hide'
        )}
        role="tabpanel"
        id="workbench-panel"
        aria-labelledby={`workbench-tab-${visibleTab}`}
        tabIndex={0}
      >
        {visibleTab === 'review' && (
          <ReviewPanel conversationId={conversationId} onSendComments={onSendComments} />
        )}
        {visibleTab === 'git' && <GitPanel conversationId={conversationId} />}
        {visibleTab === 'tasks' && (
          <TasksTab parts={toolParts} hasJobs={hasJobs} conversationId={conversationId} />
        )}
        {visibleTab === 'agents' && (
          <AgentsPanel
            conversationId={conversationId}
            activities={activities}
            onOpenOutputFile={onOpenOutputFile}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-base text-text-secondary">{title}</p>
      <p className="max-w-[36ch] text-sm leading-relaxed text-text-faint">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks — the scheduled-tasks status-list pattern (spec §5, shot 6):
// dim 13px section headers, then rows of status glyph + name + dim
// tool-type label + right-aligned dim status text. Borderless, ~40px rows.
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<ToolCellKind, string> = {
  command: 'Command',
  explore: 'Explore',
  edit: 'Edit',
  web: 'Web',
  mcp: 'MCP',
  image: 'Image',
  generic: 'Tool',
};

function taskStatusText(cell: ToolCell): { text: string; className: string } {
  if (cell.status === 'running') return { text: 'In progress', className: 'text-text-faint' };
  if (cell.status === 'pending') return { text: 'Queued', className: 'text-text-faint' };
  if (cell.status === 'awaiting-approval') return { text: 'Needs approval', className: 'text-warning' };
  if (cell.status === 'failed') return { text: 'Failed', className: 'text-error' };

  const duration =
    cell.durationMs != null && cell.durationMs >= 1000 ? formatElapsed(cell.durationMs) : null;
  return { text: duration ?? 'Done', className: 'text-text-faint' };
}

function TaskRow({ cell }: { cell: ToolCell }) {
  const name = cell.subject.trim() || cell.verb;
  const status = taskStatusText(cell);

  return (
    <li className="flex min-h-10 items-center gap-2.5">
      <TaskStatusGlyph status={cell.status} className="shrink-0" />
      <span className="min-w-0 truncate text-base text-text-primary" title={name}>
        {name}
      </span>
      <span className="shrink-0 text-sm text-text-faint">{KIND_LABEL[cell.kind]}</span>
      <span className={cn('ml-auto shrink-0 pl-3 tabular-nums text-sm', status.className)}>
        {status.text}
      </span>
    </li>
  );
}

function TasksTab({
  parts,
  hasJobs,
  conversationId,
}: {
  parts: ChatToolPart[];
  hasJobs: boolean;
  conversationId?: string;
}) {
  const cells = useMemo(() => buildToolCells(parts), [parts]);

  if (!cells.length && !hasJobs) {
    return (
      <EmptyState
        title="No agent actions yet"
        body="Every tool call in this conversation is listed here with its status. Atlas runs one conversation at a time, so this is a single task list rather than a parallel-agent queue."
      />
    );
  }

  const sections: Array<{ title: string; items: ToolCell[] }> = [
    {
      title: 'In progress',
      items: cells.filter(
        (cell) => cell.status === 'running' || cell.status === 'awaiting-approval'
      ),
    },
    { title: 'Queued', items: cells.filter((cell) => cell.status === 'pending') },
    {
      title: 'Done',
      items: cells.filter((cell) => cell.status === 'success' || cell.status === 'failed'),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="px-4 py-2">
      <JobsSection conversationId={conversationId} />
      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="pb-1 pt-3 text-sm font-normal text-text-tertiary">{section.title}</h3>
          <ul>
            {section.items.map((cell) => (
              <TaskRow key={cell.id} cell={cell} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Exposed so the shell can decide whether the workbench is worth opening. */
export function workbenchHasContent(messages: ChatMessage[]) {
  const parts = collectToolParts(messages);
  return parts.length > 0 && parts.some((part) => toolCellStatus(part.state) !== 'pending');
}
