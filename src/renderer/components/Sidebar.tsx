import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SquarePen,
  Trash2,
  Unlink,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AppUpdateSnapshot,
  ConversationStats,
  SettingsSection,
  SettingsSummary,
  WorkspaceProject,
} from '../../shared/contracts';
import { usePersistentFlag } from '../hooks/useResizablePanel';
import { cn } from '../lib/utils';
import { SidebarConversationRow } from './SidebarConversationRow';
import { SidebarConversationHoverCard, SidebarProjectHoverCard } from './SidebarHoverCard';
import { SidebarSettingsMenu } from './SidebarSettingsMenu';
import { BrushSpinner } from './ui/brush-spinner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { HoverCard, HoverCardTrigger } from './ui/hover-card';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  groupSidebarConversationItems,
  splitSidebarItemsByProject,
  type SidebarConversationItem,
} from './sidebarViewModel';

/** Chats shown per project before the section collapses behind "Show more". */
const PROJECT_PREVIEW_COUNT = 5;

type SidebarProps = {
  items: SidebarConversationItem[];
  projects: WorkspaceProject[];
  selectedConversationId: string | null;
  collapsed: boolean;
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  isRefreshingModels: boolean;
  conversationStats: ConversationStats | null;
  loadedMessageCount: number;
  newChatShortcutLabel?: string | null;
  showNewChatShortcutHint: boolean;
  sidebarToggleShortcutLabel?: string | null;
  showSidebarToggleShortcutHint: boolean;
  settingsShortcutLabel?: string | null;
  showConversationJumpHints: boolean;
  conversationJumpLabelById: Map<string, string>;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
  onDelete: (conversationId: string) => void;
  /**
   * Optional so the sidebar can ship ahead of its App wiring; when it is
   * absent the Rename affordances hide themselves rather than no-op.
   */
  onRename?: (conversationId: string, title: string) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  /** Opens the folder picker; the new project becomes the current one. */
  onAttachProject: () => void;
  /** Starts a fresh Code-mode conversation inside a project. */
  onCreateInProject: (projectId: string) => void;
  onRevealProject: (projectId: string) => void;
  onDetachProject: (projectId: string) => void;
  /**
   * Optional for the same reason as `onRename`: without wiring the sidebar
   * hides "Edit project" rather than offering a rename that goes nowhere.
   */
  onRenameProject?: (projectId: string, title: string) => void;
  onOpenLanding: () => void;
  onOpenSites: () => void;
  onOpenSearch: () => void;
  onRefreshModels: () => void;
  onCheckForUpdates: () => void;
  onToggleCollapsed: () => void;
  /**
   * The workspace mode control, rendered where the wordmark used to sit.
   * Passed in rather than built here because the mode belongs to the open
   * conversation, which the sidebar knows nothing about. Optional: without it
   * the header falls back to the wordmark.
   */
  modeSwitcher?: React.ReactNode;
  /** Live width in px, driven by the drag handle in App. */
  width: number;
};

function SidebarToggleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.835 4c-.451.004-.82.012-1.137.038-.386.032-.659.085-.876.162l-.2.086c-.44.224-.807.564-1.063.982l-.103.184c-.126.247-.206.562-.248 1.076-.043.523-.043 1.19-.043 2.135v2.664c0 .944 0 1.612.043 2.135.042.515.122.829.248 1.076l.103.184c.256.418.624.758 1.063.982l.2.086c.217.077.49.13.876.162.316.026.685.034 1.136.038zm11.33 7.327c0 .922 0 1.654-.048 2.243-.043.522-.125.977-.305 1.395l-.082.177a4 4 0 0 1-1.473 1.593l-.276.155c-.465.237-.974.338-1.57.387-.59.048-1.322.048-2.244.048H7.833c-.922 0-1.654 0-2.243-.048-.522-.042-.977-.126-1.395-.305l-.176-.082a4 4 0 0 1-1.594-1.473l-.154-.275c-.238-.466-.34-.975-.388-1.572-.048-.589-.048-1.32-.048-2.243V8.663c0-.922 0-1.654.048-2.243.049-.597.15-1.106.388-1.571l.154-.276a4 4 0 0 1 1.594-1.472l.176-.083c.418-.18.873-.263 1.395-.305.589-.048 1.32-.048 2.243-.048h4.334c.922 0 1.654 0 2.243.048.597.049 1.106.15 1.571.388l.276.154a4 4 0 0 1 1.473 1.594l.082.176c.18.418.262.873.305 1.395.048.589.048 1.32.048 2.243zm-10 4.668h4.002c.944 0 1.612 0 2.135-.043.514-.042.829-.122 1.076-.248l.184-.103c.418-.256.758-.624.982-1.063l.086-.2c.077-.217.13-.49.162-.876.043-.523.043-1.19.043-2.135V8.663c0-.944 0-1.612-.043-2.135-.032-.386-.085-.659-.162-.876l-.086-.2a2.67 2.67 0 0 0-.982-1.063l-.184-.103c-.247-.126-.562-.206-1.076-.248-.523-.043-1.19-.043-2.135-.043H8.164L8.165 4z" />
    </svg>
  );
}

