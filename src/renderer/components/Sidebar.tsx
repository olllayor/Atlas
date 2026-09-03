import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LayoutGrid,
  Plug,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
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
import type { WorkspaceMode } from '../../shared/workspaceModes';
import { usePersistentFlag } from '../hooks/useResizablePanel';
import { useNow } from '../hooks/useNow';
import { cn } from '../lib/utils';
import { isTimerWoken, snoozeWakeLabel } from '../lib/snooze';
import { RailSectionLabel } from './railPrimitives';
import { RowIconButton } from './RowIconButton';
import { SidebarThreadRow } from './SidebarThreadRow';
import { SidebarActivityBell } from './SidebarActivityBell';
import { SidebarProjectHoverCard } from './SidebarHoverCard';
import {
  SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS,
  notifySidebarHoverCardOpenChange,
  useSidebarHoverCardDelay,
} from './sidebarHoverCardDelay';
import { SidebarSettingsMenu } from './SidebarSettingsMenu';
import { StatusDot } from './ui/status-dot';
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
import { useAppStore } from '../stores/useAppStore';
import {
  formatShelfSectionLabel,
  groupSidebarConversationItems,
  resolveModelDisplayLabel,
  resolveSidebarRowVariant,
  sortProjectsByPin,
  splitPinnedSidebarItems,
  splitSettledSidebarItems,
  splitSidebarItemsByProject,
  splitSnoozedSidebarItems,
  floatUnsettledSidebarItems,
  type SidebarConversationItem,
} from './sidebarViewModel';

/** Chats shown per project before the section collapses behind "Show more". */
const PROJECT_PREVIEW_COUNT = 5;

/**
 * Settled-shelf paging: recent history is the common lookup, and the deep
 * tail stays behind an explicit Show more rather than dominating the list.
 */
const SETTLED_SHELF_INITIAL_COUNT = 10;
const SETTLED_SHELF_PAGE_COUNT = 25;

/** Stable identity, so "no rows here" does not invalidate a memo every render. */
const EMPTY_SIDEBAR_ITEMS: SidebarConversationItem[] = [];

