/**
 * The right-hand workbench — Codex's diff / terminal / task surfaces.
 *
 * Codex backs these with a repository, a PTY and an agent fleet. Atlas has a
 * repository binding in Code mode (the attached project) but still no PTY, so
 * these panels read from the tool calls in the open conversation.
 *
 *   Changes  — every `file_change` call's diff, aggregated across the thread
 *   Terminal — every `command_execution` call, as a session command log
 *   Tasks    — every tool call in the thread with its status
 *
 * That keeps the Codex silhouette while remaining honest: each panel says
 * plainly what it is showing and what it is not.
 *
 * Presentation follows `docs/codex-parity/reference-visual-spec.md`:
 * §5's IDE changed-files rows and task/status lists, §6's calm feel —
 * borderless rows, hairline separators only, opacity-based hierarchy.
 */

import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

import type { ChatMessage, ChatToolPart, WorkspaceMode } from '../../../shared/contracts';
import {
  type DiffFile,
  type ToolCell,
  type ToolCellKind,
  type ToolCellStatus,
  buildToolCells,
  formatElapsed,
  parseUnifiedDiff,
  toolCellKind,
  toolCellStatus,
} from '../../../shared/toolCellGrammar';
import { cn } from '../../lib/utils';
import { DiffBlock } from '../transcript/DiffBlock';
import { TerminalBlock, stripAnsi } from '../transcript/TerminalBlock';

export type WorkbenchTab = 'changes' | 'terminal' | 'tasks';

/**
 * `modes` decides where a tab is worth showing. Work mode cannot produce a diff
 * or run a build, so offering Changes and Terminal there would be three tabs
 * where only one can ever have content.
 */
export const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string; modes: WorkspaceMode[] }> = [
  { id: 'changes', label: 'Changes', modes: ['code'] },
  { id: 'terminal', label: 'Terminal', modes: ['code'] },
  { id: 'tasks', label: 'Tasks', modes: ['work', 'code'] },
];

export function workbenchTabsForMode(mode: WorkspaceMode) {
  return WORKBENCH_TABS.filter((tab) => tab.modes.includes(mode));
}