type NavRowProps = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  trailing?: React.ReactNode;
  title?: string;
};

/**
 * Section label above a run of rows ("Projects", "Recents", "Today").
 *
 * Sentence case at 13px in `--text-tertiary`, per the reference spec §3.4 —
 * these used to be 11px uppercase with 0.12em tracking, which reads as a
 * form-field legend and shouted over the row titles it introduces.
 */
function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="min-w-0 flex-1 truncate text-sm text-text-tertiary">{children}</span>;
}

/** Primary nav row: icon + 15px label, hover bg only — no borders, no pills. */
function SidebarNavRow({ icon, label, onClick, trailing, title }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-8.5 w-full items-center gap-2.5 rounded-md px-2 text-md font-normal text-text-primary transition-colors hover:bg-bg-hover"
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-text-secondary">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  );
}

/**
 * Collapsed-rail button. Every icon-only control in the rail carries a real
 * tooltip (side=right, 400ms) — the rail used to rely on native `title`,
 * which never appears on keyboard focus and takes a second to show.
 */
function RailButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Radix opens a hover card on focus as well as on hover, and the list moves
 * focus with the arrow keys — so keyboard navigation used to fire a card per
 * row, and clicking a row left its card parked over the transcript until focus
 * moved on. `preventDefault` is what `composeEventHandlers` checks before
 * running the primitive's own handler, so this suppresses the focus path and
 * leaves the pointer path alone.
 */
function suppressHoverCardOnFocus(event: React.FocusEvent) {
  event.preventDefault();
}

/**
 * Hover-revealed row action. Ghost until the row is hovered, and never in the
 * tab order — every one of these has a twin in the row's context menu, and two
 * extra tab stops per row would bury the list under them.
 */
function RowIconButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-bg-active hover:text-text-primary"
    >
      {icon}
    </button>
  );
}