type SidebarProps = {
  items: SidebarConversationItem[];
  /**
   * Archived chats, same shape as `items` and deliberately a separate list:
   * `items` is what every other consumer of the conversation list sees, and an
   * archived chat has to be absent from all of them.
   *
   * Empty until the section is first expanded — see `onLoadArchivedChats`.
   */
  archivedItems: SidebarConversationItem[];
  /**
   * Whether anything is archived at all, known before `archivedItems` is
   * fetched. False hides the section outright: a user who has never archived
   * has no reason to carry a permanent empty disclosure.
   */
  hasArchivedChats: boolean;
  archivedCount?: number;
  isLoadingArchivedChats: boolean;
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
  /** Opens the folder picker to attach a project to the workspace. */
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
  /**
   * Opens a new chat seeded with this one's history, leaving this one alone.
   * Optional for the same reason as `onRename`: without wiring, the menu entry
   * hides rather than offering a fork that goes nowhere.
   */
  onForkConversation?: (conversationId: string) => void;
  /** Pinning lifts a chat into its own section; archiving hides it, reversibly. */
  onSetConversationPinned: (conversationId: string, pinned: boolean) => void;
  onArchiveConversation: (conversationId: string) => void;
  /**
   * Parks a chat as done (true) or returns it to the active list (false).
   * Settled chats stay listed in the Settled shelf — unlike archiving, which
   * removes the row from the sidebar. Pin is preserved across the transition.
   */
  onSetConversationSettled: (conversationId: string, settled: boolean) => void;
  /**
   * Snoozes until an ISO wake time, or wakes immediately with null. Snooze
   * only suppresses the row from the inbox; the wake is derived from the
   * clock, so nothing fires server-side when it passes.
   */
  onSetConversationSnoozed: (conversationId: string, snoozedUntil: string | null) => void;
  /**
   * Un-archives the chat *and* opens it. Archived is a holding area, not a
   * read-only mode: nothing downstream models an open-but-archived chat, so
   * restoring is the only way in.
   */
  onRestoreConversation: (conversationId: string) => void;
  /**
   * Fetches `archivedItems`. Called the first time the section is expanded,
   * never on mount — the query behind it scans a table with no reason to be
   * small, and most sessions never look.
   */
  onLoadArchivedChats: () => void;
  onSetProjectPinned: (projectId: string, pinned: boolean) => void;
  onOpenLanding: () => void;
  onOpenSites: () => void;
  onOpenPlugins: () => void;
  /** The plugin system is a beta feature and ships off; off means invisible. */
  showPlugins: boolean;
  onOpenSearch: () => void;
  /**
   * The open conversation's mode, which decides what the primary nav offers.
   *
   * Sites is a Code-mode destination and Connectors a Work-mode one, so showing
   * both to everyone made the rail describe the app rather than the thing being
   * worked on. Optional, because a sidebar with no conversation selected still
   * has to render something: Work is the default mode, so it is the fallback.
   */
  workspaceMode?: WorkspaceMode;
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
  /**
   * Whether the rail is translucent (macOS vibrancy on). Decides the scroll
   * mask: with translucency the section headings scroll away, so rows reach
   * the top edge and need the fade; with an opaque rail the sticky headings
   * already hide them, and the mask only erases the heading's own fill.
   */
  translucent?: boolean;
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

/** Shared with the Settings and Sites rails — see components/railPrimitives. */
const SidebarSectionLabel = RailSectionLabel;

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

export { RowIconButton };

export function Sidebar({
  items,
  archivedItems,
  hasArchivedChats,
  archivedCount,
  isLoadingArchivedChats,
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
  onForkConversation,
  onSetConversationPinned,
  onArchiveConversation,
  onSetConversationSettled,
  onSetConversationSnoozed,
  onRestoreConversation,
  onLoadArchivedChats,
  onSetProjectPinned,
  onOpenLanding,
  onOpenSites,
  onOpenPlugins,
  showPlugins,
  onOpenSearch,
  workspaceMode = 'work',
  onRefreshModels,
  onCheckForUpdates,
  onToggleCollapsed,
  modeSwitcher,
  width,
  translucent = false,
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

  /**
   * Project and chat cards share one delay, so the wait is paid once per run
   * down the list instead of once per row. Reading it as state (rather than
   * from a ref) is deliberate: Radix samples `openDelay` when the pointer
   * enters, so the number has to be on the prop before that happens.
   */
  const hoverCardOpenDelay = useSidebarHoverCardDelay();

  /**
   * Lifecycle order: re-activated chats float first (their `unsettledAt`
   * postdates their own `updatedAt`, so nothing else moves), then settled
   * chats leave for the Settled shelf, then snoozed chats leave for the
   * Snoozed shelf, and only then does pinning lift rows into Pinned. Each
   * step moves rows rather than copying them, so every chat renders exactly
   * once.
   */
  const floatedItems = useMemo(() => floatUnsettledSidebarItems(items), [items]);
  const { settled: settledItems, rest: unsettledItems } = useMemo(
    () => splitSettledSidebarItems(floatedItems),
    [floatedItems]
  );
  // `now` ticks every minute: snooze wakes are derived from the clock with no
  // server event, so without a moving time source a woken chat would sit
  // hidden until the next unrelated render.
  const now = useNow();
  const { snoozed: snoozedItems, rest: inboxItems } = useMemo(
    () => splitSnoozedSidebarItems(unsettledItems, now),
    [unsettledItems, now]
  );
  /**
   * Pinned chats come out of the inbox before anything else is grouped, so a
   * pinned chat appears once — in Pinned — rather than once there and once
   * under its project. A pinned-and-settled chat stays in Pinned: settling
   * never unpins.
   */
  const { pinned: pinnedItems, rest: unpinnedItems } = useMemo(
    () => splitPinnedSidebarItems(inboxItems),
    [inboxItems]
  );
  const orderedProjects = useMemo(() => sortProjectsByPin(projects), [projects]);
  const { sections, ungrouped } = useMemo(
    () => splitSidebarItemsByProject(unpinnedItems, orderedProjects),
    [orderedProjects, unpinnedItems]
  );
  const groups = useMemo(() => groupSidebarConversationItems(ungrouped, now), [ungrouped, now]);

  // Which project the open chat lives in — that section is force-expanded so
  // the current chat is never hidden behind a collapsed header.
  const selectedProjectId =
    items.find((item) => item.id === selectedConversationId)?.projectId ?? null;
  const [activeHoverCardId, setActiveHoverCardId] = useState<string | null>(null);
  /**
   * Model ids resolved to their catalog names once per catalog change, rather
   * than per row: the hover card is the only place a chat says what it runs
   * on, and it must agree with the model picker's chip.
   */
  const models = useAppStore((state) => state.models);
  const modelLabelById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of items) {
      if (item.modelId === null || byId.has(item.modelId)) continue;
      const label = resolveModelDisplayLabel(item.modelId, models);
      if (label !== null) byId.set(item.modelId, label);
    }
    return byId;
  }, [items, models]);
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

  /**
   * Archived is the same kind of disclosure as Recents and remembers the same
   * way — but it is never force-expanded: it is the bottom of the list and the
   * one section whose contents you are done with.
   */
  const [archivedExpanded, setArchivedExpanded] = usePersistentFlag('atlas.sidebar.archived-open', false);

  /**
   * The archive loads on expansion, not on mount. Keyed on the expanded flag
   * rather than the click handler because the flag is persisted: a window that
   * opens with the section already expanded has to fetch too, and that is not a
   * click.
   */
  const [archivedRequested, setArchivedRequested] = useState(false);
  useEffect(() => {
    if (!archivedExpanded || !hasArchivedChats || archivedRequested) {
      return;
    }
    setArchivedRequested(true);
    onLoadArchivedChats();
  }, [archivedExpanded, archivedRequested, hasArchivedChats, onLoadArchivedChats]);

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

  /**
   * The archived rows that are actually on screen. Archived rows are rows: they
   * take focus and answer the arrow keys like any other, so they have to be
   * resolved once here and reused by both the markup and `visibleRowIds`.
   */
  const visibleArchivedItems = useMemo(
    () => (hasArchivedChats && archivedExpanded ? archivedItems : EMPTY_SIDEBAR_ITEMS),
    [archivedExpanded, archivedItems, hasArchivedChats]
  );

  /**
   * The Snoozed shelf, collapsed by default: out of the way, never gone. Rows
   * show their wake ("2h") rather than their age — the return time is the
   * row's whole story. The open chat is always rendered even when collapsed,
   * so collapsing the shelf never hides the thing being looked at.
   */
  const [dismissedWokeIds, setDismissedWokeIds] = useState<ReadonlySet<string>>(() => new Set());
  const handleSelectConversation = useCallback(
    (id: string) => {
      setDismissedWokeIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      onSelect(id);
    },
    [onSelect]
  );

  const [snoozedExpanded, setSnoozedExpanded] = usePersistentFlag('atlas.sidebar.snoozed-open', false);
  const visibleSnoozedItems = useMemo(() => {
    if (snoozedExpanded) return snoozedItems;
    if (!selectedConversationId) return EMPTY_SIDEBAR_ITEMS;
    const selected = snoozedItems.find((item) => item.id === selectedConversationId);
    return selected ? [selected] : EMPTY_SIDEBAR_ITEMS;
  }, [snoozedExpanded, snoozedItems, selectedConversationId]);

  /**
   * The Settled shelf, collapsed by default: recent history is the common
   * lookup, and the deep tail stays behind an explicit Show more. The open
   * chat is always rendered even when collapsed or past the cut.
   */
  const [settledExpanded, setSettledExpanded] = usePersistentFlag('atlas.sidebar.settled-open', false);
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_SHELF_INITIAL_COUNT);
  const visibleSettledItems = useMemo(() => {
    if (!settledExpanded) {
      if (!selectedConversationId) return EMPTY_SIDEBAR_ITEMS;
      const selected = settledItems.find((item) => item.id === selectedConversationId);
      return selected ? [selected] : EMPTY_SIDEBAR_ITEMS;
    }
    if (settledItems.length <= settledVisibleCount) return settledItems;
    const head = settledItems.slice(0, settledVisibleCount);
    if (!selectedConversationId) return head;
    const selected = settledItems.find((item) => item.id === selectedConversationId);
    return selected && !head.includes(selected) ? [...head, selected] : head;
  }, [settledExpanded, settledItems, settledVisibleCount, selectedConversationId]);
  const hiddenSettledCount = settledExpanded ? settledItems.length - visibleSettledItems.length : 0;

  /** Rendered rows, in visual order — collapsed sections contribute nothing. */
  const visibleRowIds = useMemo(() => {
    const ids: string[] = [];

    for (const item of pinnedItems) {
      ids.push(item.id);
    }

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

    for (const item of visibleSnoozedItems) {
      ids.push(item.id);
    }

    for (const item of visibleSettledItems) {
      ids.push(item.id);
    }

    // Last, because Archived is the last section: this list is what End and the
    // arrow keys walk, and an order that disagrees with the markup skips rows.
    for (const item of visibleArchivedItems) {
      ids.push(item.id);
    }

    return ids;
  }, [
    groups,
    pinnedItems,
    projectVisibility,
    recentsExpanded,
    selectedUngroupedItem,
    visibleArchivedItems,
    visibleSettledItems,
    visibleSnoozedItems,
  ]);

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
   *
   * `archived` re-points the row's verbs rather than forking it: the row's
   * chrome, its hover card, its delete confirm and its place in the roving
   * tabindex are all identical, and only the click target and the two actions
   * differ.
   */
  const handleHoverCardOpenChange = useCallback((cardId: string, open: boolean) => {
    if (open) {
      setActiveHoverCardId(cardId);
      notifySidebarHoverCardOpenChange(true);
    } else {
      setActiveHoverCardId((current) => (current === cardId ? null : current));
      notifySidebarHoverCardOpenChange(false);
    }
  }, []);

  const handleCancelRename = useCallback(() => {
    cancelRenameRef.current = true;
    setRenamingId(null);
  }, []);

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value);
  }, []);

  const handleSetPendingDeleteId = useCallback((id: string | null) => {
    setPendingDeleteId(id);
  }, []);

  const handleSetRovingId = useCallback((id: string) => {
    setRovingId(id);
  }, []);

  const handleSetPinned = useCallback(
    (id: string, pinned: boolean) => {
      onSetConversationPinned(id, pinned);
    },
    [onSetConversationPinned]
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete]
  );

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );

  const renderConversationRow = useCallback(
    (
      item: SidebarConversationItem,
      options: { indented?: boolean; showTimestamp?: boolean; archived?: boolean; settled?: boolean; snoozed?: boolean } = {}
    ) => {
      const isArchived = options.archived ?? false;
      const isSettledShelf = options.settled ?? false;
      const isSnoozedShelf = options.snoozed ?? false;
      const variant = resolveSidebarRowVariant({
        archived: isArchived,
        settled: isSettledShelf,
        snoozed: isSnoozedShelf,
      });
      const isActive = !isArchived && !isSettledShelf && !isSnoozedShelf && item.id === selectedConversationId;
      const isRenaming = renamingId === item.id;
      const isPendingDelete = pendingDeleteId === item.id;
      const project = item.projectId ? (projectById.get(item.projectId) ?? null) : null;
      const isHoverCardOpen = activeHoverCardId === `conv:${item.id}`;
      const isWoke = isTimerWoken(
        {
          snoozedUntil: item.snoozedUntil,
          settledAt: item.settledAt,
          isDismissed: dismissedWokeIds.has(item.id) || item.id === selectedConversationId,
        },
        now
      );

      return (
        <SidebarThreadRow
          key={item.id}
          item={item}
          variant={variant}
          project={project}
          isActive={isActive}
          isArchived={isArchived}
          indented={options.indented ?? false}
          showTimestamp={options.showTimestamp ?? true}
          isRovingTarget={item.id === rovingTargetId}
          isRenaming={isRenaming}
          renameValue={isRenaming ? renameValue : ''}
          isPendingDelete={isPendingDelete}
          jumpLabel={conversationJumpLabelById.get(item.id) ?? null}
          showJumpHint={showConversationJumpHints && conversationJumpLabelById.has(item.id)}
          modelLabel={item.modelId === null ? null : (modelLabelById.get(item.modelId) ?? null)}
          isHoverCardOpen={isHoverCardOpen}
          hoverCardOpenDelay={hoverCardOpenDelay}
          onSelect={handleSelectConversation}
          onRestore={onRestoreConversation}
          onArchive={onArchiveConversation}
          onToggleSettled={onSetConversationSettled}
          onSnooze={onSetConversationSnoozed}
          isSettledShelf={isSettledShelf}
          isSnoozedShelf={isSnoozedShelf}
          isWoke={isWoke}
          onSetPinned={handleSetPinned}
          onFork={onForkConversation}
          onDelete={handleDelete}
          onStartRename={onRename ? startRename : undefined}
          onCommitRename={commitRename}
          onCancelRename={handleCancelRename}
          onRenameChange={handleRenameChange}
          onSetPendingDeleteId={handleSetPendingDeleteId}
          onSetRovingId={handleSetRovingId}
          onHoverCardOpenChange={handleHoverCardOpenChange}
        />
      );
    },
    [
      activeHoverCardId,
      commitRename,
      dismissedWokeIds,
      handleSelectConversation,
      conversationJumpLabelById,
      handleCancelRename,
      handleDelete,
      handleHoverCardOpenChange,
      handleRenameChange,
      handleSetPendingDeleteId,
      handleSetPinned,
      handleSetRovingId,
      hoverCardOpenDelay,
      modelLabelById,
      now,
      onArchiveConversation,
      onForkConversation,
      onRename,
      onRestoreConversation,
      onSetConversationSettled,
      onSetConversationSnoozed,
      onSelect,
      pendingDeleteId,
      projectById,
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
      className="sidebar-surface relative flex shrink-0 flex-col overflow-hidden"
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

          {/*
            Search lives up here rather than in the nav below, because it is
            not a place. The rows under it are destinations you go to and stay
            in; search opens the palette over whatever you were already doing,
            and giving it a full-width row alongside them implied otherwise —
            while spending a slot the mode-specific destinations need.
          */}
          {!collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Search chats and commands"
                  className="flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  <Search className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Search chats and commands</TooltipContent>
            </Tooltip>
          ) : null}

          {/*
            Activity (Codex parity): one bell for everything that wants a
            human — approvals, errors, unread output — grouped by urgency.
          */}
          {!collapsed ? (
            <SidebarActivityBell
              items={items}
              onSelect={(conversationId) => onSelect(conversationId)}
              onMarkAllRead={() => useAppStore.getState().markAllConversationsRead()}
            />
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
          {workspaceMode === 'code' ? (
            <RailButton
              icon={<LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />}
              label="Sites"
              onClick={onOpenSites}
            />
          ) : null}

          {showPlugins ? (
            <RailButton
              icon={<Plug className="size-4" strokeWidth={1.75} aria-hidden />}
              label="Plugins"
              onClick={onOpenPlugins}
            />
          ) : null}

          {runningItem ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSelect(runningItem.id)}
                  aria-label={`Generating in ${runningItem.primaryLabel}`}
                  className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-hover"
                >
                  {/* The button already carries the label and the tooltip, so
                      the dot repeats neither — it is decorative here. */}
                  <StatusDot size="md" tone="running" />
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
            {/*
              One mode-specific destination. Sites is where a Code-mode chat's
              output goes. Work mode's slot held Connectors, the hand-rolled MCP
              catalog that the plugin system replaces; it stays empty until the
              plugins view lands rather than pointing at a page that is gone.
            */}
            {workspaceMode === 'code' ? (
              <SidebarNavRow
                icon={<LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />}
                label="Sites"
                onClick={onOpenSites}
              />
            ) : null}

            {/* Not mode-specific: a plugin's skills apply to any conversation,
                so hiding this in one mode would hide half the feature. Beta
                gated: off, the destination does not exist. */}
            {showPlugins ? (
              <SidebarNavRow
                icon={<Plug className="size-4" strokeWidth={1.75} aria-hidden />}
                label="Plugins"
                onClick={onOpenPlugins}
              />
            ) : null}
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
              isScrolled && translucent
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

            {/*
              Pinned sits above Projects, as in the reference. It has no
              disclosure and no "Show more": a section you curated by hand is
              short by construction, and hiding it behind a chevron would undo
              the only thing pinning does.
            */}
            {pinnedItems.length > 0 ? (
              <section aria-label="Pinned">
                <div className="sidebar-section-heading sticky top-0 z-10 flex items-center gap-1 px-2 pb-1.5 pt-5">
                  <SidebarSectionLabel>Pinned</SidebarSectionLabel>
                </div>
                <div className="flex flex-col gap-0.5">
                  {pinnedItems.map((item) => renderConversationRow(item))}
                </div>
              </section>
            ) : null}

            {sections.length > 0 || projects.length > 0 ? (
              <section aria-label="Projects">
                <div className="sidebar-section-heading sticky top-0 z-10 flex items-center gap-1 px-2 pb-1.5 pt-5">
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
                  const isProjectPinned = Boolean(project.pinnedAt);
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
                        <HoverCard
                          open={activeHoverCardId === `project:${project.id}`}
                          openDelay={hoverCardOpenDelay}
                          closeDelay={SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS}
                          onOpenChange={(open) => {
                            const cardId = `project:${project.id}`;
                            if (open) {
                              setActiveHoverCardId(cardId);
                              notifySidebarHoverCardOpenChange(true);
                            } else {
                              setActiveHoverCardId((current) => (current === cardId ? null : current));
                              notifySidebarHoverCardOpenChange(false);
                            }
                          }}
                        >
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
                                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pl-2 pr-14 text-left"
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
                                      'pointer-events-none absolute right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-hover/row:delay-75',
                                      openProjectMenuId === project.id && 'pointer-events-auto opacity-100 group-hover/row:delay-0'
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
                                        <DropdownMenuItem
                                          onSelect={() => onSetProjectPinned(project.id, !isProjectPinned)}
                                        >
                                          {isProjectPinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                                          {isProjectPinned ? 'Unpin project' : 'Pin project'}
                                        </DropdownMenuItem>
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
                              <ContextMenuItem
                                onSelect={() => onSetProjectPinned(project.id, !isProjectPinned)}
                              >
                                {isProjectPinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                                {isProjectPinned ? 'Unpin project' : 'Pin project'}
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
                            onTogglePin={() => onSetProjectPinned(project.id, !isProjectPinned)}
                            onReveal={() => onRevealProject(project.id)}
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
                        <div className="flex flex-col gap-0.5">
                          {visibleItems.map((item) =>
                            // Nested rows keep the relative time: the reference
                            // frame shows `4h` / `8h` on the chats under both
                            // Codex and ChatGPT, so dropping it here was the
                            // one place the list stopped matching.
                            renderConversationRow(item, { indented: true })
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
                  className="group sidebar-section-heading sticky top-0 z-10 flex w-full items-center gap-1 px-2 pb-1.5 pt-5 text-left disabled:cursor-default"
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
                      <div className="flex flex-col gap-0.5">
                        {group.items.map((item) => renderConversationRow(item))}
                      </div>
                    </div>
                  ))
                ) : selectedUngroupedItem ? (
                  <div className="flex flex-col gap-0.5">{renderConversationRow(selectedUngroupedItem)}</div>
                ) : null}
              </section>
            ) : null}

            {/*
              Snoozed, between the inbox and Settled: out of the way, never
              gone. The header always renders while anything is snoozed — the
              count is the whole footprint when collapsed. Rows show their
              wake time rather than their age.
            */}
            {snoozedItems.length > 0 ? (
              <section aria-label="Snoozed">
                <button
                  type="button"
                  onClick={() => setSnoozedExpanded((current) => !current)}
                  aria-expanded={snoozedExpanded}
                  className="group sidebar-section-heading sticky top-0 z-10 flex w-full items-center gap-1 px-2 pb-1.5 pt-5 text-left"
                >
                  <SidebarSectionLabel>
                    {formatShelfSectionLabel('Snoozed', {
                      expanded: snoozedExpanded,
                      count: snoozedItems.length,
                    })}
                  </SidebarSectionLabel>
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-text-faint transition-transform group-hover:text-text-tertiary',
                      snoozedExpanded && 'rotate-90'
                    )}
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>

                {snoozedExpanded || visibleSnoozedItems.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {(snoozedExpanded ? snoozedItems : visibleSnoozedItems).map((item) =>
                      renderConversationRow(
                        {
                          ...item,
                          timestampLabel:
                            item.snoozedUntil !== null
                              ? snoozeWakeLabel(item.snoozedUntil, now)
                              : item.timestampLabel,
                        },
                        { snoozed: true }
                      )
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/*
              Settled, before Archived: parked-as-done chats stay listed here
              in slim rows, most recently parked first. The tail pages rather
              than rendering unbounded history into the list. Unlike archiving
              — which removes the row from the sidebar — settling keeps the
              chat one click away.
            */}
            {settledItems.length > 0 ? (
              <section aria-label="Settled">
                <button
                  type="button"
                  onClick={() => setSettledExpanded((current) => !current)}
                  aria-expanded={settledExpanded}
                  className="group sidebar-section-heading sticky top-0 z-10 flex w-full items-center gap-1 px-2 pb-1.5 pt-5 text-left"
                >
                  <SidebarSectionLabel>
                    {formatShelfSectionLabel('Settled', {
                      expanded: settledExpanded,
                      count: settledItems.length,
                    })}
                  </SidebarSectionLabel>
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-text-faint transition-transform group-hover:text-text-tertiary',
                      settledExpanded && 'rotate-90'
                    )}
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>

                {settledExpanded || visibleSettledItems.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {visibleSettledItems.map((item) =>
                      renderConversationRow(item, { settled: true })
                    )}
                    {settledExpanded && hiddenSettledCount > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSettledVisibleCount((count) => count + SETTLED_SHELF_PAGE_COUNT)
                        }
                        className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm text-text-faint transition-colors hover:bg-bg-hover hover:text-text-secondary"
                      >
                        Show {Math.min(hiddenSettledCount, SETTLED_SHELF_PAGE_COUNT)} more
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/*
              Archived, last and collapsed by default. It exists because
              archiving was otherwise a one-way door: the toast's Undo expired
              after six seconds and nothing in the app could reach the chat
              again. The section renders only when there is something in it, so
              a user who has never archived never sees it.
            */}
            {hasArchivedChats ? (
              <section aria-label="Archived">
                <button
                  type="button"
                  onClick={() => setArchivedExpanded((current) => !current)}
                  aria-expanded={archivedExpanded}
                  className="group sidebar-section-heading sticky top-0 z-10 flex w-full items-center gap-1 px-2 pb-1.5 pt-5 text-left"
                >
                  <SidebarSectionLabel>
                    {formatShelfSectionLabel('Archived', {
                      expanded: archivedExpanded,
                      count:
                        archivedItems.length > 0
                          ? archivedItems.length
                          : (archivedCount ?? 0),
                    })}
                  </SidebarSectionLabel>
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-text-faint transition-transform group-hover:text-text-tertiary',
                      archivedExpanded && 'rotate-90'
                    )}
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>

                {archivedExpanded ? (
                  visibleArchivedItems.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {visibleArchivedItems.map((item) =>
                        renderConversationRow(item, { archived: true })
                      )}
                    </div>
                  ) : (
                    // The fetch is a table scan, so the wait is real and the
                    // empty state has to wait for it — showing "Nothing
                    // archived" first and then filling the list reads as a bug.
                    <div className="flex h-8 w-full items-center px-2 text-sm text-text-faint">
                      {isLoadingArchivedChats || !archivedRequested ? 'Loading…' : 'Nothing archived'}
                    </div>
                  )
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
