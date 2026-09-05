import {
  Check,
  ChevronDown,
  Clock,
  Folder,
  FolderPlus,
  LayoutGrid,
  Plug,
  Plus,
  Search,
  SquarePen,
  Trash2,
  X,
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
import { useIsFullScreen } from '../hooks/useIsFullScreen';
import { cn } from '../lib/utils';
import { isTimerWoken, resolveSnoozePresets, snoozeWakeLabel } from '../lib/snooze';
import { RailSectionLabel } from './railPrimitives';
import { RowIconButton } from './RowIconButton';
import { SidebarThreadRow } from './SidebarThreadRow';
import { SidebarActivityBell } from './SidebarActivityBell';
import {
  notifySidebarHoverCardOpenChange,
  useSidebarHoverCardDelay,
} from './sidebarHoverCardDelay';
import { SidebarSettingsMenu } from './SidebarSettingsMenu';
import { StatusDot } from './ui/status-dot';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useAppStore } from '../stores/useAppStore';
import {
  filterSidebarItemsByMode,
  formatShelfSectionLabel,
  groupSidebarConversationItems,
  resolveModelDisplayLabel,
  resolveSidebarRowVariant,
  splitPinnedSidebarItems,
  splitSettledSidebarItems,
  splitSnoozedSidebarItems,
  floatUnsettledSidebarItems,
  type SidebarConversationItem,
} from './sidebarViewModel';

/**
 * Settled-shelf paging: recent history is the common lookup, and the deep
 * tail stays behind an explicit Show more rather than dominating the list.
 */
const SETTLED_SHELF_INITIAL_COUNT = 10;
const SETTLED_SHELF_PAGE_COUNT = 25;

/** Stable identity, so "no rows here" does not invalidate a memo every render. */
const EMPTY_SIDEBAR_ITEMS: SidebarConversationItem[] = [];

/** Manual pinned order lives outside the store: ids only, persisted locally. */
const PIN_ORDER_STORAGE_KEY = 'atlas.sidebar.pin-order';

