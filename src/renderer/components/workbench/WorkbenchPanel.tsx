/**
 * The right-hand workbench.
 *
 * The panel holds an ordered list of surfaces rather than a fixed tab bar:
 * the user opens what they want from the picker, closes what they are done
 * with, and the strip shows what is open. `rightPanelModel.ts` owns that
 * model; this file draws it and routes each surface to its panel.
 *
 *   Diff     — the repository's diff, by scope, with stage / revert / comment
 *   Git      — branch, working tree, history, and commit
 *   Tasks    — every tool call in the thread with its status
 *   Agents   — the subagent roster
 *   Terminal — one shell, or several split beside each other
 *   Files    — the workspace tree, and a box that searches it
 *   File     — one file, read-only, opened from the tree
 *   Browser  — a Chromium guest, for the dev server the agent just started
 *
 * The bottom dock still owns the conversation's primary shell (`term-1`), the
 * one the agent echoes into. Terminal surfaces are the others: they open
 * beside a diff rather than under it, and closing the tab kills the shell.
 *
 * Presentation follows `docs/codex-parity/reference-visual-spec.md`:
 * §5's IDE changed-files rows and task/status lists, §6's calm feel —
 * borderless rows, hairline separators only, opacity-based hierarchy.
 */

import { Suspense, lazy, useMemo } from 'react';

import type { ChatMessage, ChatToolPart, WorkspaceMode } from '../../../shared/contracts';
import {
  type ToolCell,
  type ToolCellKind,
  buildToolCells,
  formatElapsed,
  toolCellStatus,
} from '../../../shared/toolCellGrammar';
import { displayBrowserUrl } from '../../../shared/browser';
import { PRIMARY_TERMINAL_ID, nextTerminalId, terminalLabelFromId } from '../../../shared/terminalIds';
import { cn } from '../../lib/utils';
import { useConversationTerminals } from '../../hooks/useConversationTerminals';
import { useBrowserStore } from '../../stores/useBrowserStore';
import {
  terminalGroupKey,
  useTerminalSplitStore,
} from '../../stores/useTerminalSplitStore';
import { useConversationPanel, useRightPanelStore } from '../../stores/useRightPanelStore';
import { GitPanel } from './GitPanel';
import { ReviewPanel } from './ReviewPanel';
import { JobsSection } from './JobsSection';
import { TaskStatusGlyph } from './TaskStatusGlyph';
import { ToolActivityIconView } from '../transcript/ToolActivityIconView';
import { BrowserSurface } from './BrowserSurface';
import { FilesPanel } from './FilesPanel';
import { FileViewerPanel } from './FileViewerPanel';
import { fileSurfaceLabel } from './fileTreeModel';
import { SurfacePicker } from './SurfacePicker';
import { SurfaceTabStrip } from './SurfaceTabStrip';
const TerminalSurface = lazy(() => import('./TerminalSurface').then((module) => ({ default: module.TerminalSurface })));
import {
  type RightPanelKind,
  type RightPanelSurface,
  type SurfaceId,
  nextOrdinalResourceId,
  surfaceResourceId,
} from './rightPanelModel';
import type { SurfaceContext } from './surfaceRegistry';
import { terminalLabel } from './terminalsModel';

import { AgentsPanel } from '../agents/AgentsPanel';
import type { WorkLogEntry } from '../../../shared/contracts';
import { foldAgents } from '../../lib/agentFold';
import { useConversationJobs } from '../../hooks/useConversationJobs';
import { activeJobCount } from '../workspace/jobsChipViewModel';

export type WorkbenchPanelProps = {
  conversationId?: string;
  mode: WorkspaceMode;
  /** A project folder is attached to this conversation and exists on disk. */
  hasProject: boolean;
  messages: ChatMessage[];
  activities?: WorkLogEntry[];
  /** Where the review pane's line comments go when the user sends them. */
  onSendComments?: (text: string) => void;
  /** ⌘E in a terminal surface: pipe the selection into the composer. */
  onAddSelectionToPrompt?: (text: string) => void;
  onOpenOutputFile?: (filePath: string) => void;
};

/**
 * Browser view state is keyed by conversation *and* view, so `view-1` in one
 * conversation is not the same page as `view-1` in another.
 */