export function Sidebar({
  items,
  projects,
  selectedConversationId,
  collapsed,
  settings,
  updateState,
  isRefreshingModels,
  conversationStats,
  loadedMessageCount,
  newChatShortcutLabel,
  showNewChatShortcutHint,
  sidebarToggleShortcutLabel,
  showSidebarToggleShortcutHint,
  settingsShortcutLabel,
  showConversationJumpHints,
  conversationJumpLabelById,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onOpenSettings,
  onAttachProject,
  onCreateInProject,
  onRevealProject,
  onDetachProject,
  onRenameProject,
  onOpenLanding,
  onOpenSites,
  onOpenSearch,
  onRefreshModels,
  onCheckForUpdates,
  onToggleCollapsed,
  modeSwitcher,
  width,
}: SidebarProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectRenameValue, setProjectRenameValue] = useState('');
  /** The project whose "…" menu is open, so its icons stay put under it. */
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [rovingId, setRovingId] = useState<string | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cancelRenameRef = useRef(false);
  const cancelProjectRenameRef = useRef(false);

  const { sections, ungrouped } = useMemo(
    () => splitSidebarItemsByProject(items, projects),
    [items, projects]
  );
  const groups = useMemo(() => groupSidebarConversationItems(ungrouped, Date.now()), [ungrouped]);

  // Which project the open chat lives in — that section is force-expanded so
  // the current chat is never hidden behind a collapsed header.
  const selectedProjectId =
    items.find((item) => item.id === selectedConversationId)?.projectId ?? null;
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(new Set());

  /**
   * Recents is one disclosure, collapsed by default, per the Codex reference:
   * the projects you attached are the durable structure, and an always-open
   * flat list of every session buried them under fifty rows.
   *
   * With no projects attached there is nothing else in the list, so the
   * disclosure is forced open and its chevron hidden — a sidebar whose only
   * content is a "Recents" label is not a sidebar.
   */
  const [recentsOpenPreference, setRecentsOpen] = usePersistentFlag('atlas.sidebar.recents-open', false);
  const hasProjectSections = sections.length > 0 || projects.length > 0;
  const recentsExpanded = recentsOpenPreference || !hasProjectSections;

  // Selecting a chat from a collapsed project used to hide the row you just
  // clicked. Opening one always re-expands its section.
  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    setCollapsedProjectIds((current) => {
      if (!current.has(selectedProjectId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(selectedProjectId);
      return next;
    });
  }, [selectedProjectId]);

  const toggleProject = useCallback((projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const showAllInProject = useCallback((projectId: string) => {
    setExpandedProjectIds((current) => new Set(current).add(projectId));
  }, []);
  const runningItem = items.find((item) => item.isRunning) ?? null;

  /**
   * The open chat when it lives in Recents — rendered under the collapsed
   * "Recents" header so collapsing the section never makes the thing you are
   * looking at disappear from the list.
   */
  const selectedUngroupedItem = recentsExpanded
    ? null
    : (ungrouped.find((item) => item.id === selectedConversationId) ?? null);
  const toggleLabel = collapsed ? 'Show sidebar' : 'Hide sidebar';

  /**
   * What each project section actually renders, resolved once so the roving
   * tabindex and the markup agree on which rows exist.
   *
   * The open chat is always in `visibleItems` even when it sorts past the
   * preview cut — it used to hide behind "Show more", which left the sidebar
   * with no selected row at all.
   */
  const projectVisibility = useMemo(
    () =>
      sections.map(({ project, items: projectItems }) => {
        const isCollapsed = collapsedProjectIds.has(project.id);
        const head = expandedProjectIds.has(project.id)
          ? projectItems
          : projectItems.slice(0, PROJECT_PREVIEW_COUNT);
        const selected = projectItems.find((item) => item.id === selectedConversationId);
        const shown = selected && !head.includes(selected) ? [...head, selected] : head;

        return {
          project,
          projectItems,
          isCollapsed,
          visibleItems: isCollapsed ? [] : shown,
          hiddenCount: projectItems.length - shown.length,
        };
      }),
    [collapsedProjectIds, expandedProjectIds, sections, selectedConversationId]
  );

  /** Rendered rows, in visual order — collapsed sections contribute nothing. */
  const visibleRowIds = useMemo(() => {
    const ids: string[] = [];

    for (const section of projectVisibility) {
      for (const item of section.visibleItems) {
        ids.push(item.id);
      }
    }

    if (recentsExpanded) {
      for (const group of groups) {
        for (const item of group.items) {
          ids.push(item.id);
        }
      }
    } else if (selectedUngroupedItem) {
      ids.push(selectedUngroupedItem.id);
    }

    return ids;
  }, [groups, projectVisibility, recentsExpanded, selectedUngroupedItem]);

  // Exactly one row is tabbable; the arrow keys move focus inside the list.
  // The candidate must be *rendered* — a target inside a collapsed section
  // left the whole list unreachable by keyboard.
  const rovingTargetId =
    (rovingId && visibleRowIds.includes(rovingId) ? rovingId : null) ??
    (selectedConversationId && visibleRowIds.includes(selectedConversationId)
      ? selectedConversationId
      : null) ??
    visibleRowIds[0] ??
    null;

  /**
   * The armed delete confirm used to be sticky forever — only a click on the
   * row or its X cleared it. Esc, a click anywhere else and any scroll of the
   * list all disarm it now.
   */
  useEffect(() => {
    if (!pendingDeleteId) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingDeleteId(null);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-delete-confirm]')) {
        return;
      }
      setPendingDeleteId(null);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [pendingDeleteId]);

  const startRename = useCallback((item: SidebarConversationItem) => {
    if (!onRename) {
      return;
    }
    setPendingDeleteId(null);
    // Escape unmounts the focused input, which fires no blur, so the previous
    // rename may have left this latched. Clear it or the next rename is
    // silently cancelled too.
    cancelRenameRef.current = false;
    setRenameValue(item.primaryLabel);
    setRenamingId(item.id);
  }, [onRename]);

  const commitRename = useCallback(() => {
    const id = renamingId;
    setRenamingId(null);

    if (!id || cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }

    const next = renameValue.trim();
    const current = items.find((item) => item.id === id)?.primaryLabel ?? '';
    if (next && next !== current) {
      onRename?.(id, next);
    }
  }, [items, onRename, renameValue, renamingId]);

  /**
   * "Edit project" in the hover card and the "…" menu both land here: the row
   * turns into an input in place, same as a chat rename, rather than opening a
   * dialog for a single text field.
   */
  const startProjectRename = useCallback(
    (project: WorkspaceProject) => {
      if (!onRenameProject) {
        return;
      }
      cancelProjectRenameRef.current = false;
      setProjectRenameValue(project.title);
      setRenamingProjectId(project.id);
    },
    [onRenameProject]
  );

  const commitProjectRename = useCallback(() => {
    const id = renamingProjectId;
    setRenamingProjectId(null);

    if (!id || cancelProjectRenameRef.current) {
      cancelProjectRenameRef.current = false;
      return;
    }

    const next = projectRenameValue.trim();
    const current = projects.find((project) => project.id === id)?.title ?? '';
    if (next && next !== current) {
      onRenameProject?.(id, next);
    }
  }, [onRenameProject, projectRenameValue, projects, renamingProjectId]);

  const onListKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }

    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-conversation-row]') ?? []
    );
    if (rows.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = rows.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : currentIndex === -1
            ? 0
            : event.key === 'ArrowDown'
              ? Math.min(rows.length - 1, currentIndex + 1)
              : Math.max(0, currentIndex - 1);

    rows[nextIndex]?.focus();
  }, []);

  /**
   * One conversation row, in every state it can be in (renaming, armed for
   * delete, ordinary). Extracted because project sections and the Recents
   * date groups render the same row and used to be a copy-paste apart.
   */
  const renderConversationRow = useCallback(
    (
      item: SidebarConversationItem,
      options: { indented?: boolean; showTimestamp?: boolean } = {}
    ) => {
      const isActive = item.id === selectedConversationId;
      const indentClass = options.indented ? 'pl-8' : 'px-2';
      const showTimestamp = options.showTimestamp ?? true;

      if (renamingId === item.id) {
        return (
          <input
            key={item.id}
            autoFocus
            value={renameValue}
            aria-label="Rename chat"
            onChange={(event) => setRenameValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelRenameRef.current = true;
                setRenamingId(null);
              }
            }}
            className="h-8 w-full rounded-md bg-bg-hover px-2 text-md text-text-primary ring-1 ring-border-strong outline-none"
          />
        );
      }

      if (pendingDeleteId === item.id) {
        return (
          <div
            key={item.id}
            data-delete-confirm
            className="flex h-8 w-full items-center gap-1 rounded-md bg-bg-hover px-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">Delete chat?</span>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setPendingDeleteId(null);
                onDelete(item.id);
              }}
              className="h-6 shrink-0 rounded-md px-1.5 text-sm text-error transition-colors hover:bg-error-bg hover:text-error-text"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setPendingDeleteId(null)}
              className="h-6 shrink-0 rounded-md px-1.5 text-sm text-text-tertiary transition-colors hover:bg-bg-active hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        );
      }

      const project = item.projectId
        ? (projects.find((candidate) => candidate.id === item.projectId) ?? null)
        : null;

      return (
        <HoverCard key={item.id} openDelay={450} closeDelay={120}>
          <ContextMenu>
            <HoverCardTrigger asChild onFocus={suppressHoverCardOnFocus}>
              <ContextMenuTrigger asChild>
                {/*
                  The row is a wrapper, not a single button: hover actions are
                  buttons of their own and cannot nest inside the row button.
                  The wrapper owns the hover fill so pointing at an icon does
                  not un-highlight the row it belongs to.
                */}
                <div
                  className={cn(
                    'group/row relative flex items-center rounded-md transition-colors',
                    isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'
                  )}
                >
                  <button
                    type="button"
                    data-conversation-row
                    aria-current={isActive ? 'page' : undefined}
                    tabIndex={item.id === rovingTargetId ? 0 : -1}
                    onFocus={() => setRovingId(item.id)}
                    onClick={() => {
                      setPendingDeleteId(null);
                      onSelect(item.id);
                    }}
                    onDoubleClick={() => startRename(item)}
                    className={cn(
                      'relative flex h-8 min-w-0 flex-1 items-center rounded-md pr-2 text-left',
                      indentClass,
                      isActive
                        ? 'font-medium text-text-primary'
                        : 'text-text-secondary group-hover/row:text-text-primary'
                    )}
                  >
                    <SidebarConversationRow
                      isRunning={item.isRunning}
                      isFailed={item.isFailed}
                      primaryLabel={item.primaryLabel}
                      timestampLabel={showTimestamp ? item.timestampLabel : null}
                      jumpLabel={conversationJumpLabelById.get(item.id)}
                      showJumpHint={showConversationJumpHints && conversationJumpLabelById.has(item.id)}
                    />
                  </button>

                  {/*
                    Actions sit over the trailing slot, which fades out under
                    them — the two never share the space, so nothing reflows
                    when the pointer arrives.
                  */}
                  <div className="pointer-events-none absolute right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100">
                    {onRename ? (
                      <RowIconButton
                        icon={<Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />}
                        label="Rename chat"
                        onClick={() => startRename(item)}
                      />
                    ) : null}
                    <RowIconButton
                      icon={<Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />}
                      label="Delete chat"
                      onClick={() => setPendingDeleteId(item.id)}
                    />
                  </div>
                </div>
              </ContextMenuTrigger>
            </HoverCardTrigger>
            <ContextMenuContent className="w-40">
              {onRename ? (
                <ContextMenuItem onSelect={() => startRename(item)}>
                  <Pencil aria-hidden />
                  Rename
                </ContextMenuItem>
              ) : null}
              <ContextMenuItem
                variant="destructive"
                onSelect={() => {
                  // Radix restores focus on close; arm after that so the
                  // confirm's autoFocus wins.
                  setTimeout(() => setPendingDeleteId(item.id), 0);
                }}
              >
                <Trash2 aria-hidden />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <SidebarConversationHoverCard
            title={item.primaryLabel}
            timestampLabel={item.timestampLabel}
            project={project}
            isRunning={item.isRunning}
            isFailed={item.isFailed}
          />
        </HoverCard>
      );
    },
    [
      commitRename,
      conversationJumpLabelById,
      onDelete,
      onRename,
      onSelect,
      pendingDeleteId,
      projects,
      renameValue,
      renamingId,
      rovingTargetId,
      selectedConversationId,
      showConversationJumpHints,
      startRename,
    ]
  );

  return (
    <aside
      className="relative flex shrink-0 flex-col overflow-hidden bg-bg-panel"
      style={{
        viewTransitionName: 'app-sidebar',
        width: collapsed ? 'var(--sidebar-width-collapsed)' : `${width}px`,
      }}
    >
      {/*
        macOS title bar area. Pure drag region — the traffic lights live here
        (x:16, ~70px wide), so on the 56px collapsed rail they cover the whole
        row and then some; nothing interactive may sit in it. The collapse
        toggle lives in the header row *below* this strip for that reason.
      */}
      <div
        className="h-titlebar-height shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/*
        Header. The collapse toggle lives here in *both* states — it used to
        teleport between the titlebar and a rail item — with the wordmark
        beside it when there is room.
      */}
      <div
        className={cn(
          'flex shrink-0 items-center pb-2',
          collapsed ? 'justify-center px-2' : 'justify-between px-3'
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/*
          The mode switcher takes the wordmark's place — the app name is
          already on the window and in the menu bar, while the mode is the one
          thing here that changes what the next message can do.
        */}
        {!collapsed ? (
          (modeSwitcher ?? (
            <h1 className="pl-1 text-lg font-semibold leading-none text-text-primary">Atlas</h1>
          ))
        ) : null}

        <div className="flex items-center gap-1.5">
          {/* Additive hint — the chip sits *beside* the icon so the button
              never changes size when a modifier is held. */}
          {!collapsed && showSidebarToggleShortcutHint && sidebarToggleShortcutLabel ? (
            <span className="inline-flex items-center rounded-sm bg-bg-hover px-1.5 py-0.5 font-mono text-3xs leading-none text-text-tertiary">
              {sidebarToggleShortcutLabel}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                className="flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <SidebarToggleIcon />
              </button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? 'right' : 'bottom'}>
              {sidebarToggleShortcutLabel ? `${toggleLabel} (${sidebarToggleShortcutLabel})` : toggleLabel}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/*
        Collapsed rail. Actions only: per-conversation initials were
        unidentifiable two-letter glyphs, so they are gone — a running
        generation still surfaces, because that is the one thing you cannot
        see anywhere else while collapsed.
      */}
      {collapsed ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center gap-1 px-2 py-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <RailButton
            icon={<SquarePen className="size-4" strokeWidth={1.75} aria-hidden />}
            label={newChatShortcutLabel ? `New chat (${newChatShortcutLabel})` : 'New chat'}
            onClick={onCreate}
          />
          <RailButton
            icon={<Search className="size-4" strokeWidth={1.75} aria-hidden />}
            label="Search chats and commands"
            onClick={onOpenSearch}
          />
          <RailButton
            icon={<LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />}
            label="Sites"
            onClick={onOpenSites}
          />

          {runningItem ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSelect(runningItem.id)}
                  aria-label={`Generating in ${runningItem.primaryLabel}`}
                  className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-hover"
                >
                  <BrushSpinner size={14} strokeWidth={1.5} speed={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{runningItem.primaryLabel}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {!collapsed ? (
        <>
          {/* Primary nav */}
          <div className="shrink-0 px-3">
            <SidebarNavRow
              icon={<SquarePen className="size-4" strokeWidth={1.75} aria-hidden />}
              label="New chat"
              onClick={onCreate}
              title={newChatShortcutLabel ? `New chat (${newChatShortcutLabel})` : undefined}
              trailing={
                showNewChatShortcutHint && newChatShortcutLabel ? (
                  <span className="rounded-sm bg-bg-hover px-1.5 py-0.5 font-mono text-3xs leading-none text-text-tertiary">
                    {newChatShortcutLabel}
                  </span>
                ) : undefined
              }
            />
            <SidebarNavRow
              icon={<Search className="size-4" strokeWidth={1.75} aria-hidden />}
              label="Search"
              onClick={onOpenSearch}
            />
            <SidebarNavRow
              icon={<LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />}
              label="Sites"
              onClick={onOpenSites}
            />
          </div>

          <nav
            aria-label="Conversations"
            ref={listRef}
            onKeyDown={onListKeyDown}
            onScroll={(event) => {
              const scrolled = event.currentTarget.scrollTop > 2;
              setIsScrolled(scrolled);
              // Scrolling away from an armed confirm disarms it.
              setPendingDeleteId(null);
            }}
            className="scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto px-3 pb-2"
            style={
              isScrolled
                ? ({
                    maskImage: 'linear-gradient(to bottom, transparent 0, black 20px)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 20px)',
                  } as React.CSSProperties)
                : undefined
            }
          >
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                <p className="text-sm text-text-tertiary">No chats yet</p>
                <p className="text-2xs text-text-faint">
                  {newChatShortcutLabel ? `Press ${newChatShortcutLabel} to start one` : 'Start one above'}
                </p>
              </div>
            ) : null}

            {sections.length > 0 || projects.length > 0 ? (
              <section aria-label="Projects">
                <div className="sticky top-0 z-10 flex items-center gap-1 bg-bg-panel px-2 pb-1.5 pt-5">
                  <SidebarSectionLabel>Projects</SidebarSectionLabel>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={onAttachProject}
                        aria-label="Attach a project folder"
                        className="flex size-5 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-bg-hover hover:text-text-primary"
                      >
                        <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Attach a folder</TooltipContent>
                  </Tooltip>
                </div>

                {projectVisibility.map(({ project, projectItems, isCollapsed, visibleItems, hiddenCount }) => {
                  const isCurrent = project.id === selectedProjectId;
                  const FolderIcon = isCollapsed ? Folder : FolderOpen;

                  return (
                    <div key={project.id} className="mt-0.5 flex flex-col first:mt-0">
                      {renamingProjectId === project.id ? (
                        <input
                          autoFocus
                          value={projectRenameValue}
                          aria-label="Rename project"
                          onChange={(event) => setProjectRenameValue(event.target.value)}
                          onFocus={(event) => event.currentTarget.select()}
                          onBlur={commitProjectRename}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitProjectRename();
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelProjectRenameRef.current = true;
                              setRenamingProjectId(null);
                            }
                          }}
                          className="h-8 w-full rounded-md bg-bg-hover px-2 text-md text-text-primary ring-1 ring-border-strong outline-none"
                        />
                      ) : (
                        <HoverCard openDelay={450} closeDelay={120}>
                          <ContextMenu>
                            <HoverCardTrigger asChild onFocus={suppressHoverCardOnFocus}>
                              <ContextMenuTrigger asChild>
                                <div
                                  className={cn(
                                    // No fill on the current project: the
                                    // selected chat directly beneath it is also
                                    // filled, and the two merged into one
                                    // anonymous slab that read as a single
                                    // selected item.
                                    'group/row relative flex items-center rounded-md transition-colors hover:bg-bg-hover',
                                    isCurrent ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleProject(project.id)}
                                    aria-expanded={!isCollapsed}
                                    title={project.exists ? project.root : `Missing — ${project.root}`}
                                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left"
                                  >
                                    <span className="flex size-4 shrink-0 items-center justify-center">
                                      {/* The folder itself is the disclosure: shut when
                                          the section is collapsed, open when it is.
                                          This used to hide the state behind a chevron
                                          that only appeared on hover, so a collapsed
                                          section looked identical to an empty one until
                                          you pointed at it. */}
                                      <FolderIcon
                                        className={cn(
                                          'size-4',
                                          project.exists ? 'text-text-tertiary' : 'text-warning-text'
                                        )}
                                        strokeWidth={1.75}
                                        aria-hidden
                                      />
                                    </span>
                                    {/* Branch and path moved into the hover card:
                                        they were hover-only chips here, which is
                                        exactly the space the row actions want. */}
                                    <span className="min-w-0 flex-1 truncate text-md">{project.title}</span>
                                  </button>

                                  <div
                                    className={cn(
                                      'pointer-events-none absolute right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100',
                                      openProjectMenuId === project.id && 'pointer-events-auto opacity-100'
                                    )}
                                  >
                                    <DropdownMenu
                                      open={openProjectMenuId === project.id}
                                      onOpenChange={(open) =>
                                        setOpenProjectMenuId(open ? project.id : null)
                                      }
                                    >
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          type="button"
                                          tabIndex={-1}
                                          aria-label={`Project options for ${project.title}`}
                                          onClick={(event) => event.stopPropagation()}
                                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-bg-active hover:text-text-primary"
                                        >
                                          <MoreHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="start" className="w-52">
                                        {onRenameProject ? (
                                          <DropdownMenuItem onSelect={() => startProjectRename(project)}>
                                            <Pencil aria-hidden />
                                            Rename project
                                          </DropdownMenuItem>
                                        ) : null}
                                        <DropdownMenuItem
                                          disabled={!project.exists}
                                          onSelect={() => onRevealProject(project.id)}
                                        >
                                          <FolderOpen aria-hidden />
                                          Reveal in file manager
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          variant="destructive"
                                          onSelect={() => onDetachProject(project.id)}
                                        >
                                          <Unlink aria-hidden />
                                          Remove project
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>

                                    <RowIconButton
                                      icon={<SquarePen className="size-3.5" strokeWidth={1.75} aria-hidden />}
                                      label={`New chat in ${project.title}`}
                                      onClick={() => onCreateInProject(project.id)}
                                    />
                                  </div>
                                </div>
                              </ContextMenuTrigger>
                            </HoverCardTrigger>
                            <ContextMenuContent className="w-52">
                              <ContextMenuItem onSelect={() => onCreateInProject(project.id)}>
                                <SquarePen aria-hidden />
                                New chat here
                              </ContextMenuItem>
                              {onRenameProject ? (
                                <ContextMenuItem onSelect={() => startProjectRename(project)}>
                                  <Pencil aria-hidden />
                                  Rename project
                                </ContextMenuItem>
                              ) : null}
                              <ContextMenuItem
                                disabled={!project.exists}
                                onSelect={() => onRevealProject(project.id)}
                              >
                                <FolderOpen aria-hidden />
                                Reveal in file manager
                              </ContextMenuItem>
                              <ContextMenuItem variant="destructive" onSelect={() => onDetachProject(project.id)}>
                                <Unlink aria-hidden />
                                Remove project
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>

                          <SidebarProjectHoverCard
                            project={project}
                            chatCount={projectItems.length}
                            onEdit={
                              onRenameProject
                                ? () => {
                                    // Radix returns focus to the trigger as it
                                    // closes; arm the input after that or the
                                    // autoFocus is stolen back.
                                    setTimeout(() => startProjectRename(project), 0);
                                  }
                                : undefined
                            }
                          />
                        </HoverCard>
                      )}

                      {!isCollapsed ? (
                        <div className="flex flex-col">
                          {visibleItems.map((item) =>
                            // No relative time on nested rows, per the
                            // reference: the project already dates them, and
                            // the slot cost 56px of an already-narrow title.
                            renderConversationRow(item, { indented: true, showTimestamp: false })
                          )}

                          {projectItems.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => onCreateInProject(project.id)}
                              title="Start a chat here"
                              className="flex h-8 w-full items-center rounded-md pl-8 pr-2 text-left text-sm text-text-faint transition-colors hover:bg-bg-hover hover:text-text-secondary"
                            >
                              No chats
                            </button>
                          ) : null}

                          {hiddenCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => showAllInProject(project.id)}
                              className="flex h-8 w-full items-center rounded-md pl-8 pr-2 text-left text-sm text-text-faint transition-colors hover:bg-bg-hover hover:text-text-secondary"
                            >
                              Show more
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {projects.length === 0 ? (
                  <button
                    type="button"
                    onClick={onAttachProject}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-text-faint transition-colors hover:bg-bg-hover hover:text-text-secondary"
                  >
                    <FolderPlus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    Attach a folder
                  </button>
                ) : null}
              </section>
            ) : null}

            {ungrouped.length > 0 ? (
              <section aria-label="Recents">
                {/*
                  One disclosure for all of history. Its own header is the only
                  sticky element in this section — the date labels inside scroll
                  away, because five stacked sticky bars stole a third of the
                  viewport on a long list.
                */}
                <button
                  type="button"
                  onClick={() => setRecentsOpen((current) => !current)}
                  disabled={!hasProjectSections}
                  aria-expanded={recentsExpanded}
                  className="group sticky top-0 z-10 flex w-full items-center gap-1 bg-bg-panel px-2 pb-1.5 pt-5 text-left disabled:cursor-default"
                >
                  <SidebarSectionLabel>Recents</SidebarSectionLabel>
                  {hasProjectSections ? (
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 text-text-faint transition-transform group-hover:text-text-tertiary',
                        recentsExpanded && 'rotate-90'
                      )}
                      strokeWidth={2}
                      aria-hidden
                    />
                  ) : null}
                </button>

                {recentsExpanded ? (
                  groups.map((group) => (
                    <div key={group.key} role="group" aria-label={group.label}>
                      <div className="px-2 pb-1 pt-3 text-sm text-text-faint">{group.label}</div>
                      <div className="flex flex-col">
                        {group.items.map((item) => renderConversationRow(item))}
                      </div>
                    </div>
                  ))
                ) : selectedUngroupedItem ? (
                  <div className="flex flex-col">{renderConversationRow(selectedUngroupedItem)}</div>
                ) : null}
              </section>
            ) : null}
          </nav>
        </>
      ) : null}

      {/*
        Footer. A hairline separates it from the list — the reference has one,
        and without it a long list scrolls its last row flush against Settings
        with nothing to say the list ended.
      */}
      <div
        className={cn(
          'shrink-0 border-t border-border-subtle px-2 py-2',
          collapsed ? 'flex justify-center' : ''
        )}
      >
        <SidebarSettingsMenu
          collapsed={collapsed}
          settings={settings}
          updateState={updateState}
          isRefreshingModels={isRefreshingModels}
          conversationStats={conversationStats}
          loadedMessageCount={loadedMessageCount}
          settingsShortcutLabel={settingsShortcutLabel}
          onOpenSettings={onOpenSettings}
          onOpenLanding={onOpenLanding}
          onRefreshModels={onRefreshModels}
          onCheckForUpdates={onCheckForUpdates}
        />
      </div>
    </aside>
  );
}