function loadPinOrder(): string[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(PIN_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry): entry is string => typeof entry === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

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
  onRegenerateTitle?: (conversationId: string) => void;
  onMarkUnread?: (conversationId: string) => void;
  onMarkRead?: (conversationId: string) => void;
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
  /** Sites is a beta feature and ships off; off means invisible. */
  showSites: boolean;
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
      className="flex h-8.5 w-full items-center gap-2.5 rounded-md px-2 text-md font-medium text-text-primary transition-colors hover:bg-bg-hover"
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
  onRegenerateTitle,
  onMarkUnread,
  onMarkRead,
  onOpenSettings,
  onAttachProject,
  onForkConversation,
  onSetConversationPinned,
  onArchiveConversation,
  onSetConversationSettled,
  onSetConversationSnoozed,
  onRestoreConversation,
  onLoadArchivedChats,
  onOpenLanding,
  onOpenSites,
  showSites,
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  /** Project scope filter (T3 parity): null means all projects. */
  const [scopeProjectId, setScopeProjectId] = useState<string | null>(null);
  /** Multi-select (T3 parity): mod-click toggles, shift-click ranges. */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const modifierRef = useRef({ toggle: false, range: false });
  /** Manual pinned order override (T3 parity): null means store order. */
  const [pinOrderOverride, setPinOrderOverride] = useState<string[] | null>(loadPinOrder);
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ id: string; after: boolean } | null>(null);
  const dragPinIdRef = useRef<string | null>(null);
  const [rovingId, setRovingId] = useState<string | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cancelRenameRef = useRef(false);

  /**
   * Project and chat cards share one delay, so the wait is paid once per run
   * down the list instead of once per row. Reading it as state (rather than
   * from a ref) is deliberate: Radix samples `openDelay` when the pointer
   * enters, so the number has to be on the prop before that happens.
   */
  const hoverCardOpenDelay = useSidebarHoverCardDelay();

  /** Drives the traffic-light drag strip: reserved windowed, gone fullscreen. */
  const isFullScreen = useIsFullScreen();

  /**
   * Mode gate first: Work shows folderless chats, Code shows project chats.
   * Everything downstream (float, shelves, pins, search) operates on the
   * mode-visible subset, so a hidden chat never leaks back via a shelf.
   */
  const isCodeMode = workspaceMode === 'code';
  const modeItems = useMemo(() => filterSidebarItemsByMode(items, workspaceMode), [items, workspaceMode]);
  const modeArchivedItems = useMemo(
    () => filterSidebarItemsByMode(archivedItems, workspaceMode),
    [archivedItems, workspaceMode]
  );
  /**
   * Lifecycle order: re-activated chats float first (their `unsettledAt`
   * postdates their own `updatedAt`, so nothing else moves), then settled
   * chats leave for the Settled shelf, then snoozed chats leave for the
   * Snoozed shelf, and only then does pinning lift rows into Pinned. Each
   * step moves rows rather than copying them, so every chat renders exactly
   * once.
   */
  const floatedItems = useMemo(() => floatUnsettledSidebarItems(modeItems), [modeItems]);
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

  /**
   * In-list filter: scope narrows to one project.
   * Applied upstream so sections, groups, shelves and keyboard order all agree.
   * The open chat still pins itself visible inside shelves (existing fallbacks).
   */
  const isListFiltering = scopeProjectId !== null;
  const matchesThreadFilter = useCallback(
    (item: SidebarConversationItem) => {
      if (scopeProjectId !== null && item.projectId !== scopeProjectId) return false;
      return true;
    },
    [scopeProjectId]
  );
  const filteredPinnedItems = useMemo(
    () => pinnedItems.filter(matchesThreadFilter),
    [pinnedItems, matchesThreadFilter]
  );
  const filteredUnpinnedItems = useMemo(
    () => unpinnedItems.filter(matchesThreadFilter),
    [unpinnedItems, matchesThreadFilter]
  );
  const filteredSnoozedItems = useMemo(
    () => snoozedItems.filter(matchesThreadFilter),
    [snoozedItems, matchesThreadFilter]
  );
  const filteredSettledItems = useMemo(
    () => settledItems.filter(matchesThreadFilter),
    [settledItems, matchesThreadFilter]
  );

  // Modifier clicks need the held keys at click time, not at render time.
  useEffect(() => {
    const syncModifiers = (event: KeyboardEvent) => {
      modifierRef.current = { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey };
    };
    const clearModifiers = () => {
      modifierRef.current = { toggle: false, range: false };
    };
    window.addEventListener('keydown', syncModifiers, true);
    window.addEventListener('keyup', syncModifiers, true);
    window.addEventListener('blur', clearModifiers);
    return () => {
      window.removeEventListener('keydown', syncModifiers, true);
      window.removeEventListener('keyup', syncModifiers, true);
      window.removeEventListener('blur', clearModifiers);
    };
  }, []);

  // A new filter is a new list: stale ranges would act on hidden rows.
  useEffect(() => {
    setSelectedIds(new Set());
    selectionAnchorRef.current = null;
  }, [scopeProjectId]);

  /** Pinned display order: manual override first, store order for the rest. */
  const orderedPinnedItems = useMemo(() => {
    if (!pinOrderOverride) return filteredPinnedItems;
    const rank = new Map(pinOrderOverride.map((id, index) => [id, index] as const));
    return [...filteredPinnedItems].sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '')
    );
  }, [filteredPinnedItems, pinOrderOverride]);

  // Keep the override to live pins: fresh pins float top, unpins drop out.
  useEffect(() => {
    setPinOrderOverride((current) => {
      const live = new Set(pinnedItems.map((item) => item.id));
      const kept = (current ?? []).filter((id) => live.has(id));
      const known = new Set(kept);
      const fresh = pinnedItems.filter((item) => !known.has(item.id)).map((item) => item.id);
      if (fresh.length === 0 && kept.length === (current ?? []).length) return current;
      return [...fresh, ...kept];
    });
  }, [pinnedItems]);

  useEffect(() => {
    try {
      if (pinOrderOverride) {
        globalThis.localStorage?.setItem(PIN_ORDER_STORAGE_KEY, JSON.stringify(pinOrderOverride));
      }
    } catch {
      // Private window: order stays session-only.
    }
  }, [pinOrderOverride]);
  // Flat inbox (T3 method): every active chat in one chronological list with
  // its project named on the row. No per-project sections, no date groups —
  // the project is a row attribute, not list structure.
  const [activeHoverCardId, setActiveHoverCardId] = useState<string | null>(null);
  /**
   * Model ids resolved to their catalog names once per catalog change, rather
   * than per row: the hover card is the only place a chat says what it runs
   * on, and it must agree with the model picker's chip.
   */
  const models = useAppStore((state) => state.models);
  const modelLabelById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of modeItems) {
      if (item.modelId === null || byId.has(item.modelId)) continue;
      const label = resolveModelDisplayLabel(item.modelId, models);
      if (label !== null) byId.set(item.modelId, label);
    }
    return byId;
  }, [modeItems, models]);

  /**
   * Archived is collapsed by default: bottom of the list, done chats only.
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

  const runningItem = modeItems.find((item) => item.isRunning) ?? null;

  const toggleLabel = collapsed ? 'Show sidebar' : 'Hide sidebar';

  /**
   * Work-mode inbox groups folderless chats by recency (Today / Yesterday /
   * Previous 7 days / Previous 30 days / month). Code mode stays a flat
   * chronological list with the project named on the row.
   */
  const workDateGroups = useMemo(
    () => (isCodeMode ? [] : groupSidebarConversationItems(filteredUnpinnedItems, now)),
    [filteredUnpinnedItems, isCodeMode, now]
  );

  /**
   * The archived rows that are actually on screen. Archived rows are rows: they
   * take focus and answer the arrow keys like any other, so they have to be
   * resolved once here and reused by both the markup and `visibleRowIds`.
   */
  const visibleArchivedItems = useMemo(
    () =>
      hasArchivedChats && archivedExpanded
        ? modeArchivedItems.filter(matchesThreadFilter)
        : EMPTY_SIDEBAR_ITEMS,
    [archivedExpanded, modeArchivedItems, hasArchivedChats, matchesThreadFilter]
  );

  const archivedIdSet = useMemo(
    () => new Set(visibleArchivedItems.map((item) => item.id)),
    [visibleArchivedItems]
  );
  /** Bulk verbs skip archived rows (restore is their only verb). */
  const bulkActionIds = useMemo(
    () => [...selectedIds].filter((id) => !archivedIdSet.has(id)),
    [archivedIdSet, selectedIds]
  );
  const bulkSnoozePresets = useMemo(() => resolveSnoozePresets(new Date()), [selectedIds]);

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
    if (snoozedExpanded) return filteredSnoozedItems;
    if (!selectedConversationId) return EMPTY_SIDEBAR_ITEMS;
    const selected = filteredSnoozedItems.find((item) => item.id === selectedConversationId);
    return selected ? [selected] : EMPTY_SIDEBAR_ITEMS;
  }, [snoozedExpanded, filteredSnoozedItems, selectedConversationId]);

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
      const selected = filteredSettledItems.find((item) => item.id === selectedConversationId);
      return selected ? [selected] : EMPTY_SIDEBAR_ITEMS;
    }
    if (filteredSettledItems.length <= settledVisibleCount) return filteredSettledItems;
    const head = filteredSettledItems.slice(0, settledVisibleCount);
    if (!selectedConversationId) return head;
    const selected = filteredSettledItems.find((item) => item.id === selectedConversationId);
    return selected && !head.includes(selected) ? [...head, selected] : head;
  }, [settledExpanded, filteredSettledItems, settledVisibleCount, selectedConversationId]);
  const hiddenSettledCount = settledExpanded ? filteredSettledItems.length - visibleSettledItems.length : 0;

  /** Rendered rows, in visual order: pins, flat inbox, shelves. */
  const visibleRowIds = useMemo(() => {
    const ids: string[] = [];

    for (const item of orderedPinnedItems) {
      ids.push(item.id);
    }

    for (const item of filteredUnpinnedItems) {
      ids.push(item.id);
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
    filteredUnpinnedItems,
    orderedPinnedItems,
    visibleArchivedItems,
    visibleSettledItems,
    visibleSnoozedItems,
  ]);

  /**
   * Row activation with T3 selection semantics: plain click navigates and
   * clears, mod-click toggles one row, shift-click ranges from the anchor over
   * rendered rows. (Archived rows restore inside the row itself.)
   */
  const handleRowActivate = useCallback(
    (id: string) => {
      const { toggle, range } = modifierRef.current;
      if (range && selectionAnchorRef.current && selectionAnchorRef.current !== id) {
        const order = visibleRowIds;
        const from = order.indexOf(selectionAnchorRef.current);
        const to = order.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [start, end] = from < to ? [from, to] : [to, from];
          setSelectedIds(new Set(order.slice(start, end + 1)));
          return;
        }
      }
      if (toggle) {
        selectionAnchorRef.current = id;
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        return;
      }
      selectionAnchorRef.current = id;
      setSelectedIds((current) => (current.size === 0 ? current : new Set()));
      handleSelectConversation(id);
    },
    [handleSelectConversation, visibleRowIds]
  );

  /** Pinned drag reorder (T3 parity, native DnD): drop position sets order. */
  const handlePinDragStart = useCallback((id: string) => {
    dragPinIdRef.current = id;
    setDraggingPinId(id);
  }, []);

  const handlePinDragOver = useCallback((event: React.DragEvent, id: string) => {
    if (!dragPinIdRef.current || dragPinIdRef.current === id) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = event.clientY - rect.top > rect.height / 2;
    setDropIndicator((current) =>
      current && current.id === id && current.after === after ? current : { id, after }
    );
  }, []);

  const handlePinDrop = useCallback(
    (event: React.DragEvent, id: string) => {
      event.preventDefault();
      const moving = dragPinIdRef.current;
      dragPinIdRef.current = null;
      setDraggingPinId(null);
      setDropIndicator(null);
      if (!moving || moving === id || isListFiltering) return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const after = event.clientY - rect.top > rect.height / 2;
      setPinOrderOverride((current) => {
        const order = (current ?? pinnedItems.map((item) => item.id)).filter(
          (entry) => entry !== moving
        );
        const at = order.indexOf(id);
        order.splice(at === -1 ? order.length : at + (after ? 1 : 0), 0, moving);
        return order;
      });
    },
    [isListFiltering, pinnedItems]
  );

  const handlePinDragEnd = useCallback(() => {
    dragPinIdRef.current = null;
    setDraggingPinId(null);
    setDropIndicator(null);
  }, []);

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

  const startRename = useCallback((item: SidebarConversationItem) => {
    if (!onRename) {
      return;
    }
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
    const current = modeItems.find((item) => item.id === id)?.primaryLabel ?? '';
    if (next && next !== current) {
      onRename?.(id, next);
    }
  }, [modeItems, onRename, renameValue, renamingId]);

  const handleSidebarBackgroundContextMenu = useCallback(
    async (event: React.MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();

      if (!window.atlasChat?.contextMenu?.showSidebarBackground) {
        return;
      }

      const result = await window.atlasChat.contextMenu.showSidebarBackground();
      if (!result) return;

      if (result.action === 'new-chat') {
        onCreate();
      } else if (result.action === 'attach-project') {
        onAttachProject();
      }
    },
    [onAttachProject, onCreate]
  );

  const onListKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    // Escape clears a multi-select first; rows handle their own renames.
    if (event.key === 'Escape' && selectedIds.size > 0) {
      event.preventDefault();
      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
      return;
    }

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
  }, [selectedIds.size]);

  /**
   * One conversation row, in every state it can be in (renaming, ordinary).
   * Shared by the flat inbox and every shelf so chrome, hover card and
   * roving tabindex stay identical and only the click target and actions
   * differ per shelf. Deletes fire immediately — no confirm step.
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

  const handleSetRovingId = useCallback((id: string) => {
    setRovingId(id);
  }, []);

  const handleSetPinned = useCallback(
    (id: string, pinned: boolean) => {
      onSetConversationPinned(id, pinned);
    },
    [onSetConversationPinned]
  );

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );

  const renderConversationRow = useCallback(
    (
      item: SidebarConversationItem,
      options: { indented?: boolean; showTimestamp?: boolean; archived?: boolean; settled?: boolean; snoozed?: boolean; slim?: boolean } = {}
    ) => {
      const isArchived = options.archived ?? false;
      const isSettledShelf = options.settled ?? false;
      const isSnoozedShelf = options.snoozed ?? false;
      // Work date groups force slim: a folderless chat has no project line and
      // no branch line, so a card renders an orphan date above the title and an
      // empty row below it. Slim keeps title and date on one line.
      const variant = options.slim
        ? 'slim'
        : resolveSidebarRowVariant({
          archived: isArchived,
          settled: isSettledShelf,
          snoozed: isSnoozedShelf,
        });
      const isActive = !isArchived && !isSettledShelf && !isSnoozedShelf && item.id === selectedConversationId;
      const isRenaming = renamingId === item.id;
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
          isSelected={selectedIds.has(item.id)}
          indented={options.indented ?? false}
          showTimestamp={options.showTimestamp ?? true}
          isRovingTarget={item.id === rovingTargetId}
          isRenaming={isRenaming}
          renameValue={isRenaming ? renameValue : ''}
          jumpLabel={conversationJumpLabelById.get(item.id) ?? null}
          showJumpHint={showConversationJumpHints && conversationJumpLabelById.has(item.id)}
          modelLabel={item.modelId === null ? null : (modelLabelById.get(item.modelId) ?? null)}
          isHoverCardOpen={isHoverCardOpen}
          hoverCardOpenDelay={hoverCardOpenDelay}
          onSelect={handleRowActivate}
          onRestore={onRestoreConversation}
          onArchive={onArchiveConversation}
          onToggleSettled={onSetConversationSettled}
          onSnooze={onSetConversationSnoozed}
          isSettledShelf={isSettledShelf}
          isSnoozedShelf={isSnoozedShelf}
          isWoke={isWoke}
          onSetPinned={handleSetPinned}
          onFork={onForkConversation}
          onDelete={onDelete}
          onStartRename={onRename ? startRename : undefined}
          onRegenerateTitle={onRegenerateTitle}
          onMarkUnread={onMarkUnread}
          onMarkRead={onMarkRead}
          onOpenProjectSettings={onOpenSettings ? () => onOpenSettings('general') : undefined}
          onCommitRename={commitRename}
          onCancelRename={handleCancelRename}
          onRenameChange={handleRenameChange}
          onSetRovingId={handleSetRovingId}
          onHoverCardOpenChange={handleHoverCardOpenChange}
        />
      );
    },
    [
      activeHoverCardId,
      commitRename,
      dismissedWokeIds,
      handleRowActivate,
      selectedIds,
      conversationJumpLabelById,
      handleCancelRename,
      handleHoverCardOpenChange,
      handleRenameChange,
      handleSetPinned,
      handleSetRovingId,
      hoverCardOpenDelay,
      modelLabelById,
      now,
      onArchiveConversation,
      onDelete,
      onForkConversation,
      onMarkRead,
      onMarkUnread,
      onOpenSettings,
      onRegenerateTitle,
      onRename,
      onRestoreConversation,
      onSetConversationSettled,
      onSetConversationSnoozed,
      onSelect,
      projectById,
      renameValue,
      renamingId,
      rovingTargetId,
      selectedConversationId,
      showConversationJumpHints,
      startRename,
    ]
  );

  {/*
    Hairline right divider on the rail: the seam used to read as dead space
    (list padding + reserved scrollbar gutter + resize hit-area + transcript
    column pad stacking into ~30px of bare panel grey). The border gives the
    eye an intentional edge; the list carries no right pad at all, so rows
    end flush against the 6px scrollbar gutter — that gutter is the whole
    remaining gap, and it cannot go lower without content shifting when the
    list becomes scrollable.
  */}
  return (
    <aside
      onContextMenu={handleSidebarBackgroundContextMenu}
      className="sidebar-surface relative flex shrink-0 flex-col overflow-hidden border-r border-border-subtle"
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

        Fullscreen hides the traffic lights and the menu bar, so the strip
        would be 52px of bare panel above the wordmark. It shrinks to 12px
        there rather than vanishing: at zero the wordmark sat against the top
        edge, and 12px lands its row on the breadcrumb's line in the main
        titlebar, which keeps its full height because it carries content.
      */}
      <div
        className={cn(
          'shrink-0',
          isFullScreen ? 'h-titlebar-height-fullscreen' : 'h-titlebar-height'
        )}
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
            <span className="inline-flex animate-in items-center rounded-sm bg-bg-hover px-1.5 py-0.5 font-mono text-3xs leading-none text-text-tertiary fade-in-0 duration-150">
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
              items={modeItems}
              projectById={projectById}
              selectedConversationId={selectedConversationId}
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
          {showSites && workspaceMode === 'code' ? (
            <RailButton
              icon={<LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />}
              label="Design (Beta)"
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

          <SidebarActivityBell
            items={modeItems}
            projectById={projectById}
            selectedConversationId={selectedConversationId}
            onSelect={(conversationId) => onSelect(conversationId)}
            onMarkAllRead={() => useAppStore.getState().markAllConversationsRead()}
            side="right"
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

            {/* Code mode is project chats only: scope + attach live here.
                Work mode lists folderless chats, so a project scope is a noop
                and stays hidden rather than filtering nothing. */}
            {isCodeMode ? (
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Filter threads by project"
                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-md font-medium text-text-primary transition-colors hover:bg-bg-hover"
                  >
                    <Folder className="size-4 shrink-0 text-text-secondary" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {scopeProjectId
                        ? (projects.find((project) => project.id === scopeProjectId)?.title ?? 'All projects')
                        : 'All projects'}
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-text-faint" strokeWidth={1.75} aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onSelect={() => setScopeProjectId(null)}>
                    <Folder aria-hidden />
                    All projects
                  </DropdownMenuItem>
                  {projects.map((project) => (
                    <DropdownMenuItem key={project.id} onSelect={() => setScopeProjectId(project.id)}>
                      <Folder aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onAttachProject()}>
                    <FolderPlus aria-hidden />
                    Attach a folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onAttachProject()}
                    aria-label="Attach a folder"
                    title="Attach a folder"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
                  >
                    <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Attach a folder</TooltipContent>
              </Tooltip>
            </div>
            ) : null}
            {/*
              One mode-specific destination. Sites is where a Code-mode chat's
              output goes. Work mode's slot held Connectors, the hand-rolled MCP
              catalog that the plugin system replaces; it stays empty until the
              plugins view lands rather than pointing at a page that is gone.
            */}
            {showSites && workspaceMode === 'code' ? (
              <SidebarNavRow
                icon={<LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />}
                label="Design"
                trailing={
                  <span className="rounded border border-border-subtle px-1.5 py-0.5 text-3xs font-medium text-text-tertiary">
                    Beta
                  </span>
                }
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

          {/* Bulk bar: appears while a multi-select is held. */}
          {selectedIds.size > 0 ? (
            <div className="shrink-0 px-3 pb-1">
              <div
                role="toolbar"
                aria-label={`${selectedIds.size} chats selected`}
                className="flex animate-in items-center gap-0.5 rounded-md bg-bg-hover px-1.5 py-1 text-xs text-text-secondary fade-in-0 duration-150"
              >
                <span className="shrink-0 px-1 tabular-nums">{selectedIds.size} selected</span>
                <RowIconButton
                  icon={<Check className="size-3.5" strokeWidth={2} aria-hidden />}
                  label={`Settle ${bulkActionIds.length} chats`}
                  text="Settle"
                  onClick={() => {
                    for (const id of bulkActionIds) onSetConversationSettled(id, true);
                    selectionAnchorRef.current = null;
                    setSelectedIds(new Set());
                  }}
                  className="h-6 gap-1 px-1.5 text-xs text-text-secondary hover:bg-bg-active hover:text-text-primary"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Snooze selected chats"
                      title="Snooze selected chats"
                      className="flex h-6 shrink-0 items-center justify-center rounded-md px-1.5 text-text-secondary transition-colors hover:bg-bg-active hover:text-text-primary"
                    >
                      <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {bulkSnoozePresets.map((preset) => (
                      <DropdownMenuItem
                        key={preset.id}
                        onSelect={() => {
                          for (const id of bulkActionIds) {
                            onSetConversationSnoozed(id, preset.snoozedUntil);
                          }
                          selectionAnchorRef.current = null;
                          setSelectedIds(new Set());
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                        <span className="shrink-0 text-xs tabular-nums text-text-faint">
                          {preset.whenLabel}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <RowIconButton
                  icon={<Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />}
                  label={`Delete ${selectedIds.size} chats`}
                  onClick={() => {
                    for (const id of selectedIds) onDelete(id);
                    selectionAnchorRef.current = null;
                    setSelectedIds(new Set());
                  }}
                  className="size-6"
                />
                <span className="min-w-0 flex-1" />
                <RowIconButton
                  icon={<X className="size-3.5" strokeWidth={1.75} aria-hidden />}
                  label="Clear selection"
                  onClick={() => {
                    selectionAnchorRef.current = null;
                    setSelectedIds(new Set());
                  }}
                  className="size-6"
                />
              </div>
            </div>
          ) : null}

          <nav
            aria-label="Conversations"
            ref={listRef}
            onKeyDown={onListKeyDown}
            onScroll={(event) => {
              const scrolled = event.currentTarget.scrollTop > 2;
              setIsScrolled(scrolled);
            }}
            className="scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto pl-3 pr-0 pb-2"
            style={
              isScrolled && translucent
                ? ({
                    maskImage: 'linear-gradient(to bottom, transparent 0, black 20px)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 20px)',
                  } as React.CSSProperties)
                : undefined
            }
          >
            {isListFiltering &&
            filteredPinnedItems.length === 0 &&
            filteredUnpinnedItems.length === 0 &&
            visibleSnoozedItems.length === 0 &&
            visibleSettledItems.length === 0 &&
            visibleArchivedItems.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                <p className="text-sm text-text-tertiary">No matches</p>
                <p className="text-2xs text-text-faint">
                  {isCodeMode ? 'Nothing in this project yet' : 'Nothing here yet'}
                </p>
              </div>
            ) : null}

            {modeItems.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                <p className="text-sm text-text-tertiary">
                  {isCodeMode ? 'No project chats yet' : 'No work chats yet'}
                </p>
                <p className="text-2xs text-text-faint">
                  {isCodeMode
                    ? 'Attach a folder to start one'
                    : (newChatShortcutLabel ? `Press ${newChatShortcutLabel} to start one` : 'Start one above')}
                </p>
              </div>
            ) : null}

            {/*
              Pinned sits above Projects, as in the reference. It has no
              disclosure and no "Show more": a section you curated by hand is
              short by construction, and hiding it behind a chevron would undo
              the only thing pinning does.
            */}
            {orderedPinnedItems.length > 0 ? (
              <section aria-label="Pinned">
                <div className="sidebar-section-heading sticky top-0 z-10 flex items-center gap-1 px-2 pb-1.5 pt-5">
                  <SidebarSectionLabel>Pinned</SidebarSectionLabel>
                </div>
                <div className="flex flex-col gap-0.5">
                  {orderedPinnedItems.map((item) => (
                    <div
                      key={item.id}
                      draggable={!isListFiltering}
                      onDragStart={() => handlePinDragStart(item.id)}
                      onDragOver={(event) => handlePinDragOver(event, item.id)}
                      onDrop={(event) => handlePinDrop(event, item.id)}
                      onDragEnd={handlePinDragEnd}
                      title={isListFiltering ? undefined : 'Drag to reorder pins'}
                      className={cn(draggingPinId === item.id && 'opacity-50')}
                    >
                      {dropIndicator && dropIndicator.id === item.id && !dropIndicator.after ? (
                        <div aria-hidden className="mx-2 h-0.5 rounded-full bg-accent" />
                      ) : null}
                      {renderConversationRow(item, { slim: item.projectId == null })}
                      {dropIndicator && dropIndicator.id === item.id && dropIndicator.after ? (
                        <div aria-hidden className="mx-2 h-0.5 rounded-full bg-accent" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {filteredUnpinnedItems.length > 0 ? (
              isCodeMode ? (
              <section aria-label="Threads">
                <div className="flex flex-col gap-0.5 pt-1">
                  {filteredUnpinnedItems.map((item) => (
                    <div key={item.id}>{renderConversationRow(item)}</div>
                  ))}
                </div>
              </section>
              ) : (
              <>
                {workDateGroups.map((group) => (
                  <section key={group.key} aria-label={group.label}>
                    <div className="sidebar-section-heading sticky top-0 z-10 flex items-center gap-1 px-2 pb-1.5 pt-5">
                      <SidebarSectionLabel>{group.label}</SidebarSectionLabel>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {group.items.map((item) => (
                        <div key={item.id}>{renderConversationRow(item, { slim: true })}</div>
                      ))}
                    </div>
                  </section>
                ))}
              </>
              )
            ) : null}


            {/*
              Snoozed, between the inbox and Settled: out of the way, never
              gone. The header always renders while anything is snoozed — the
              count is the whole footprint when collapsed. Rows show their
              wake time rather than their age.
            */}
            {filteredSnoozedItems.length > 0 ? (
              <section aria-label="Snoozed">
                <button
                  type="button"
                  onClick={() => setSnoozedExpanded((current) => !current)}
                  aria-expanded={snoozedExpanded}
                  className="group sidebar-section-heading sticky top-0 z-10 flex w-full items-center gap-1 px-2 pb-1.5 pt-5 text-left"
                >
                  <SidebarSectionLabel>
                    <span className="text-brand-strong">
                      {formatShelfSectionLabel('Snoozed', {
                        expanded: snoozedExpanded,
                        count: filteredSnoozedItems.length,
                      })}
                    </span>
                  </SidebarSectionLabel>
                  <span aria-hidden className="h-px min-w-4 flex-1 bg-border-subtle" />
                  <ChevronDown
                    className="size-3.5 shrink-0 text-text-faint transition-colors group-hover:text-text-tertiary"
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
            {filteredSettledItems.length > 0 ? (
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
                      count: filteredSettledItems.length,
                    })}
                  </SidebarSectionLabel>
                  <span aria-hidden className="h-px min-w-4 flex-1 bg-border-subtle" />
                  <ChevronDown
                    className="size-3.5 shrink-0 text-text-faint transition-colors group-hover:text-text-tertiary"
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
                        visibleArchivedItems.length > 0
                          ? visibleArchivedItems.length
                          : (archivedCount ?? 0),
                    })}
                  </SidebarSectionLabel>
                  <span aria-hidden className="h-px min-w-4 flex-1 bg-border-subtle" />
                  <ChevronDown
                    className="size-3.5 shrink-0 text-text-faint transition-colors group-hover:text-text-tertiary"
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