type WorkbenchPanelProps = {
  mode: WorkspaceMode;
  messages: ChatMessage[];
  activeTab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  onClose: () => void;
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

export function WorkbenchPanel({ mode, messages, activeTab, onTabChange, onClose }: WorkbenchPanelProps) {
  const toolParts = useMemo(() => collectToolParts(messages), [messages]);
  const tabs = useMemo(() => workbenchTabsForMode(mode), [mode]);
  // Switching a conversation to Work with Changes open would otherwise leave a
  // selected tab that is no longer in the bar.
  const visibleTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? 'tasks');

  const counts = useMemo(() => {
    let changes = 0;
    let terminal = 0;
    for (const part of toolParts) {
      const kind = toolCellKind(part);
      if (kind === 'edit') changes += 1;
      if (kind === 'command') terminal += 1;
    }
    return { changes, terminal, tasks: toolParts.length };
  }, [toolParts]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg-base">
      {/* Plain text tabs — active is text-primary, inactive text-tertiary,
          no pill, no border under the bar (spec §6: no dividers). */}
      <div className="flex h-titlebar-height shrink-0 items-center gap-1 px-3">
        <div role="tablist" aria-label="Workbench" className="flex min-w-0 flex-1 items-center gap-4 px-1">
          {tabs.map((tab) => {
            const isActive = tab.id === visibleTab;
            const count = counts[tab.id];

            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 py-1.5 text-sm transition-colors',
                  isActive ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
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

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-auto-hide" role="tabpanel">
        {visibleTab === 'changes' && <ChangesTab parts={toolParts} />}
        {visibleTab === 'terminal' && <TerminalTab parts={toolParts} />}
        {visibleTab === 'tasks' && <TasksTab parts={toolParts} />}
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
// Changes — the IDE extension's changed-files pattern (spec §5, shot 12):
// "N files edited +A −D" header, then one borderless row per file with
// hairline separators, each expanding to its diff.
// ---------------------------------------------------------------------------

function ChangesTab({ parts }: { parts: ChatToolPart[] }) {
  const files = useMemo(() => {
    // Later edits to the same path supersede earlier ones, so the panel
    // shows the current state of each file rather than a replay.
    const byPath = new Map<string, DiffFile>();

    for (const part of parts) {
      if (toolCellKind(part) !== 'edit') continue;
      const output = typeof part.output === 'string' ? part.output : '';
      const parsed = parseUnifiedDiff(output);
      if (!parsed) continue;
      for (const file of parsed) byPath.set(file.path, file);
    }

    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [parts]);

  if (!files.length) {
    return (
      <EmptyState
        title="No file changes yet"
        body="Edits made in this conversation appear here as diffs. This is the thread's history, not a live view of your working tree — ask for git_diff to see that."
      />
    );
  }

  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);

  return (
    <div className="px-4 py-2">
      <p className="py-1.5 text-sm text-text-tertiary">
        {files.length} file{files.length === 1 ? '' : 's'} edited{' '}
        <span className="tabular-nums">
          <span className="text-diff-add-fg">+{added}</span>{' '}
          <span className="text-diff-del-fg">−{removed}</span>
        </span>
      </p>

      <div>
        {files.map((file) => (
          <FileChangeRow key={file.path} file={file} defaultOpen={files.length === 1} />
        ))}
      </div>
    </div>
  );
}

function FileChangeRow({ file, defaultOpen }: { file: DiffFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const label = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

  return (
    <div className="border-t border-border-subtle first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-bg-hover"
      >
        <span className="min-w-0 flex-1 truncate text-base text-text-primary" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-sm">
          <span className="text-diff-add-fg">+{file.added}</span>{' '}
          <span className="text-diff-del-fg">−{file.removed}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-text-faint transition-transform',
            !open && '-rotate-90'
          )}
        />
      </button>

      {open && (
        <div className="pb-3">
          <DiffBlock file={file} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal — a dim mono session log. Borderless; the command line is the
// only primary-intensity text, output stays recessive.
// ---------------------------------------------------------------------------

function TerminalTab({ parts }: { parts: ChatToolPart[] }) {
  const commands = useMemo(
    () =>
      buildToolCells(parts.filter((part) => toolCellKind(part) === 'command')).filter(
        (cell) => cell.kind === 'command'
      ),
    [parts]
  );

  if (!commands.length) {
    return (
      <EmptyState
        title="No commands run yet"
        body="Shell commands executed by tool calls in this conversation are logged here. This is a transcript, not an interactive shell — Atlas does not host a PTY."
      />
    );
  }

  return (
    <div className="space-y-4 px-4 py-3">
      {commands.map((cell) => {
        const detail = cell.detail;
        const duration =
          cell.durationMs != null && cell.durationMs >= 1000 ? formatElapsed(cell.durationMs) : null;

        return (
          <div key={cell.id}>
            <div className="flex items-baseline gap-1.5">
              <span aria-hidden className="app-code-compact select-none text-text-faint">
                $
              </span>
              <code className="app-code-compact min-w-0 flex-1 break-all text-text-primary">
                {cell.subject}
              </code>
              {duration && (
                <span className="shrink-0 tabular-nums text-xs text-text-faint">{duration}</span>
              )}
              <TaskStatusGlyph status={cell.status} className="shrink-0 self-center" />
            </div>

            {detail.type === 'text' && !detail.empty && (
              <div className="mt-1">
                <TerminalBlock lines={detail.lines} omitted={detail.omitted} />
              </div>
            )}
            {detail.type === 'text' && detail.empty && (
              <p className="app-code-compact mt-1 pl-3 text-text-faint">(no output)</p>
            )}
            {detail.type === 'error' && (
              <pre className="app-code-compact mt-1 overflow-x-auto whitespace-pre-wrap break-words pl-3 text-error">
                {stripAnsi(detail.text)}
              </pre>
            )}
          </div>
        );
      })}
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

const STATUS_ARIA_LABEL: Record<ToolCellStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
  'awaiting-approval': 'Awaiting approval',
};

/**
 * Status glyph vocabulary per the reference status list: spinner ring
 * while running, hollow circle while queued, dim check when done, and the
 * theme's error hue (orange under Codex) on failure.
 */
function TaskStatusGlyph({ status, className }: { status: ToolCellStatus; className?: string }) {
  const label = STATUS_ARIA_LABEL[status];

  if (status === 'success') {
    return <Check role="img" aria-label={label} className={cn('size-3.5 text-text-faint', className)} />;
  }

  if (status === 'failed') {
    return <X role="img" aria-label={label} className={cn('size-3.5 text-error', className)} />;
  }

  if (status === 'running') {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn(
          'size-3 animate-spin rounded-full border-[1.5px] border-text-tertiary border-t-transparent motion-reduce:animate-none',
          className
        )}
      />
    );
  }

  // Queued / awaiting approval: hollow circle. Approval borrows the
  // warning hue so a blocked task is findable without a badge.
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'size-3 rounded-full border-[1.5px]',
        status === 'awaiting-approval' ? 'border-warning' : 'border-text-faint',
        className
      )}
    />
  );
}

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

function TasksTab({ parts }: { parts: ChatToolPart[] }) {
  const cells = useMemo(() => buildToolCells(parts), [parts]);

  if (!cells.length) {
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