function browserViewKey(conversationId: string, viewId: string): string {
  return `${conversationId}:${viewId}`;
}

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
  hasProject,
  messages,
  activities = [],
  onSendComments,
  onAddSelectionToPrompt,
  onOpenOutputFile,
}: WorkbenchPanelProps) {
  const toolParts = useMemo(() => collectToolParts(messages), [messages]);
  // The roster is folded once per activity change, not once per render: it
  // walks every persisted row in the conversation.
  const agentModel = useMemo(() => foldAgents(activities), [activities]);
  const agentCount = agentModel.agents.length;
  const liveAgentCount = agentModel.activeAgents.length;

  const panel = useConversationPanel(conversationId);
  // Selected one at a time: zustand builds these once, so each is a stable
  // reference and none of them re-render the panel when the store changes.
  const openSurface = useRightPanelStore((state) => state.openSurface);
  const activateSurface = useRightPanelStore((state) => state.activateSurface);
  const closeSurface = useRightPanelStore((state) => state.closeSurface);
  const closeOtherSurfaces = useRightPanelStore((state) => state.closeOtherSurfaces);
  const closeSurfacesToRight = useRightPanelStore((state) => state.closeSurfacesToRight);
  const closeAllSurfaces = useRightPanelStore((state) => state.closeAllSurfaces);
  const hidePanel = useRightPanelStore((state) => state.hidePanel);
  // Read for the tab labels: a browser tab is named by the page it is showing.
  const browserViews = useBrowserStore((state) => state.byViewId);
  const forgetBrowserView = useBrowserStore((state) => state.forget);
  // A terminal tab can hold several shells, so both the tab's name and the
  // next free id depend on how its panes are arranged.
  const paneGroups = useTerminalSplitStore((state) => state.byGroupKey);
  const forgetPaneGroup = useTerminalSplitStore((state) => state.forget);

  const context: SurfaceContext = { conversationId, mode, hasProject, agentCount, liveAgentCount };

  // Background jobs power the Tasks tab's pulse: live work should read as
  // alive from the tab strip, not only after opening the tab.
  const { jobs } = useConversationJobs(conversationId);
  const runningTools = useMemo(
    () =>
      toolParts.some((part) => {
        const status = toolCellStatus(part.state);
        return status === 'running' || status === 'awaiting-approval';
      }),
    [toolParts]
  );
  // Subscribing here is also what pays for the label probe in main, so it
  // happens once for the whole panel rather than once per terminal surface.
  const terminals = useConversationTerminals(conversationId);
  const liveKinds = useMemo(() => {
    const live = new Set<RightPanelKind>();
    if (runningTools || activeJobCount(jobs) > 0) live.add('tasks');
    if (terminals.some((terminal) => terminal.hasRunningSubprocess)) live.add('terminal');
    return live;
  }, [runningTools, jobs, terminals]);

  // Without a conversation there is nothing to key surfaces by, so the panel
  // says so rather than opening a picker whose every card is disabled.
  if (!conversationId) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-bg-base">
        <EmptyState
          title="No conversation open"
          body="The right panel follows a conversation. Open or start one to review its diff, its tasks, and its agents."
        />
      </div>
    );
  }

  const active = panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId);

  /**
   * Terminal is the one kind the picker cannot open by name: every click is a
   * *new* shell, so the id is allocated against both the tabs already open and
   * the shells already running — including the dock's `term-1`, which has no
   * tab of its own to collide with.
   */
  /**
   * Every shell id this conversation is already using: the ones main knows
   * about, the dock's primary, and every pane of every open terminal tab —
   * including panes whose shell has not been spawned yet, which is the case
   * for a split restored from a previous session.
   */
  const takenTerminalIds = () => {
    const taken = new Set<string>([PRIMARY_TERMINAL_ID]);
    for (const terminal of terminals) taken.add(terminal.terminalId);
    for (const surface of panel.surfaces) {
      if (surface.kind !== 'terminal') continue;
      const rootId = surfaceResourceId(surface);
      if (!rootId) continue;
      taken.add(rootId);
      for (const paneId of paneGroups[terminalGroupKey(conversationId, rootId)]?.terminalIds ?? []) {
        taken.add(paneId);
      }
    }
    return [...taken];
  };

  const openKind = (kind: RightPanelKind) => {
    if (kind === 'browser') {
      // Each browser tab owns its own guest, so a new tab is a new id rather
      // than a second view of the page already open.
      const open = panel.surfaces
        .filter((surface) => surface.kind === 'browser')
        .map((surface) => surfaceResourceId(surface) ?? '');
      openSurface(conversationId, 'browser', nextOrdinalResourceId('view', open));
      return;
    }

    if (kind !== 'terminal') {
      openSurface(conversationId, kind);
      return;
    }

    openSurface(conversationId, 'terminal', nextTerminalId(takenTerminalIds()));
  };

  /**
   * A terminal tab *is* its shell, so closing it kills the shell rather than
   * leaving a process running with nothing on screen able to reach it.
   */
  const closeSurfaceAt = (id: SurfaceId) => {
    const surface = panel.surfaces.find((entry) => entry.id === id);
    // A terminal tab is its shells: closing it kills every pane rather than
    // leaving processes running with nothing on screen able to reach them.
    const rootTerminalId = surface?.kind === 'terminal' ? surfaceResourceId(surface) : null;
    if (rootTerminalId) {
      const groupKey = terminalGroupKey(conversationId, rootTerminalId);
      const paneIds = paneGroups[groupKey]?.terminalIds ?? [rootTerminalId];
      for (const terminalId of paneIds) {
        void window.atlasChat.terminal.kill({ conversationId, terminalId }).catch(() => {});
      }
      forgetPaneGroup(groupKey);
    }

    // A closed browser tab should not leave its address behind for the next
    // one that happens to be allocated the same id.
    const viewId = surface?.kind === 'browser' ? surfaceResourceId(surface) : null;
    if (viewId) forgetBrowserView(browserViewKey(conversationId, viewId));

    closeSurface(conversationId, id);
  };

  /**
   * A terminal names itself after what it is running and a file after itself;
   * everything else keeps the registry's label.
   */
  const labelFor = (surface: RightPanelSurface) => {
    if (surface.kind === 'file') {
      const path = surfaceResourceId(surface);
      return path ? fileSurfaceLabel(path) : undefined;
    }
    if (surface.kind === 'browser') {
      const viewId = surfaceResourceId(surface);
      if (!viewId) return undefined;
      const view = browserViews[browserViewKey(conversationId, viewId)];
      return view?.title || (view?.url ? displayBrowserUrl(view.url) : undefined);
    }
    if (surface.kind !== 'terminal') return undefined;
    const rootId = surfaceResourceId(surface) ?? PRIMARY_TERMINAL_ID;
    // A split tab is named after the pane being typed in, not its first one.
    const activeId =
      paneGroups[terminalGroupKey(conversationId, rootId)]?.activeTerminalId ?? rootId;
    return terminalLabel(terminals, activeId, terminalLabelFromId(activeId));
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg-base">
      <SurfaceTabStrip
        surfaces={panel.surfaces}
        activeSurfaceId={panel.activeSurfaceId}
        context={context}
        liveKinds={liveKinds}
        counts={{ tasks: toolParts.length, agents: agentCount, diff: 0, git: 0 }}
        labelFor={labelFor}
        onActivate={(id) => activateSurface(conversationId, id)}
        onOpen={openKind}
        onClose={closeSurfaceAt}
        onCloseOthers={(id) => closeOtherSurfaces(conversationId, id)}
        onCloseToRight={(id) => closeSurfacesToRight(conversationId, id)}
        onCloseAll={() => closeAllSurfaces(conversationId)}
        onHidePanel={() => hidePanel(conversationId)}
      />

      {/*
        Review owns its own scroller: the scope selector and the diff-wide
        actions have to stay put while a long patch scrolls under them.
      */}
      <div
        className={cn(
          'min-h-0 flex-1',
          active && active.kind !== 'tasks'
            ? 'overflow-hidden'
            : 'overflow-y-auto scrollbar-auto-hide'
        )}
        role="tabpanel"
        id="workbench-panel"
        aria-labelledby={active ? `workbench-tab-${active.id}` : undefined}
        tabIndex={0}
      >
        {!active && <SurfacePicker context={context} onOpen={openKind} />}
        {active?.kind === 'diff' && (
          <ReviewPanel conversationId={conversationId} onSendComments={onSendComments} />
        )}
        {active?.kind === 'git' && <GitPanel conversationId={conversationId} />}
        {active?.kind === 'browser' && (
          <BrowserSurface
            key={active.id}
            viewId={browserViewKey(conversationId, surfaceResourceId(active) ?? 'view-1')}
          />
        )}
        {active?.kind === 'files' && (
          <FilesPanel
            conversationId={conversationId}
            onOpenFile={(relativePath) => openSurface(conversationId, 'file', relativePath)}
          />
        )}
        {active?.kind === 'file' && (
          <FileViewerPanel
            // Keyed on the surface so switching between two open files
            // remounts the reader rather than swapping its content mid-scroll.
            key={active.id}
            conversationId={conversationId}
            relativePath={surfaceResourceId(active) ?? ''}
          />
        )}
        {active?.kind === 'terminal' && (
          <Suspense fallback={<div className="h-full w-full animate-pulse bg-bg-surface" />}>
            <TerminalSurface
              // Keyed so switching tabs gives each shell its own xterm rather
              // than re-pointing one view at a different PTY.
              key={active.id}
              conversationId={conversationId}
              rootTerminalId={surfaceResourceId(active) ?? PRIMARY_TERMINAL_ID}
              terminals={terminals}
              allocateTerminalId={() => nextTerminalId(takenTerminalIds())}
              onCloseSurface={() => closeSurfaceAt(active.id)}
              onAddSelectionToPrompt={onAddSelectionToPrompt}
            />
          </Suspense>
        )}
        {active?.kind === 'tasks' && (
          <TasksTab parts={toolParts} hasJobs={jobs.length > 0} conversationId={conversationId} />
        )}
        {active?.kind === 'agents' && (
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
      {cell.toolIcon || cell.toolSurface ? (
        <ToolActivityIconView
          icon={cell.toolIcon}
          surface={cell.toolSurface}
          className="size-4 shrink-0"
          fallback={<TaskStatusGlyph status={cell.status} className="shrink-0" />}
        />
      ) : (
        <TaskStatusGlyph status={cell.status} className="shrink-0" />
      )}
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
