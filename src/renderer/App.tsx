import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  DEFAULT_SETTINGS_APPEARANCE,
  designThemeSupportsLight,
  resolveAppliedThemeMode,
} from '../shared/contracts';
import { applyThemePalette, resolveEffectiveTheme } from './lib/themePalette';
import type { AppUpdateSnapshot, AtlasDeepLink, DesignTheme, FontFamilyOverride, KeybindingCommand, StreamEvent, ThemeMode } from '../shared/contracts';
import { getDefaultKeybindingRules, resolveKeybindingRules } from '../shared/keybindings';
import type { ToolPermissionMode } from '../shared/chatParameters';
import { DEFAULT_REASONING_EFFORT, DEFAULT_TOOL_PERMISSION_MODE } from '../shared/chatParameters';
import type { ExecutionTarget, WorkspaceMode } from '../shared/workspaceModes';
import { DEFAULT_EXECUTION_TARGET, DEFAULT_WORKSPACE_MODE, isWorkspaceModeReady, shouldPromptForProject } from '../shared/workspaceModes';
import { resolveProviderMetadata } from '../shared/providerMetadata';
import {
  deriveAttentionState,
  hasPendingApprovalInParts,
  pickNextAttentionConversation,
} from './lib/attention';
import { countRunningAgents } from './lib/agentActivity';
import { sameLivenessMap, type LivenessState } from './lib/livenessMap';
import { liveJobCountFor } from './lib/jobActivity';
import { useConversationJobSummaries } from './hooks/useConversationJobSummaries';
import { useDraftSummaries } from './hooks/useDraftSummaries';
import { POSTHOG_EVENTS } from '../shared/posthog';
import { ChatWindowSlot } from './components/ChatWindowSlot';
import { CommandPalette } from './components/CommandPalette';
import { formatExplainPrompt, formatMarkdownQuote, sanitizeSearchQuery } from './lib/contextMenu';
import { mergeCitationsIntoMessage, type AssistantCitation } from '../shared/citations';
import { ChatComposerSlot } from './components/ChatComposerSlot';
import { SubagentComposer } from './components/subagents/SubagentComposer';
import { OnboardingFlow } from './components/OnboardingFlow';
import { RendererErrorBoundary } from './components/RendererErrorBoundary';
import { SideChatPane } from './components/side/SideChatPane';
/*
  Route-level code splitting. None of these is on the path to a first paint of
  a chat: three are full-screen views the user has to navigate to, the terminal
  only mounts once the dock is opened, and the gallery is a modal. Static
  imports put all of them — settings' two thousand lines, xterm and its four
  addons, the sites and plugins workspaces — in the entry chunk that every cold
  start parses before anything is on screen.
*/
const SettingsWorkspaceRoute = lazy(() =>
  import('./components/settings/SettingsWorkspaceRoute').then((module) => ({
    default: module.SettingsWorkspaceRoute,
  }))
);
const SitesWorkspace = lazy(() =>
  import('./components/sites/SitesWorkspace').then((module) => ({ default: module.SitesWorkspace }))
);
const PluginsWorkspace = lazy(() =>
  import('./components/plugins/PluginsWorkspace').then((module) => ({
    default: module.PluginsWorkspace,
  }))
);
import { Sidebar } from './components/Sidebar';
import { PanelResizeHandle } from './components/PanelResizeHandle';
import type { RightPanelKind } from './components/workbench/rightPanelModel';
import { WorkbenchPanelSlot } from './components/workbench/WorkbenchPanelSlot';
import { useConversationPanel, useRightPanelStore } from './stores/useRightPanelStore';
import { WorkspaceContextBar } from './components/workspace/WorkspaceContextBar';
const TerminalDock = lazy(() =>
  import('./components/workbench/TerminalDock').then((module) => ({ default: module.TerminalDock }))
);
import { OpenInIdeButton } from './components/workspace/OpenInIdeButton';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { TerminalToggle, WorkbenchToggle, WorkspaceModeSwitch } from './components/workspace/WorkspaceModeSwitch';
import { useMeasuredHeight } from './hooks/useMeasuredHeight';
import { usePersistentFlag, useResizablePanel, useViewportWidth } from './hooks/useResizablePanel';
import { useIsFullScreen } from './hooks/useIsFullScreen';
import { computeColumns } from './lib/columns';
import { useSubagentComposerState } from './hooks/useSubagentComposerState';
import { useWorkspaceContext } from './hooks/useWorkspaceContext';
const VisualGallery = lazy(() =>
  import('./components/ai-elements/visual-gallery').then((module) => ({
    default: module.VisualGallery,
  }))
);
import { AtlasToaster } from './components/ui/sonner';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip';
const XAILandingPage = lazy(() =>
  import('./components/XAILandingPage').then((module) => ({ default: module.XAILandingPage }))
);
import { AtlasLoader } from './components/ui/atlas-loader';
import { APP_COMMAND_DEFINITIONS, APP_COMMANDS_BY_ID } from './lib/keybindingCommands';
import {
  isEditableTarget,
  resolveShortcutCommand,
  resolveShortcutPlatform,
  shortcutLabelForCommand,
  shouldShowConversationJumpHints,
  shouldShowShortcutHintForCommand,
} from './lib/keybindings';
import { buildSidebarConversationItems } from './components/sidebarViewModel';
import { captureEvent, identifyUser, setTelemetryEnabled as setRendererTelemetryEnabled, syncTelemetryStatus } from './lib/posthog';
import { prewarmMessageRendering } from './lib/messageRendering';
import { notify, notifyError } from './lib/notify';
import { copyImageSrc } from './lib/copyImage';
import { saveImageSrc } from './lib/saveImage';
import { isMacPlatform } from './lib/platform';
import { applyAppearanceContrast, buildThemeOverrides } from './lib/themeOverrides';
import { syncBrowserChromeTheme } from './lib/browserChrome';
import { stampTranslucentSidebar } from './lib/translucentSidebar';
import { applyAppearanceFontVariables } from "./lib/appearanceFonts";
import {
  persistCachedTheme,
  persistCachedFonts,
  THEME_MODE_STORAGE_KEY,
  DESIGN_THEME_STORAGE_KEY,
  THEME_ID_STORAGE_KEY,
} from './lib/earlyThemeStamp';
import { runViewTransition } from './lib/viewTransitions';
import { cn } from './lib/utils';
import {
  EMPTY_COMPOSER_ATTACHMENTS,
  EMPTY_CONVERSATION_PAGES,
  hasArchivedConversations,
  resolveArchivedConversationsCount,
  selectDiagnosticsSummary,
  selectLoadedConversationMetrics,
  useAppStore,
} from './stores/useAppStore';

// macOS traffic lights overlay the top-left of the frameless window; the main
// titlebar needs extra left inset only there, and only when the collapsed rail
// is too narrow to clear them (Windows/Linux controls sit top-right via
// titleBarOverlay).
const isMacLike = isMacPlatform;

// Hold-to-reveal for sidebar shortcut badges (⌘B / ⌘N / ⌘1-9). Long enough
// that a quick ⌘K / ⌘S never flashes the list, short enough that an
// intentional hold still feels instant.
const SIDEBAR_SHORTCUT_HINT_DELAY_MS = 500;

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-text-muted">
        <AtlasLoader size="lg" real className="h-14 w-14" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border border-error-border bg-bg-elevated p-8 text-center shadow-elevated">
        <h1 className="text-xl font-semibold text-text-primary">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-tertiary">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary mt-6 border-error-border bg-error-bg px-4 py-2 text-sm text-error-text"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function toCssFontFamilyList(value: string) {
  const genericFamilies = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'emoji',
    'math',
    'fangsong',
  ]);

  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (
        part.startsWith('"') ||
        part.startsWith("'") ||
        genericFamilies.has(part.toLowerCase())
      ) {
        return part;
      }

      return /[^a-zA-Z0-9_-]/.test(part) ? JSON.stringify(part) : part;
    })
    .join(', ');
}

function buildFontFamilyValue(override: FontFamilyOverride, fallbackVariable: '--font-ui-system' | '--font-mono-system') {
  const normalized = override?.trim();
  if (!normalized) {
    return `var(${fallbackVariable})`;
  }

  return `${toCssFontFamilyList(normalized)}, var(${fallbackVariable})`;
}

export default function App() {
  // Sidebar collapse and width persist: both used to be volatile React
  // state, so every restart reset the layout.
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentFlag('atlas.sidebar.collapsed', false);
  /** Fullscreen hides the traffic lights, so the chrome insets kept for them go. */
  const isFullScreen = useIsFullScreen();
  const sidebarResize = useResizablePanel({
    storageKey: 'atlas.sidebar.width',
    defaultWidth: 284,
    minWidth: 208,
    maxWidth: 460,
    edge: 'start',
  });
  // The composer floats over the transcript; this is how the transcript
  // learns how much room to leave for it.
  const composerDock = useMeasuredHeight<HTMLDivElement>();
  /*
    The right panel's surfaces belong to a conversation, not to the window, so
    the layout reads the panel for whichever one is selected. Subscribed here
    rather than taken from the store slice read further down, because the width
    solver below runs before that slice exists.
  */
  const panelConversationId = useAppStore((state) => state.selectedConversationId);
  const rightPanel = useConversationPanel(panelConversationId ?? undefined);
  const workbenchOpen = rightPanel.isOpen;
  /** Opens the panel on one surface, for whichever conversation is selected. */
  const openRightPanelSurface = useCallback((kind: RightPanelKind) => {
    const conversationId = useAppStore.getState().selectedConversationId;
    if (!conversationId) return;
    useRightPanelStore.getState().openSurface(conversationId, kind);
  }, []);
  /** Shows the panel without choosing a surface; the picker takes it from there. */
  const showRightPanel = useCallback(() => {
    const conversationId = useAppStore.getState().selectedConversationId;
    if (!conversationId) return;
    useRightPanelStore.getState().showPanel(conversationId);
  }, []);
  const workbenchResize = useResizablePanel({
    storageKey: 'atlas.workbench.width',
    defaultWidth: 420,
    minWidth: 300,
    maxWidth: 720,
    edge: 'end',
  });
  // Codex docks its terminal along the bottom of the window rather than in the
  // right-hand panel, so a diff and a running command can be read at once.
  const [terminalOpen, setTerminalOpen] = usePersistentFlag('atlas.terminal.open', false);
  const terminalResize = useResizablePanel({
    storageKey: 'atlas.terminal.height',
    defaultWidth: 260,
    minWidth: 120,
    maxWidth: 720,
    edge: 'end',
    axis: 'vertical',
  });
  /**
   * "Expand" is a round trip, not a resize: the dragged height is remembered
   * so restoring puts the dock back exactly where the user had left it.
   */
  const terminalRestoreHeightRef = useRef<number | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  /*
    Concession-chain solver (dsh port): the workbench yields before the
    transcript ever drops below CENTER_MIN, and closes entirely under real
    pressure — derived only, so re-widening the window restores it. The
    sidebar never concedes; center absorbs any final deficit.
  */
  const viewportWidth = useViewportWidth();
  const solvedColumns = useMemo(
    () =>
      computeColumns(
        viewportWidth,
        sidebarCollapsed ? 0 : sidebarResize.width,
        workbenchOpen ? workbenchResize.width : 0
      ),
    [viewportWidth, sidebarCollapsed, sidebarResize.width, workbenchOpen, workbenchResize.width]
  );
  /** Solver closed the workbench to protect the transcript — keep it mounted at zero (state survives) but hide its handle. */
  const workbenchDerivedClosed = workbenchOpen && solvedColumns.details === 0;

  const toggleTerminalExpanded = useCallback(() => {
    setTerminalExpanded((current) => {
      if (current) {
        terminalResize.setWidth(terminalRestoreHeightRef.current ?? terminalResize.defaultWidth);
        return false;
      }

      terminalRestoreHeightRef.current = terminalResize.width;
      terminalResize.setWidth(terminalResize.maxWidth);
      return true;
    });
  }, [terminalResize]);
  // Dragging the seam is the user setting the height by hand, which ends the
  // expanded state rather than fighting it.
  useEffect(() => {
    if (terminalResize.isResizing) {
      setTerminalExpanded(false);
    }
  }, [terminalResize.isResizing]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [showConversationJumpHints, setShowConversationJumpHints] = useState(false);
  const [showNewChatShortcutHint, setShowNewChatShortcutHint] = useState(false);
  const [showSidebarToggleShortcutHint, setShowSidebarToggleShortcutHint] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  /** Did onboarding's own CTA send the user into Settings? See the effect below. */
  const onboardingRequestedSettingsRef = useRef(false);
  const wasSettingsViewRef = useRef(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [telemetryEnabled, setTelemetryEnabledState] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);
  const shortcutPlatform = useMemo(
    () => resolveShortcutPlatform(typeof navigator === 'undefined' ? 'MacIntel' : navigator.platform),
    []
  );

  const {
    bootstrapping,
    initialized,
    bootstrapError,
    activeView,
    settingsSection,
    commandPaletteOpen,
    commandPaletteInitialQuery,
    modelPickerOpen,
    composerFocused,
    composerFocusNonce,
    activeCredentialProviderId,
    keyDraft,
    isSavingKey,
    isValidatingKey,
    isRefreshingModels,
    settings,
    models,
    conversations,
    archivedConversations,
    isLoadingArchivedConversations,
    hasLoadedArchivedConversations,
    loadArchivedConversations,
    isLoadingOlderByConversation,
    isLoadingConversationId,
    selectedConversationId,
    unreadByConversation,
    markConversationUnread,
    markConversationRead,
    regenerateConversationTitle,
    queuedByConversation,
    selectedModelIdByConversation,
    selectedProviderIdByConversation,
    goalsByConversation,
    conversationStats,
    diagnostics,
    updateState,
    bootstrap,
    refreshModels,
    loadConversation,
    loadOlderMessages,
    createConversation,
    openSettings,
    closeSettings,
    setSettingsSection,
    setCommandPaletteOpen,
    setCommandPaletteInitialQuery,
    setModelPickerOpen,
    setComposerFocused,
    requestComposerFocus,
    setActiveCredentialProvider,
    setKeyDraft,
    saveProviderKey,
    validateProviderKey,
    updatePreferences,
    setUpdateState,
    checkForUpdates,
    performUpdatePrimaryAction,
    setSelectedModel,
    setComposerDraft,
    clearComposerDraft,
    selectAdjacentConversation,
    selectConversationByIndex,
    sendMessage,
    resendLastUserMessage,
    abortConversation,
    respondToolApproval,
    deleteConversation,
    renameConversation,
    handleStreamEvent,
    openLanding,
    closeLanding,
    openSites,
    openPlugins,
    closeSites,
    projects,
    refreshProjects,
    attachProject,
    detachProject,
    renameProject,
    setProjectPinned,
    setProjectAutoPull,
    setConversationPinned,
    setConversationArchived,
    setConversationSettled,
    setConversationSnoozed,
    setConversationWorkspace,
    setConversationToolPermissionMode,
    removeConversationWorktree,
    createConversationInProject,
    forkConversation,
  } = useAppStore(
    useShallow((state) => ({
      bootstrapping: state.bootstrapping,
      initialized: state.initialized,
      bootstrapError: state.bootstrapError,
      activeView: state.activeView,
      settingsSection: state.settingsSection,
      commandPaletteOpen: state.commandPaletteOpen,
      commandPaletteInitialQuery: state.commandPaletteInitialQuery,
      modelPickerOpen: state.modelPickerOpen,
      composerFocused: state.composerFocused,
      composerFocusNonce: state.composerFocusNonce,
      activeCredentialProviderId: state.activeCredentialProviderId,
      keyDraft: state.keyDraft,
      isSavingKey: state.isSavingKey,
      isValidatingKey: state.isValidatingKey,
      isRefreshingModels: state.isRefreshingModels,
      settings: state.settings,
      models: state.models,
      conversations: state.conversations,
      archivedConversations: state.archivedConversations,
      isLoadingArchivedConversations: state.isLoadingArchivedConversations,
      hasLoadedArchivedConversations: state.hasLoadedArchivedConversations,
      loadArchivedConversations: state.loadArchivedConversations,
      conversationStats: state.conversationStats,
      diagnostics: state.diagnostics,
      isLoadingOlderByConversation: state.isLoadingOlderByConversation,
      isLoadingConversationId: state.isLoadingConversationId,
      selectedConversationId: state.selectedConversationId,
      unreadByConversation: state.unreadByConversation,
      markConversationUnread: state.markConversationUnread,
      markConversationRead: state.markConversationRead,
      regenerateConversationTitle: state.regenerateConversationTitle,
      queuedByConversation: state.queuedByConversation,
      selectedModelIdByConversation: state.selectedModelIdByConversation,
      selectedProviderIdByConversation: state.selectedProviderIdByConversation,
      // `composerDraftsByConversation` / `composerAttachmentsByConversation` are
      // deliberately absent: they change on every keystroke, and this selector
      // is shallow-compared, so subscribing to them here re-rendered the whole
      // window per character. `ChatComposerSlot` reads them instead.
      //
      // `draftsByConversation` and `conversationDetails` are absent for the
      // same reason one flush later: the stream reducer replaces both on every
      // 33ms batch, so subscribing here re-rendered the whole window ~30 times
      // a second for the length of every response. `ChatWindowSlot`,
      // `ChatComposerSlot` and `WorkbenchPanelSlot` read them where they are
      // actually rendered; App keeps only the turn-level scalars below.
      goalsByConversation: state.goalsByConversation,
      updateState: state.updateState,
      bootstrap: state.bootstrap,
      refreshModels: state.refreshModels,
      loadConversation: state.loadConversation,
      loadOlderMessages: state.loadOlderMessages,
      createConversation: state.createConversation,
      openSettings: state.openSettings,
      closeSettings: state.closeSettings,
      setSettingsSection: state.setSettingsSection,
      setCommandPaletteOpen: state.setCommandPaletteOpen,
      setCommandPaletteInitialQuery: state.setCommandPaletteInitialQuery,
      setModelPickerOpen: state.setModelPickerOpen,
      setComposerFocused: state.setComposerFocused,
      requestComposerFocus: state.requestComposerFocus,
      setActiveCredentialProvider: state.setActiveCredentialProvider,
      setKeyDraft: state.setKeyDraft,
      saveProviderKey: state.saveProviderKey,
      validateProviderKey: state.validateProviderKey,
      updatePreferences: state.updatePreferences,
      setUpdateState: state.setUpdateState,
      checkForUpdates: state.checkForUpdates,
      performUpdatePrimaryAction: state.performUpdatePrimaryAction,
      setSelectedModel: state.setSelectedModel,
      setComposerDraft: state.setComposerDraft,
      clearComposerDraft: state.clearComposerDraft,
      selectAdjacentConversation: state.selectAdjacentConversation,
      selectConversationByIndex: state.selectConversationByIndex,
      sendMessage: state.sendMessage,
      resendLastUserMessage: state.resendLastUserMessage,
      abortConversation: state.abortConversation,
      respondToolApproval: state.respondToolApproval,
      deleteConversation: state.deleteConversation,
      renameConversation: state.renameConversation,
      handleStreamEvent: state.handleStreamEvent,
      openLanding: state.openLanding,
      closeLanding: state.closeLanding,
      openSites: state.openSites,
      openPlugins: state.openPlugins,
      closeSites: state.closeSites,
      projects: state.projects,
      refreshProjects: state.refreshProjects,
      attachProject: state.attachProject,
      createConversationInProject: state.createConversationInProject,
      forkConversation: state.forkConversation,
      detachProject: state.detachProject,
      renameProject: state.renameProject,
      setProjectPinned: state.setProjectPinned,
      setProjectAutoPull: state.setProjectAutoPull,
      setConversationPinned: state.setConversationPinned,
      setConversationArchived: state.setConversationArchived,
      setConversationSettled: state.setConversationSettled,
      setConversationSnoozed: state.setConversationSnoozed,
      setConversationWorkspace: state.setConversationWorkspace,
      setConversationToolPermissionMode: state.setConversationToolPermissionMode,
      removeConversationWorktree: state.removeConversationWorktree,
    }))
  );
  /*
    Turn-level draft state for the sidebar rows. Never the tokens: see
    `projectDraftSummaries`.
  */
  const draftSummaries = useDraftSummaries();
  /*
    Settings reports how much transcript is resident, which means reading the
    page map — the same map the stream reducer replaces on every flush. Reading
    it only while Settings is open keeps that subscription off the chat path,
    where the map is invisible anyway.
  */
  const settingsConversationPages = useAppStore((state) =>
    state.activeView === 'settings' ? state.conversationDetails : EMPTY_CONVERSATION_PAGES
  );
  const loadedMetrics = useAppStore(useShallow(selectLoadedConversationMetrics));
  const diagnosticsSummary = useAppStore(useShallow(selectDiagnosticsSummary));

  /*
    Two scalars instead of the whole page. `conversationDetails` is replaced on
    every stream flush, so reading the object here re-rendered App per token;
    the title and "has any messages" are what App itself renders, and both hold
    still for the length of a turn. The page object goes to the components that
    actually draw it (`ChatWindowSlot`, `ChatComposerSlot`, `WorkbenchPanelSlot`).
  */
  const activeConversationTitle = useAppStore((state) =>
    selectedConversationId
      ? state.conversationDetails[selectedConversationId]?.conversation.title ?? null
      : null
  );
  const conversationStarted = useAppStore((state) =>
    selectedConversationId
      ? (state.conversationDetails[selectedConversationId]?.messages.length ?? 0) > 0
      : false
  );
  /**
   * The context strip above the composer is pre-flight chrome — folder,
   * execution target, branch, PR, all there to aim the first message. Once
   * the conversation has history it collapses to its minimal form (jobs and
   * plugin-tool chips only): the chips that remain are ones with no other
   * home, and the slab below gets the composer row to itself.
   */


  /**
   * Back/forward through the conversations visited this session — the Codex
   * titlebar's arrows. A browser-history shape, not a stack: picking an item
   * from the middle truncates everything forward of it, and the buttons
   * simply enable and disable at the two ends. `navLock` marks the one
   * selection change that a back/forward click itself causes, so restoring
   * position does not re-push the entry it is restoring.
   */
  /*
    Latches on the first gallery open so the modal's chunk is fetched on demand
    but the dialog is not torn out from under its own exit animation.
  */
  const galleryEverOpenedRef = useRef(false);
  if (galleryOpen) galleryEverOpenedRef.current = true;
  const galleryMounted = galleryOpen || galleryEverOpenedRef.current;

  const [navigation, setNavigation] = useState<{ history: string[]; index: number }>({
    history: [],
    index: -1,
  });
  const navLockRef = useRef(false);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }
    if (navLockRef.current) {
      navLockRef.current = false;
      return;
    }
    setNavigation((current) => {
      const history = current.history.slice(0, current.index + 1);
      if (history[history.length - 1] === selectedConversationId) {
        return current;
      }
      history.push(selectedConversationId);
      return { history, index: history.length - 1 };
    });
  }, [selectedConversationId]);

  const navigateConversationHistory = useCallback(
    (direction: -1 | 1) => {
      setNavigation(({ history, index }) => {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= history.length) {
          return { history, index };
        }
        const target = history[nextIndex];
        if (target !== selectedConversationId) {
          navLockRef.current = true;
          void loadConversation(target).catch(() => {
            // A dead target (deleted mid-session) must not leave the lock
            // latched — that would silently swallow the next real push.
            navLockRef.current = false;
          });
        }
        return { history, index: nextIndex };
      });
    },
    [loadConversation, selectedConversationId]
  );
  const canNavigateBack = navigation.index > 0;
  const canNavigateForward = navigation.index < navigation.history.length - 1;
  /*
    Status only, for the same reason: the draft object is replaced per token,
    its status is not. Everything that renders draft *content* reads the draft
    itself, one level down.
  */
  const activeDraftStatus = useAppStore((state) =>
    selectedConversationId ? state.draftsByConversation[selectedConversationId]?.status ?? null : null
  );
  const isActiveDraftStreaming = activeDraftStatus === 'streaming';

  /**
   * Composer takeover (plan §3.5). A subagent conversation must not send
   * through the ordinary chat path — one-shot children are execution records
   * and continuable children only accept parent-authorized followups — so
   * the whole composer is swapped for the subagent slab below.
   */
  const subagentTakeover = useSubagentComposerState(selectedConversationId);
  const reloadConversationDetail = useAppStore((state) => state.reloadConversationDetail);

  const sendSubagentFollowup = useCallback(
    async (text: string) => {
      if (!selectedConversationId) return;
      // Read live: the callback must not re-create when the page object is
      // replaced mid-stream, and this field never changes within a session.
      const parentId =
        useAppStore.getState().conversationDetails[selectedConversationId]?.conversation
          .sideOfConversationId ?? null;
      if (!parentId) {
        notify({ tone: 'error', title: 'Parent conversation unavailable', description: 'This session can no longer accept messages' });
        return;
      }
      await window.atlasChat.subagents.followup(parentId, selectedConversationId, text);
      // The turn runs outside the request/stream plumbing, so pull the
      // accepted message in; the hook's sync poll carries the rest.
      void reloadConversationDetail(selectedConversationId);
    },
    [reloadConversationDetail, selectedConversationId]
  );

  const stopSubagent = useCallback(() => {
    if (!selectedConversationId) return;
    captureEvent(POSTHOG_EVENTS.MESSAGE_ABORTED);
    void window.atlasChat.subagents.interrupt(selectedConversationId).then(() => {
      void useAppStore.getState().reloadConversationDetail(selectedConversationId);
    });
  }, [selectedConversationId]);
  /**
   * A session nobody has spoken in yet — no stored turns and no draft in
   * flight. Same test the transcript uses to decide it should show the
   * suggestions screen, so the workspace chips and that screen come and go
   * together rather than on two different definitions of "new".
   */
  const isLoadingOlder = selectedConversationId ? Boolean(isLoadingOlderByConversation[selectedConversationId]) : false;
  const isLoadingConversation =
    selectedConversationId != null && isLoadingConversationId === selectedConversationId;
  const selectedModelId = selectedConversationId ? selectedModelIdByConversation[selectedConversationId] ?? null : null;
  const selectedProviderId = selectedConversationId ? selectedProviderIdByConversation[selectedConversationId] ?? null : null;

  // Mode and project are per conversation, not per window: two threads on two
  // repos are the normal case, and a global switch would silently retarget the
  // one you were not looking at.
  const activeConversationSummary = selectedConversationId
    ? conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
    : null;
  const workspaceMode = activeConversationSummary?.workspaceMode ?? DEFAULT_WORKSPACE_MODE;
  const executionTarget = activeConversationSummary?.executionTarget ?? settings?.chat.executionTarget ?? DEFAULT_EXECUTION_TARGET;
  const activeWorktreeRoot = activeConversationSummary?.worktreeRoot ?? null;
  const activeProject = activeConversationSummary?.projectId
    ? projects.find((project) => project.id === activeConversationSummary.projectId) ?? null
    : null;
  const workspaceReady = isWorkspaceModeReady(workspaceMode, Boolean(activeProject?.exists));
  // The conversation's own setting, then the app default, then the shipped one.
  // Hoisted out of the composer's props because the sidebar heading shows the
  // same rung, and two triggers reading two chains would eventually disagree.
  const toolPermissionMode =
    activeConversationSummary?.toolPermissionMode ??
    settings?.chat.toolPermissionMode ??
    DEFAULT_TOOL_PERMISSION_MODE;
  // One entry point for "this conversation needs a folder now". Every surface
  // (mode switch, mode menu, context bar, sidebar, command palette) already
  // funnels through the store's attachProject, which single-flights the native
  // dialog; this wrapper only adds the analytics envelope.
  const requestProjectForConversation = useCallback(
    async (conversationId: string, source: 'mode-switch' | 'mode-menu') => {
      captureEvent(POSTHOG_EVENTS.PROJECT_ATTACH_PROMPTED, { source });
      const project = await attachProject({ conversationId });
      captureEvent(POSTHOG_EVENTS.PROJECT_ATTACH_RESOLVED, {
        source,
        outcome: project ? 'attached' : 'cancelled',
      });
    },
    [attachProject]
  );
  // Lives here rather than in the switcher because the mode is a property of
  // the open conversation, and the switcher itself now renders inside the
  // sidebar, which has no idea which conversation that is.
  //
  // Permission is a fixed function of mode — Work asks, Code runs with full
  // access — so the switch writes both axes at once. There is no separate
  // access UI; the approval ladder still gates at runtime, just not by hand.
  const handleWorkspaceModeChange = useCallback(
    (mode: WorkspaceMode) => {
      if (!selectedConversationId) return;
      captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'workspaceMode', value: mode });
      void setConversationWorkspace(selectedConversationId, { mode });
      const permission: ToolPermissionMode = mode === 'code' ? 'full-access' : 'ask';
      void setConversationToolPermissionMode(selectedConversationId, permission);
      // Code is the mode with a panel worth seeing; opening it on the switch
      // saves the second click without locking the two together — the toggle
      // still wins afterwards.
      if (mode === 'code') {
        showRightPanel();
        // The gate becomes a flow: Code with no folder at all asks for one on
        // the spot, the way Codex's directory picker does. The mode commit
        // above is not conditional on the answer — cancelling leaves Code
        // selected with the existing warning, never a silent bounce back to
        // Work. Re-selecting Code from the menu while unready re-opens the
        // picker, which is the recovery path after a cancel.
        if (shouldPromptForProject(mode, activeProject)) {
          void requestProjectForConversation(selectedConversationId, 'mode-switch');
        }
      }
    },
    [activeProject, requestProjectForConversation, selectedConversationId, setConversationWorkspace, setConversationToolPermissionMode, showRightPanel]
  );
  /**
   * Mode-gated creation: a new chat from the Code sidebar stays inside the
   * open project (mode `code`, not the global default), so it never lands in
   * the Work list as an unfiled chat. Code with no project at all still
   * creates first, then asks for a folder — cancelling leaves the gate, never
   * a silent unfiled Code chat.
   */
  const handleCreateConversation = useCallback(() => {
    if (workspaceMode === 'code' && activeProject) {
      void createConversationInProject(activeProject.id);
      return;
    }
    void createConversation().then((created) => {
      if (workspaceMode === 'code' && created && !created.projectId) {
        void requestProjectForConversation(created.id, 'mode-switch');
      }
    });
  }, [activeProject, createConversation, createConversationInProject, requestProjectForConversation, workspaceMode]);
  const handleExecutionTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (!selectedConversationId) return;
      void setConversationWorkspace(selectedConversationId, { executionTarget: target });
    },
    [selectedConversationId, setConversationWorkspace]
  );
  /** Codex's "from develop": provision the worktree off an explicit branch. */
  const handleWorktreeFromBranch = useCallback(
    (branch: string) => {
      if (!selectedConversationId) return;
      void setConversationWorkspace(selectedConversationId, {
        executionTarget: 'worktree',
        worktreeBaseBranch: branch,
      });
    },
    [selectedConversationId, setConversationWorkspace]
  );

  /*
    Built-in slash commands — control actions, never prompt text. Each one is a
    verb the app already knows; the grammar just gives it a keyboard-reachable
    name inside the composer.
  */
  const handleSlashAction = useEffectEvent((name: string, args?: string) => {
    const live = useAppStore.getState();
    const conversationId = live.selectedConversationId;
    switch (name) {
      case 'model':
        live.setModelPickerOpen(true);
        break;
      case 'review':
        openRightPanelSurface('diff');
        break;
      case 'fork':
        if (conversationId) void live.forkConversation(conversationId);
        break;
      case 'plan': {
        const current =
          live.conversations.find((conversation) => conversation.id === conversationId)
            ?.workspaceMode ?? DEFAULT_WORKSPACE_MODE;
        if (conversationId) {
          void live.setConversationWorkspace(conversationId, {
            mode: current === 'code' ? 'work' : 'code',
          });
        }
        break;
      }
      case 'compact':
        if (conversationId) {
          window.atlasChat.chat.compact(conversationId).catch(() => {});
          notify({
            tone: 'info',
            title: 'Compacting on next message',
            description: 'Older turns will be compressed when you send.',
          });
        }
        break;
      case 'goal': {
        if (!conversationId) break;
        const text = (args ?? '').trim();
        if (!text) {
          void live.loadGoal(conversationId);
          notify({ tone: 'info', title: '/goal', description: 'Usage: /goal <objective> · /goal pause · resume · clear' });
          break;
        }
        const sub = text.split(/\s+/)[0]?.toLowerCase();
        if (sub === 'pause') {
          void live.pauseGoal(conversationId);
        } else if (sub === 'resume') {
          void live.resumeGoal(conversationId);
        } else if (sub === 'clear') {
          void live.clearGoal(conversationId);
        } else if (sub === 'edit') {
          const replacement = text.slice(('edit'.length + 1)).trim();
          if (replacement) {
            // Edit mode: same goal row, counters kept — mirrors the dock's save.
            live.setGoal(conversationId, replacement, 'edit').catch((error) => {
              notifyError('/goal edit failed', error);
            });
          } else {
            notify({ tone: 'info', title: '/goal edit', description: 'Usage: /goal edit <new objective>' });
          }
        } else {
          void live.setGoal(conversationId, text);
          notify({ tone: 'info', title: 'Goal set', description: 'The agent keeps working toward it across turns. /goal pause stops the loop.' });
        }
        break;
      }
      case 'side':
        // One command, two jobs by state: nothing open → open the side chat
        // for this conversation; a pane is up → promote it into a real chat.
        if (live.sideChat?.parentId === conversationId) {
          void live.promoteSideChat();
        } else {
          void live.openSideChat();
        }
        break;
      default:
        break;
    }
  });
  const handleRemoveWorktree = useCallback(() => {
    if (!selectedConversationId) return;
    void removeConversationWorktree(selectedConversationId);
  }, [selectedConversationId, removeConversationWorktree]);
  /**
   * Put the files a turn edited back the way they were.
   *
   * Stored changes are matched by the tool call that wrote them rather than by
   * path: a file edited across three turns has three records, and undoing the
   * last of them must leave the other two standing. Reverting newest-first
   * means a file this turn touched twice lands on the content it had before
   * the turn began.
   *
   * The card owns the "Undone" state, so success is silent here — only the
   * outcomes the user cannot see from the transcript get a toast.
   */
  /*
    The transcript's row callbacks are `useCallback`-stable because `MessageRow`
    is memoised on them: recreated inline, every unrelated App render (a
    settings toggle, a sidebar rename) would invalidate every visible row.
  */
  const openWorkbenchReview = useCallback(() => {
    openRightPanelSurface('diff');
  }, [openRightPanelSurface]);
  const openWorkbenchAgents = useCallback(() => {
    openRightPanelSurface('agents');
  }, [openRightPanelSurface]);
  const handleRespondToolApproval = useCallback(
    (request: Parameters<typeof respondToolApproval>[0]) => respondToolApproval(request),
    [respondToolApproval]
  );
  const handleRetryLastMessage = useCallback(() => {
    void resendLastUserMessage();
  }, [resendLastUserMessage]);
  const handleLoadOlderMessages = useCallback(
    (conversationId: string) => loadOlderMessages(conversationId),
    [loadOlderMessages]
  );

  const handleUndoTurnEdits = useCallback(
    async (toolCallIds: string[]) => {
      const conversationId = selectedConversationId;
      const fileChanges = window.atlasChat?.fileChanges;

      if (!conversationId || !fileChanges) {
        throw new Error('This conversation has no recorded file changes.');
      }

      const wanted = new Set(toolCallIds);

      try {
        const records = await fileChanges.list(conversationId);
        const targets = records.filter(
          (record) =>
            record.status === 'pending' && record.toolCallId && wanted.has(record.toolCallId)
        );

        if (!targets.length) {
          notify({
            tone: 'info',
            title: 'Nothing to undo',
            description: 'These edits were already reverted, accepted, or made outside Atlas',
          });
          return;
        }

        for (const record of [...targets].reverse()) {
          await fileChanges.revert(conversationId, record.id);
        }
      } catch (error) {
        notifyError('Could not undo these edits', error);
        throw error;
      }
    },
    [selectedConversationId]
  );
  // What the main process detected about that folder — project type, framework,
  // configured env keys. Fetched, not derived: it comes from the filesystem.
  const { context: projectContext, refresh: refreshProjectContext } = useWorkspaceContext(
    selectedConversationId,
    activeProject?.id ?? null,
  );
  // With no conversation open there is nothing to write the rung onto, so it
  // becomes the preference every later conversation starts from.
  const handleToolPermissionModeChange = useCallback(
    (mode: ToolPermissionMode) => {
      if (selectedConversationId) {
        void setConversationToolPermissionMode(selectedConversationId, mode);
      } else {
        void updatePreferences({ chat: { toolPermissionMode: mode } });
      }
    },
    [selectedConversationId, setConversationToolPermissionMode, updatePreferences]
  );

  /**
   * Suggestions and gallery inserts append; they never discard typed text.
   *
   * Reads the draft through `getState()` rather than a subscription on purpose:
   * this component does not otherwise track the half-typed message (see the
   * note on the selector above, and `ChatComposerSlot`), and re-subscribing here
   * to serve an occasional insert would undo that.
   */
  const appendToComposer = useCallback(
    (text: string) => {
      if (!selectedConversationId) return;
      const current = useAppStore.getState().composerDraftsByConversation[selectedConversationId] ?? '';
      setComposerDraft(selectedConversationId, current.trim() ? `${current.replace(/\s+$/, '')}\n${text}` : text);
      requestComposerFocus();
    },
    [requestComposerFocus, selectedConversationId, setComposerDraft]
  );

  const handleQuoteInPrompt = useCallback(
    (text: string) => {
      if (!selectedConversationId) return;
      const quote = formatMarkdownQuote(text);
      if (!quote) return;
      const current = useAppStore.getState().composerDraftsByConversation[selectedConversationId] ?? '';
      setComposerDraft(selectedConversationId, current.trim() ? `${current.replace(/\s+$/, '')}\n\n${quote}` : quote);
      requestComposerFocus();
    },
    [requestComposerFocus, selectedConversationId, setComposerDraft]
  );

  const handleExplainSelection = useCallback(
    (text: string) => {
      if (!selectedConversationId) return;
      const prompt = formatExplainPrompt(text);
      if (!prompt) return;
      const current = useAppStore.getState().composerDraftsByConversation[selectedConversationId] ?? '';
      setComposerDraft(selectedConversationId, current.trim() ? `${current.replace(/\s+$/, '')}\n\n${prompt}` : prompt);
      requestComposerFocus();
    },
    [requestComposerFocus, selectedConversationId, setComposerDraft]
  );

  const handleCiteCitation = useCallback(
    (citation: AssistantCitation) => {
      if (!selectedConversationId) return '';
      const key = useAppStore.getState().addComposerCitation(selectedConversationId, citation);
      requestComposerFocus();
      return key;
    },
    [requestComposerFocus, selectedConversationId]
  );

  const handleCiteCommentChange = useCallback(
    (key: string, next: AssistantCitation) => {
      if (!selectedConversationId || !key) return;
      useAppStore.getState().updateComposerCitation(selectedConversationId, key, next);
    },
    [selectedConversationId]
  );

  const handleSearchInWorkspace = useCallback(
    (text: string) => {
      const query = sanitizeSearchQuery(text);
      if (!query) return;
      setModelPickerOpen(false);
      captureEvent(POSTHOG_EVENTS.COMMAND_PALETTE_OPENED);
      setCommandPaletteInitialQuery(query);
      setCommandPaletteOpen(true);
    },
    [captureEvent, setCommandPaletteInitialQuery, setCommandPaletteOpen, setModelPickerOpen]
  );
  const selectedModelSummary = useMemo(() => {
    if (!selectedModelId) return null;
    if (selectedProviderId) {
      const exact = models.find((m) => !m.archived && m.id === selectedModelId && m.providerId === selectedProviderId);
      if (exact) return exact;
    }
    const cands = models.filter((m) => m.id === selectedModelId);
    if (cands.length === 0) return null;
    const active = cands.filter((m) => !m.archived);
    const pool = active.length > 0 ? active : cands;
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) if (pool[i].providerId < best.providerId) best = pool[i];
    return best;
  }, [models, selectedModelId, selectedProviderId]);
  // `!== false`, not `Boolean(...)`: unknown means nobody has said, and the
  // request is allowed to carry tools until a provider refuses them.
  const hasModelTools = selectedModelSummary != null && selectedModelSummary.supportsTools !== false;
  const hasCredential = Boolean(settings?.providers.some((provider) => provider.hasSecret));
  const activeCredentialProvider = resolveProviderMetadata(
    activeCredentialProviderId,
    settings?.customProviders ?? []
  );
  const appearance = settings?.appearance ?? DEFAULT_SETTINGS_APPEARANCE;
  const themeMode = appearance.themeMode;
  const [livenessMap, setLivenessMap] = useState<Map<string, LivenessState>>(new Map());
  // Whole-window background-job rollups: sidebar rows, the bell, and ⌘⌥A all
  // project this one map, so no surface can disagree about liveness.
  const jobSummaries = useConversationJobSummaries();
  useEffect(() => {
    let cancelled = false;
    // The poll runs twice a second for the life of the window, so a broken
    // liveness channel would print thousands of identical lines. Reported once
    // per mount: enough to see it, quiet enough to keep the console usable.
    let reportedFailure = false;
    const fetchLiveness = async () => {
      try {
        const map = await window.atlasChat.subagents.getLiveness();
        if (cancelled) return;
        // Same reading as last time is the normal case for a poll this
        // frequent. Keeping the previous Map means no state change, so the
        // window stays still instead of re-rendering twice a second at rest.
        const next = new Map(Object.entries(map));
        setLivenessMap((previous) => (sameLivenessMap(previous, next) ? previous : next));
      } catch (error) {
        if (cancelled || reportedFailure) return;
        reportedFailure = true;
        console.warn('[liveness] poll failed; agent activity may look stale', error);
      }
    };
    void fetchLiveness();
    const unsub = window.atlasChat.chat.subscribe((event) => {
      if (event?.type === 'runtime-sync') void fetchLiveness();
    });
    const interval = setInterval(() => void fetchLiveness(), 2000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(interval);
    };
  }, []);

  /*
    `atlas://` deep links (t3code pattern): one subscription folds a route
    into whatever store actions already exist. Live reads via getState — the
    handler must not go stale on conversation switches.
  */
  useEffect(() => {
    const foldDeepLink = (link: AtlasDeepLink) => {
      const live = useAppStore.getState();
      switch (link.kind) {
        case 'chat':
          if (link.conversationId) {
            void live.loadConversation(link.conversationId);
            if (link.prompt) {
              live.setComposerDraft(link.conversationId, link.prompt);
            }
          } else if (link.prompt) {
            // createConversation resolves with the new summary; seed its draft
            // once, after the single create (never create twice per link).
            void live.createConversation().then((conversation) => {
              if (conversation) {
                useAppStore.getState().setComposerDraft(conversation.id, link.prompt!);
              }
            });
          } else {
            void live.createConversation();
          }
          break;
        case 'settings':
          // The grammar already rejects unknown sections; the cast narrows the
          // shared string type to the renderer's union.
          runViewTransition(() => openSettings((link.section ?? 'general') as Parameters<typeof openSettings>[0]));
          break;
        case 'plugins':
          live.openPlugins();
          break;
        case 'sites':
          if (!(live.settings?.sitesBetaEnabled ?? false)) break;
          live.openSites();
          break;
      }
    };
    // A link that arrived before this subscription existed (cold start) was
    // parked in main; pull it once so the first launch still lands.
    void window.atlasChat.deepLink?.consumePending?.().then((pending) => {
      if (pending) foldDeepLink(pending);
    });
    const off = window.atlasChat.deepLink?.onDeepLink(foldDeepLink);
    return off;
  }, []);

  /*
    /goal projections: bind the push channel once, and refresh the visible
    conversation's projection whenever the selection moves.
  */
  useEffect(() => {
    useAppStore.getState().bindGoalEvents();
  }, []);
  // Native image menu: main forwards the source, this side fetches the bytes
  // (only the renderer can read `blob:` URLs) and answers through images.copy.
  useEffect(() => {
    const off = window.atlasChat.images?.onCopyRequest?.((src) => {
      void copyImageSrc(src);
    });
    return off;
  }, []);
  // Native image menu, save half: same fetch, answered through images.save,
  // which shows the save dialog in the main process.
  useEffect(() => {
    const off = window.atlasChat.images?.onSaveRequest?.((src) => {
      void saveImageSrc(src);
    });
    return off;
  }, []);
  useEffect(() => {
    if (!selectedConversationId) return;
    void useAppStore.getState().loadGoal(selectedConversationId);
  }, [selectedConversationId]);

  const sidebarItems = useMemo(
    () =>
      buildSidebarConversationItems({
        conversations,
        draftsByConversation: draftSummaries,
        now: nowMs,
        livenessByConversation: livenessMap,
        jobSummariesByConversation: jobSummaries,
        unreadByConversation,
        queuedByConversation,
        goalsByConversation,
      }),
    [
      conversations,
      draftSummaries,
      nowMs,
      livenessMap,
      jobSummaries,
      unreadByConversation,
      queuedByConversation,
      goalsByConversation,
    ]
  );
  /**
   * Archived chats get the same row view model as live ones — they are the same
   * rows with different verbs, and building them a second way would drift.
   * The draft summary still applies: an archived chat keeps its in-memory
   * transcript, so a row can legitimately report the turn it was on.
   */
  const archivedSidebarItems = useMemo(
    () =>
      buildSidebarConversationItems({
        conversations: archivedConversations,
        draftsByConversation: draftSummaries,
        now: nowMs,
        livenessByConversation: livenessMap,
        unreadByConversation,
      }),
    [archivedConversations, draftSummaries, nowMs, livenessMap, unreadByConversation, goalsByConversation]
  );
  const hasArchivedChats = hasArchivedConversations({
    storedConversationCount: conversationStats?.storedConversationCount ?? null,
    liveConversationCount: conversations.length,
    archivedConversationCount: archivedConversations.length,
    hasLoadedArchived: hasLoadedArchivedConversations,
  });
  const archivedCount = resolveArchivedConversationsCount({
    storedConversationCount: conversationStats?.storedConversationCount ?? null,
    liveConversationCount: conversations.length,
    archivedConversationCount: archivedConversations.length,
    hasLoadedArchived: hasLoadedArchivedConversations,
  });
  const resolvedKeybindings = useMemo(
    () => {
      // An empty array is almost always a stub/test value; fall back to the
      // shipped defaults so the global shortcuts (Cmd+K, etc.) actually work.
      const userRules = settings?.keyboard.keybindings;
      const rules = userRules && userRules.length > 0 ? userRules : getDefaultKeybindingRules();
      return resolveKeybindingRules(rules);
    },
    [settings?.keyboard.keybindings]
  );
  const keybindingContext = useMemo(
    () => ({
      'view.chat': activeView === 'chat',
      'view.settings': activeView === 'settings',
      'commandPalette.open': commandPaletteOpen,
      'modelPicker.open': modelPickerOpen,
      'composer.focus': composerFocused
    }),
    [activeView, commandPaletteOpen, composerFocused, modelPickerOpen]
  );
  const settingsShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(resolvedKeybindings, 'settings.open', {
        context: keybindingContext,
        platform: shortcutPlatform
      }),
    [keybindingContext, resolvedKeybindings, shortcutPlatform]
  );
  const newChatShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(resolvedKeybindings, 'chat.new', {
        context: keybindingContext,
        platform: shortcutPlatform
      }),
    [keybindingContext, resolvedKeybindings, shortcutPlatform]
  );
  const sidebarToggleShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(resolvedKeybindings, 'sidebar.toggle', {
        context: keybindingContext,
        platform: shortcutPlatform
      }),
    [keybindingContext, resolvedKeybindings, shortcutPlatform]
  );
  const conversationJumpLabelById = useMemo(() => {
    const next = new Map<string, string>();
    for (let index = 0; index < Math.min(sidebarItems.length, 9); index += 1) {
      const item = sidebarItems[index];
      if (!item) {
        continue;
      }

      const label = shortcutLabelForCommand(resolvedKeybindings, `conversation.jump.${index + 1}` as KeybindingCommand, {
        context: keybindingContext,
        platform: shortcutPlatform
      });

      if (label) {
        next.set(item.id, label);
      }
    }

    return next;
  }, [keybindingContext, resolvedKeybindings, shortcutPlatform, sidebarItems]);
  const commandPaletteItems = useMemo(
    () =>
      APP_COMMAND_DEFINITIONS.filter((definition) => definition.showInCommandPalette !== false).map((definition) => ({
        command: definition.command,
        description: definition.description,
        disabled:
          ((definition.command === 'sidebar.toggle' || definition.command === 'terminal.toggle') &&
            activeView !== 'chat') ||
          (definition.command === 'models.openSwitcher' && (activeView !== 'chat' || !selectedConversationId || isActiveDraftStreaming)) ||
          ((definition.command === 'conversation.previous' || definition.command === 'conversation.next') &&
            !selectedConversationId) ||
          ((definition.command === 'workspace.mode.toggle' || definition.command === 'workspace.project.attach') &&
            (activeView !== 'chat' || !selectedConversationId)) ||
          (definition.command === 'plugins.open' && !(settings?.pluginsBetaEnabled ?? false)),
        section: definition.section,
        shortcutLabel: shortcutLabelForCommand(resolvedKeybindings, definition.command, {
          context: keybindingContext,
          platform: shortcutPlatform
        }),
        title: definition.title,
        // Synonyms ("hide sidebar", "new conversation", …) so the palette
        // matches what people type, not only the command's own wording.
        keywords: definition.keywords,
      })),
    [isActiveDraftStreaming, activeView, keybindingContext, resolvedKeybindings, selectedConversationId, shortcutPlatform]
  );
  /**
   * The sidebar's "Search" row opens the palette, so the palette has to offer
   * chats — every one of them, because cmdk can only match what it renders.
   * The palette itself trims the *resting* list to a handful so the launcher
   * does not open as a second sidebar; typing searches the lot.
   */
  const commandPaletteConversations = useMemo(
    () =>
      sidebarItems.map((item) => ({
        id: item.id,
        title: item.primaryLabel || 'Untitled chat',
        timestampLabel: item.timestampLabel,
      })),
    [sidebarItems]
  );

  const onStreamEvent = useEffectEvent((event: StreamEvent) => {
    void handleStreamEvent(event);
  });

  const onUpdateState = useEffectEvent((snapshot: AppUpdateSnapshot) => {
    setUpdateState(snapshot);
  });

  const runCommand = useEffectEvent((command: KeybindingCommand) => {
    // Read live store values at call time so the keyboard handler never sees stale state.
    // (useEffectEvent only guarantees a stable reference, not live reads of these props.)
    const live = useAppStore.getState();
    const livePaletteOpen = live.commandPaletteOpen;
    const liveModelPickerOpen = live.modelPickerOpen;
    const liveActiveView = live.activeView;
    const liveSelectedConversationId = live.selectedConversationId;
    const liveActiveDraft = liveSelectedConversationId ? live.draftsByConversation[liveSelectedConversationId] ?? null : null;

    if (command === 'app.commandPalette.toggle') {
      live.setModelPickerOpen(false);
      if (!livePaletteOpen) {
        // Normal open, not search-in-workspace: drop any stale selection query
        // left behind (e.g. palette closed via a store path that bypassed
        // onOpenChange before the close-clearing fix).
        live.setCommandPaletteInitialQuery(null);
        captureEvent(POSTHOG_EVENTS.COMMAND_PALETTE_OPENED);
      }
      live.setCommandPaletteOpen(!livePaletteOpen);
      return;
    }

    if (command === 'chat.new') {
      live.setCommandPaletteOpen(false);
      live.setModelPickerOpen(false);
      captureEvent(POSTHOG_EVENTS.CONVERSATION_CREATED);
      void live.createConversation();
      return;
    }

    if (command === 'sidebar.toggle') {
      if (liveActiveView !== 'chat') {
        return;
      }

      live.setCommandPaletteOpen(false);
      runViewTransition(() => {
        setSidebarCollapsed((current) => !current);
      });
      return;
    }

    if (command === 'workspace.mode.toggle') {
      live.setCommandPaletteOpen(false);
      if (liveActiveView !== 'chat' || !liveSelectedConversationId) {
        return;
      }

      const current =
        live.conversations.find((conversation) => conversation.id === liveSelectedConversationId)?.workspaceMode ??
        DEFAULT_WORKSPACE_MODE;
      const next = current === 'code' ? 'work' : 'code';
      captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'workspaceMode', value: next });
      void live.setConversationWorkspace(liveSelectedConversationId, { mode: next });
      if (next === 'code') {
        showRightPanel();
        // The shortcut is the same switch, so it owes the same prompt.
        const summary = live.conversations.find((conversation) => conversation.id === liveSelectedConversationId) ?? null;
        const project = summary?.projectId
          ? live.projects.find((entry) => entry.id === summary.projectId) ?? null
          : null;
        if (shouldPromptForProject('code', project)) {
          void requestProjectForConversation(liveSelectedConversationId, 'mode-switch');
        }
      }
      return;
    }

    if (command === 'terminal.toggle') {
      live.setCommandPaletteOpen(false);
      if (liveActiveView !== 'chat') {
        return;
      }

      setTerminalOpen((current) => !current);
      return;
    }

    if (command === 'workbench.review.open') {
      live.setCommandPaletteOpen(false);
      if (liveActiveView !== 'chat') {
        return;
      }

      openRightPanelSurface('diff');
      return;
    }

    if (command === 'chat.side.toggle') {
      live.setCommandPaletteOpen(false);
      if (liveActiveView !== 'chat') {
        return;
      }

      // Open when closed, close when open — the pane is the state.
      if (live.sideChat) {
        live.closeSideChat();
      } else {
        void live.openSideChat();
      }
      return;
    }

    if (command === 'transcript.raw.toggle') {
      live.setCommandPaletteOpen(false);
      // Persisted rather than held in component state: a reader who turned the
      // transcript raw to copy something out of it did not ask for it back
      // the next time the app starts.
      const next = !(live.settings?.appearance.rawTranscript ?? false);
      captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'rawTranscript', value: next });
      void live.updatePreferences({ appearance: { rawTranscript: next } });
      return;
    }

    if (command === 'workspace.project.attach') {
      live.setCommandPaletteOpen(false);
      if (liveActiveView !== 'chat') {
        return;
      }

      void live.attachProject({ conversationId: liveSelectedConversationId ?? undefined });
      return;
    }

    if (command === 'settings.open') {
      live.setCommandPaletteOpen(false);
      captureEvent(POSTHOG_EVENTS.SETTINGS_OPENED);
      runViewTransition(() => {
        live.openSettings('general');
      });
      return;
    }

    if (command === 'plugins.open') {
      if (!(settings?.pluginsBetaEnabled ?? false)) {
        return;
      }
      live.setCommandPaletteOpen(false);
      runViewTransition(() => {
        live.openPlugins();
      });
      return;
    }

    if (command === 'composer.focus') {
      // Close first: the palette's FocusScope returns focus to its trigger on
      // unmount, so focusing the composer in the same tick is undone at once.
      live.setCommandPaletteOpen(false);
      requestAnimationFrame(() => {
        live.requestComposerFocus();
      });
      return;
    }

    if (command === 'models.openSwitcher') {
      if (liveActiveView !== 'chat' || !liveSelectedConversationId || liveActiveDraft?.status === 'streaming') {
        return;
      }

      live.setCommandPaletteOpen(false);
      live.setModelPickerOpen(!liveModelPickerOpen);
      return;
    }

    if (command === 'conversation.previous') {
      live.setCommandPaletteOpen(false);
      live.setModelPickerOpen(false);
      void live.selectAdjacentConversation('previous');
      return;
    }

    if (command === 'conversation.next') {
      live.setCommandPaletteOpen(false);
      live.setModelPickerOpen(false);
      void live.selectAdjacentConversation('next');
      return;
    }

    if (command === 'conversation.nextAttention') {
      live.setCommandPaletteOpen(false);
      live.setModelPickerOpen(false);
      const attentionItems = live.conversations.map((conversation) => {
        const draft = live.draftsByConversation[conversation.id];
        return {
          id: conversation.id,
          level: deriveAttentionState({
            draftStatus: draft?.status,
            hasPendingApproval: hasPendingApprovalInParts(draft?.parts),
            backgroundLiveness: livenessMap.get(conversation.id) ?? null,
            backgroundJobsLive: liveJobCountFor(jobSummaries, conversation.id),
            conversationStatus: conversation.status,
            queuedFollowups: live.queuedByConversation[conversation.id]?.length ?? 0,
            unreadCount: live.unreadByConversation[conversation.id] ?? 0,
            hasActiveGoal: live.goalsByConversation[conversation.id]?.status === 'active',
          }),
          timestampMs: Date.parse(conversation.updatedAt) || null,
        };
      });
      const targetId = pickNextAttentionConversation(attentionItems, live.selectedConversationId);
      if (targetId) {
        void live.loadConversation(targetId);
      }
      return;
    }

    if (command.startsWith('conversation.jump.')) {
      const index = Number(command.split('.').at(-1));
      if (Number.isFinite(index) && index >= 1) {
        live.setCommandPaletteOpen(false);
        live.setModelPickerOpen(false);
        void live.selectConversationByIndex(index - 1);
      }
    }
  });

  useEffect(() => {
    void bootstrap();
    void identifyUser();
    void syncTelemetryStatus().then(setTelemetryEnabledState);
  }, [bootstrap]);

  useEffect(() => prewarmMessageRendering(), []);

  useEffect(() => {
    const unsubscribe = window.atlasChat.chat.subscribe((event) => {
      onStreamEvent(event);
    });
    return unsubscribe;
  }, [onStreamEvent]);

  useEffect(() => {
    const unsubscribe = window.atlasChat.updates.subscribe((snapshot) => {
      onUpdateState(snapshot);
    });
    return unsubscribe;
  }, [onUpdateState]);

  // The startup backfill can enrich the model catalog after this window has
  // already loaded its list; re-read from cache when the main process says so.
  useEffect(() => {
    const unsubscribe = window.atlasChat.models.subscribe(() => {
      void useAppStore.getState().reloadModels();
    });
    return unsubscribe;
  }, []);

  // Onboarding opens when there is no credential and closes only by user
  // action. It deliberately does *not* auto-close the moment a key lands:
  // `OnboardingFlow` swaps to its "You're all set" screen on `hasCredential`,
  // and unmounting on that same signal meant nobody ever saw it.
  useEffect(() => {
    if (initialized && !hasCredential) {
      setShowOnboarding(true);
    }
  }, [initialized, hasCredential]);

  useEffect(() => {
    if (onboardingDone && hasCredential) {
      void refreshModels();
      setOnboardingDone(false);
    }
  }, [onboardingDone, hasCredential, refreshModels]);

  /*
   * Settings is reachable from onboarding *and* straight past it (the
   * `settings.open` keybinding works while onboarding is up). Coming back
   * from the latter used to drop the user on a stale "You're all set" screen,
   * because `showOnboarding` was never cleared. Only the onboarding-initiated
   * visit still owns that screen.
   *
   * That visit has to *restore* onboarding to show it: opening Settings from
   * the "Add a provider" button unmounts the flow. Without this, the completion
   * screen was unreachable by any path — the user configured a provider and was
   * dropped straight into an empty chat with no confirmation that the thing
   * they had just been asked to do had worked, and `ONBOARDING_COMPLETED` never
   * fired for the only route that actually completes onboarding.
   */
  useEffect(() => {
    const isSettings = activeView === 'settings';
    const leftSettings = wasSettingsViewRef.current && !isSettings;
    wasSettingsViewRef.current = isSettings;

    if (!leftSettings) {
      return;
    }

    const requestedByOnboarding = onboardingRequestedSettingsRef.current;
    onboardingRequestedSettingsRef.current = false;

    if (requestedByOnboarding) {
      // Only on success: leaving Settings without a credential means the user
      // backed out, and re-showing the flow they just left would trap them.
      if (hasCredential) {
        setShowOnboarding(true);
      }
      return;
    }

    if (hasCredential) {
      setShowOnboarding(false);
    }
  }, [activeView, hasCredential]);

  const lastAppliedThemeSignatureRef = useRef<string>('');
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = resolveAppliedThemeMode(themeMode, appearance.designTheme, mediaQuery.matches);
      const effectiveThemeId = resolveEffectiveTheme(appearance.themeId, resolved, appearance.themeHalves);
      const translucent = appearance.translucentSidebar && isMacLike;
      const signature = `${themeMode}|${appearance.designTheme}|${effectiveThemeId}|${resolved}|${translucent}|${appearance.glassOpacity ?? 100}`;
      if (lastAppliedThemeSignatureRef.current === signature) return;
      lastAppliedThemeSignatureRef.current = signature;

      persistCachedTheme(themeMode, appearance.designTheme, effectiveThemeId);
      const root = document.documentElement;
      root.classList.add('no-transitions');
      root.dataset.designTheme = appearance.designTheme;
      root.dataset.theme = resolved;
      root.classList.toggle('dark', resolved === 'dark');
      root.style.colorScheme = resolved;
      applyThemePalette(effectiveThemeId, resolved);
      if (typeof appearance.glassOpacity === 'number') {
        root.style.setProperty('--glass-opacity', `${appearance.glassOpacity}%`);
      }
      void root.offsetHeight;
      requestAnimationFrame(() => root.classList.remove('no-transitions'));
      syncBrowserChromeTheme({ translucent });
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_MODE_STORAGE_KEY || event.key === DESIGN_THEME_STORAGE_KEY || event.key === THEME_ID_STORAGE_KEY) {
        lastAppliedThemeSignatureRef.current = '';
        applyTheme();
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
      window.removeEventListener('storage', handleStorage);
    };
  }, [themeMode, appearance.designTheme, appearance.themeId, appearance.themeHalves, appearance.glassOpacity, appearance.translucentSidebar, isMacLike]);

  useEffect(() => {
    document.documentElement.dataset.borderRadius = appearance.borderRadius;
  }, [appearance.borderRadius]);

  // Color overrides ride on top of the design theme as inline custom
  // properties; removing an override falls straight back to the theme value.
  // Contrast numbers stamp alongside (the ladder answers them live), and the
  // ladder gate tells the per-surface twins in styles.css when a derivation
  // exists — neutral ships render exactly as authored.
  const appliedOverrideKeysRef = useRef<string[]>([]);
  useEffect(() => {
    const root = document.documentElement;
    const overrides = buildThemeOverrides(appearance);

    for (const key of appliedOverrideKeysRef.current) {
      if (!(key in overrides)) {
        root.style.removeProperty(key);
      }
    }

    for (const [key, value] of Object.entries(overrides)) {
      root.style.setProperty(key, value);
    }

    appliedOverrideKeysRef.current = Object.keys(overrides);
    applyAppearanceContrast(root, appearance.contrast);
    root.dataset.contrastLadder = '--text-secondary' in overrides ? 'on' : 'off';
    // Read-back after the stamp above: getComputedStyle forces a sync
    // recalculation, so the frame follows the page in the same task.
    syncBrowserChromeTheme({ translucent: appearance.translucentSidebar && isMacLike });
  }, [appearance]);

  // Vibrancy is a macOS window material. Off macOS the window stays opaque, so
  // a see-through sidebar would blend into a hardcoded window colour instead of
  // the desktop — the setting is stored but never stamped there. The stamp also
  // mirrors to localStorage, which main.tsx reads synchronously on the next
  // launch so the first frame is already glass.
  useEffect(() => {
    stampTranslucentSidebar(appearance.translucentSidebar && isMacLike);
  }, [appearance.translucentSidebar]);

  useEffect(() => {
    document.documentElement.dataset.pointerCursors = appearance.pointerCursors ? 'true' : 'false';
  }, [appearance.pointerCursors]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const reduced = appearance.reduceMotion === 'on' || (appearance.reduceMotion === 'system' && mediaQuery.matches);
      document.documentElement.dataset.reduceMotion = reduced ? 'true' : 'false';
    };

    apply();
    mediaQuery.addEventListener('change', apply);
    return () => mediaQuery.removeEventListener('change', apply);
  }, [appearance.reduceMotion]);

  useEffect(() => {
    applyAppearanceFontVariables(document.documentElement, appearance);
    persistCachedFonts({
      panelAnimationDurationMs: appearance.panelAnimationDurationMs,
      fontFamilySans: appearance.fontFamilySans,
      fontFamilyComposer: appearance.fontFamilyComposer,
      fontFamilyCode: appearance.fontFamilyCode,
      fontFamilyTerminal: appearance.fontFamilyTerminal,
      fontSizeInterface: appearance.fontSizeInterface,
      fontSizePrompt: appearance.fontSizePrompt,
      fontSizeCode: appearance.fontSizeCode,
      fontSizeTerminal: appearance.fontSizeTerminal,
      fontSmoothing: appearance.fontSmoothing,
    });
  }, [
    appearance.panelAnimationDurationMs,
    appearance.fontFamilySans,
    appearance.fontFamilyComposer,
    appearance.fontFamilyCode,
    appearance.fontFamilyTerminal,
    appearance.fontSizeInterface,
    appearance.fontSizePrompt,
    appearance.fontSizeCode,
    appearance.fontSizeTerminal,
    appearance.fontSmoothing,
    appearance.codeFontFamily,
    appearance.codeFontSize,
    appearance.uiFontFamily,
    appearance.uiFontSize,
  ]);

  /*
    The activity log is rewritten on every stream flush (a text delta folds
    into a `message.*` entry), so subscribing to the log here put App on the
    token path. All App does with it is notice when the first agent starts, so
    it subscribes to that count instead — a number, which holds still between
    the events that actually matter.
  */
  const runningAgentsCount = useAppStore((state) =>
    countRunningAgents(
      selectedConversationId ? state.activitiesByConversation[selectedConversationId] : undefined
    )
  );

  const prevRunningAgentsCountRef = useRef(0);
  useEffect(() => {
    if (runningAgentsCount > 0 && prevRunningAgentsCountRef.current === 0) {
      openRightPanelSurface('agents');
    }
    prevRunningAgentsCountRef.current = runningAgentsCount;
  }, [openRightPanelSurface, runningAgentsCount]);

  // Badges (⌘B / ⌘N / ⌘1-9) appear only while the modifier is held, and only
  // after a short hold so a quick ⌘K / ⌘S never flashes the whole sidebar.
  const shortcutHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shortcutHintsVisibleRef = useRef(false);

  useEffect(() => {
    const clearShortcutHintTimer = () => {
      if (shortcutHintTimerRef.current) {
        clearTimeout(shortcutHintTimerRef.current);
        shortcutHintTimerRef.current = null;
      }
    };

    const hideShortcutHints = () => {
      clearShortcutHintTimer();
      shortcutHintsVisibleRef.current = false;
      setShowConversationJumpHints(false);
      setShowNewChatShortcutHint(false);
      setShowSidebarToggleShortcutHint(false);
    };

    const scheduleShortcutHints = (wantsJump: boolean, wantsNewChat: boolean, wantsToggle: boolean) => {
      if (!wantsJump && !wantsNewChat && !wantsToggle) {
        hideShortcutHints();
        return;
      }
      // Already on screen: sync immediately (covers keybinding/context swaps mid-hold).
      if (shortcutHintsVisibleRef.current) {
        setShowConversationJumpHints(wantsJump);
        setShowNewChatShortcutHint(wantsNewChat);
        setShowSidebarToggleShortcutHint(wantsToggle);
        return;
      }
      // A hold fires repeat keydowns; one pending timer is enough.
      if (shortcutHintTimerRef.current) {
        return;
      }
      shortcutHintTimerRef.current = setTimeout(() => {
        shortcutHintTimerRef.current = null;
        shortcutHintsVisibleRef.current = true;
        setShowConversationJumpHints(wantsJump);
        setShowNewChatShortcutHint(wantsNewChat);
        setShowSidebarToggleShortcutHint(wantsToggle);
      }, SIDEBAR_SHORTCUT_HINT_DELAY_MS);
    };

    const readHintWants = (event: KeyboardEvent) => ({
      jump: shouldShowConversationJumpHints(event, resolvedKeybindings, {
        context: keybindingContext,
        platform: shortcutPlatform
      }),
      newChat: shouldShowShortcutHintForCommand(event, resolvedKeybindings, 'chat.new', {
        context: keybindingContext,
        platform: shortcutPlatform
      }),
      toggle: shouldShowShortcutHintForCommand(event, resolvedKeybindings, 'sidebar.toggle', {
        context: keybindingContext,
        platform: shortcutPlatform
      })
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const wants = readHintWants(event);
      scheduleShortcutHints(wants.jump, wants.newChat, wants.toggle);

      const command = resolveShortcutCommand(event, resolvedKeybindings, {
        context: keybindingContext,
        platform: shortcutPlatform
      });

      if (!command) {
        return;
      }

      const definition = APP_COMMANDS_BY_ID[command];
      if (isEditableTarget(event.target) && !definition.allowWhileEditable) {
        return;
      }

      event.preventDefault();
      runCommand(command);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const wants = readHintWants(event);
      scheduleShortcutHints(wants.jump, wants.newChat, wants.toggle);
    };

    const onWindowBlur = () => {
      hideShortcutHints();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      clearShortcutHintTimer();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [keybindingContext, resolvedKeybindings, runCommand, shortcutPlatform]);

  if (bootstrapping) return <LoadingScreen />;
  if (!initialized || bootstrapError) {
    return <ErrorScreen message={bootstrapError ?? 'Unknown error'} onRetry={() => void bootstrap()} />;
  }

  const content =
    activeView === 'landing' ? (
      <XAILandingPage onBackToApp={() => closeLanding()} />
    ) : activeView === 'sites' && (settings?.sitesBetaEnabled ?? false) ? (
      <SitesWorkspace onBack={() => runViewTransition(() => closeSites())} />
    ) : activeView === 'settings' ? (
      <SettingsWorkspaceRoute
        settings={settings}
        updateState={updateState}
        usageInputs={{
          settings,
          conversationPages: settingsConversationPages,
          conversationStats,
          diagnostics,
          rendererHeapBytes: diagnosticsSummary.rendererHeapBytes,
        }}
        isRefreshingModels={isRefreshingModels}
        activeSection={settingsSection}
        shortcutPlatform={shortcutPlatform}
        onBack={() => runViewTransition(() => closeSettings())}
        onNavigate={setSettingsSection}
        onThemeModeChange={(mode) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'themeMode', value: mode });
          void updatePreferences({ appearance: { themeMode: mode } });
        }}
        onDesignThemeChange={(theme) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'designTheme', value: theme });
          // Switching to a theme with no light palette while Light is selected
          // would leave the picker claiming a mode the app cannot paint, so the
          // stored preference moves with it rather than being silently ignored.
          const clampsLight = themeMode === 'light' && !designThemeSupportsLight(theme);
          void updatePreferences({
            appearance: clampsLight
              ? { designTheme: theme, themeMode: 'dark' }
              : { designTheme: theme },
          });
        }}
        onBorderRadiusChange={(mode) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'borderRadius', value: mode });
          void updatePreferences({ appearance: { borderRadius: mode } });
        }}
        onUiFontSizeChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'uiFontSize', value });
          void updatePreferences({ appearance: { uiFontSize: value } });
        }}
        onCodeFontSizeChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'codeFontSize', value });
          void updatePreferences({ appearance: { codeFontSize: value } });
        }}
        onUiFontFamilyChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'uiFontFamily', value });
          void updatePreferences({ appearance: { uiFontFamily: value } });
        }}
        onCodeFontFamilyChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'codeFontFamily', value });
          void updatePreferences({ appearance: { codeFontFamily: value } });
        }}
        onAppearancePatch={(patch) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: Object.keys(patch).join(',') });
          void updatePreferences({ appearance: patch });
        }}
        onUpdateKeybindings={(rules) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'keybindings' });
          void updatePreferences({ keyboard: { keybindings: rules } });
        }}
        onToggleFreeModels={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'showFreeOnlyByDefault', value });
          void updatePreferences({ showFreeOnlyByDefault: value });
        }}
        onVisualModeChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'visualMode', value });
          void updatePreferences({ chat: { visualMode: value } });
        }}
        onUpdateAction={() => {
          if (updateState.status === 'available' || updateState.status === 'downloaded') {
            void performUpdatePrimaryAction();
            return;
          }

          void checkForUpdates({ manual: true });
        }}
        onRefreshModels={() => void refreshModels()}
        telemetryEnabled={telemetryEnabled}
        onTelemetryChange={(value) => {
          setTelemetryEnabledState(value);
          void setRendererTelemetryEnabled(value);
        }}
        onUpdatePreferences={updatePreferences}
      />
    ) : showOnboarding ? (
      <OnboardingFlow
        hasCredential={hasCredential}
        onOpenProviderSettings={() => {
          onboardingRequestedSettingsRef.current = true;
          setShowOnboarding(false);
          setOnboardingDone(true);
          runViewTransition(() => openSettings('providers'));
        }}
        onContinue={() => {
          captureEvent(POSTHOG_EVENTS.ONBOARDING_COMPLETED);
          setShowOnboarding(false);
          setOnboardingDone(true);
        }}
      />
    ) : (
      <div className="app-shell flex h-screen overflow-hidden bg-bg-base">
        <Sidebar
          items={sidebarItems}
          archivedItems={archivedSidebarItems}
          hasArchivedChats={hasArchivedChats}
          archivedCount={archivedCount}
          isLoadingArchivedChats={isLoadingArchivedConversations}
          projects={projects}
          selectedConversationId={selectedConversationId}
          collapsed={sidebarCollapsed}
          settings={settings}
          updateState={updateState}
          isRefreshingModels={isRefreshingModels}
          conversationStats={conversationStats}
          loadedMessageCount={loadedMetrics.loadedMessageCount}
          newChatShortcutLabel={newChatShortcutLabel}
          showNewChatShortcutHint={showNewChatShortcutHint}
          sidebarToggleShortcutLabel={sidebarToggleShortcutLabel}
          showSidebarToggleShortcutHint={showSidebarToggleShortcutHint}
          settingsShortcutLabel={settingsShortcutLabel}
          showConversationJumpHints={showConversationJumpHints}
          conversationJumpLabelById={conversationJumpLabelById}
          onSelect={(id) => void loadConversation(id)}
          onCreate={handleCreateConversation}
          onDelete={(id) => void deleteConversation(id)}
          onRename={(id, title) => void renameConversation(id, title)}
          onRegenerateTitle={(id) => void regenerateConversationTitle(id)}
          onMarkUnread={(id) => markConversationUnread(id)}
          onMarkRead={(id) => markConversationRead(id)}
          onOpenSettings={(section) => runViewTransition(() => openSettings(section))}
          onAttachProject={() => {
            void attachProject();
          }}
          onCreateInProject={(projectId) => void createConversationInProject(projectId)}
          onRevealProject={(projectId) => void window.atlasChat.projects.reveal(projectId)}
          onDetachProject={(projectId) => void detachProject(projectId)}
          onRenameProject={(projectId, title) => void renameProject(projectId, title)}
          onForkConversation={(id) => void forkConversation(id)}
          onSetConversationPinned={(id, pinned) => void setConversationPinned(id, pinned)}
          onArchiveConversation={(id) => void setConversationArchived(id, true)}
          onSetConversationSettled={(id, settled) => void setConversationSettled(id, settled)}
          onSetConversationSnoozed={(id, snoozedUntil) => void setConversationSnoozed(id, snoozedUntil)}
          onRestoreConversation={(id) => void setConversationArchived(id, false)}
          onLoadArchivedChats={() => void loadArchivedConversations()}
          onSetProjectPinned={(projectId, pinned) => void setProjectPinned(projectId, pinned)}
          onOpenLanding={() => openLanding()}
          workspaceMode={workspaceMode}
          onOpenSites={() => {
            if (!(settings?.sitesBetaEnabled ?? false)) return;
            runViewTransition(() => openSites());
          }}
          onOpenPlugins={() => runViewTransition(() => openPlugins())}
          showSites={settings?.sitesBetaEnabled ?? false}
          showPlugins={settings?.pluginsBetaEnabled ?? false}
          onOpenSearch={() => {
            setModelPickerOpen(false);
            setCommandPaletteInitialQuery(null);
            captureEvent(POSTHOG_EVENTS.COMMAND_PALETTE_OPENED);
            setCommandPaletteOpen(true);
          }}
          onRefreshModels={() => void refreshModels()}
          onCheckForUpdates={() => void checkForUpdates({ manual: true })}
          onToggleCollapsed={() => runViewTransition(() => setSidebarCollapsed(!sidebarCollapsed))}
          modeSwitcher={
            <WorkspaceModeSwitch
              mode={workspaceMode}
              ready={workspaceReady}
              disabled={!selectedConversationId}
              variant="heading"
              permissionMode={toolPermissionMode}
              permissionDisabled={isActiveDraftStreaming}
              onChange={handleWorkspaceModeChange}
              onPermissionModeChange={handleToolPermissionModeChange}
              onRequestProject={
                selectedConversationId
                  ? () => void requestProjectForConversation(selectedConversationId, 'mode-menu')
                  : undefined
              }
            />
          }
          width={sidebarResize.width}
          translucent={appearance.translucentSidebar && isMacLike}
        />

        {/* Resizing is meaningless while the rail is collapsed. */}
        {!sidebarCollapsed && (
          <PanelResizeHandle
            ariaLabel="Resize sidebar"
            isResizing={sidebarResize.isResizing}
          width={solvedColumns.sidebar}
            minWidth={sidebarResize.minWidth}
            maxWidth={sidebarResize.maxWidth}
            onPointerDown={sidebarResize.onPointerDown}
            onKeyDown={sidebarResize.onKeyDown}
            onReset={sidebarResize.reset}
          />
        )}

        <div
          className={`relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base`}
          style={{ viewTransitionName: 'app-main-panel' }}
        >
          {/*
            Plugins takes the content pane rather than the window. Browsing a
            catalogue is not a modal errand — you look something up and go back
            to what you were doing — and the sidebar is how you get back, so
            covering it would strand the user with no way out but a button.

            The chat is swapped out rather than covered. An overlay left the
            composer mounted underneath at the same z-index, so it painted over
            the catalogue and stayed focusable behind it; stacking order is the
            wrong tool for "this view is not the chat".
          */}
          {/* The beta switch is checked here as well as in the sidebar: a
              window sitting on the plugins view while the flag turns off falls
              back to the chat rather than squatting on a hidden feature. */}
          {activeView === 'plugins' && (settings?.pluginsBetaEnabled ?? false) ? (
            <PluginsWorkspace />
          ) : (
            <>
          {/*
            Draggable title bar — matches the sidebar title bar height and is
            borderless per the Codex reference: thread title on the left, panel
            toggles on the right. The mode switcher used to sit centred here;
            it now heads the sidebar, where Codex keeps it.

            Drag regions: `no-drag` belongs on the *controls*, never on the
            grid cells. The first cell is `1fr` and spans most of the bar, so
            exempting it left only the `px-5` slivers draggable and killed
            macOS double-click-to-zoom.
          */}
          <div
            className={cn(
              'titlebar-overlay-safe relative grid h-titlebar-height shrink-0 grid-cols-[1fr_auto] items-center gap-3 px-5',
              // With the 56px collapsed rail, macOS traffic lights (x:16, ~70px
              // wide) end ~30px into this bar; inset the title clear of them.
              // Fullscreen hides the lights, so the inset would be dead space.
              sidebarCollapsed && isMacLike && !isFullScreen && 'pl-12'
            )}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            {/* Title + streaming badge are inert text: they drag the window.
                The back/forward pair before them is the session's conversation
                history — the same controls the Codex titlebar carries. */}
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => navigateConversationHistory(-1)}
                      disabled={!canNavigateBack}
                      aria-label="Go back"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      className="flex size-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Back</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => navigateConversationHistory(1)}
                      disabled={!canNavigateForward}
                      aria-label="Go forward"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      className="flex size-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Forward</TooltipContent>
                </Tooltip>
              </div>
              {activeConversationTitle ? (
                <h2 className="flex min-w-0 items-center gap-1.5 truncate text-md">
                  {activeProject ? (
                    <>
                      <span className="shrink-0 truncate font-normal text-text-tertiary">
                        {activeProject.title}
                      </span>
                      <span aria-hidden className="shrink-0 font-normal text-text-faint">
                        /
                      </span>
                    </>
                  ) : null}
                  <span className="truncate font-medium text-text-primary">
                    {activeConversationTitle}
                  </span>
                </h2>
              ) : null}
              {isActiveDraftStreaming ? (
                <span
                  className="inline-flex items-center gap-1.5 text-2xs text-text-muted"
                  role="status"
                  aria-live="polite"
                >
                  <span className="relative flex h-1.5 w-1.5">
                    {/* `animate-status-ping`, not `animate-ping`: the latter
                        interpolates continuously and so presents a frame every
                        vsync for the whole streaming turn. Its starting opacity
                        lives in the keyframe, which is why no `opacity-*`
                        utility rides along here — it would be overridden. */}
                    <span className="absolute inline-flex h-full w-full animate-status-ping rounded-full bg-text-muted" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-text-secondary" />
                  </span>
                  Streaming
                </span>
              ) : null}
            </div>

            {/* The cell is `1fr` wide but its contents are not: each control
                carries its own `no-drag`, so the empty run beside them drags. */}
            <div className="flex shrink-0 items-center justify-end gap-1">
              {/*
                Leftmost of the three: it acts on the conversation's folder,
                while the two beside it act on this window's panels.
              */}
              <OpenInIdeButton mode={workspaceMode} project={activeProject} />
              <TerminalToggle
                open={terminalOpen}
                onToggle={setTerminalOpen}
                shortcutLabel={shortcutLabelForCommand(resolvedKeybindings, 'terminal.toggle', {
                  context: keybindingContext,
                  platform: shortcutPlatform,
                })}
              />
              <WorkbenchToggle
                open={workbenchOpen}
                liveAgentCount={
                  workbenchOpen &&
                  rightPanel.surfaces.find((surface) => surface.id === rightPanel.activeSurfaceId)
                    ?.kind === 'agents'
                    ? 0
                    : runningAgentsCount
                }
                onToggle={() => {
                  if (!panelConversationId) return;
                  useRightPanelStore.getState().togglePanel(panelConversationId);
                }}
              />
            </div>
          </div>

          {/*
            Transcript and composer share one box, and the composer floats at
            the bottom of it.

            They used to be stacked siblings, which meant the transcript's
            bottom padding and the composer's top padding met as a permanent
            band of empty background between the last message and the input —
            visible dead space that grew nothing and separated two things that
            read as one surface. Now the scroller runs the full height, the
            composer sits over it on an opaque backdrop, and the transcript
            reserves exactly the composer's height (`--composer-dock-height`)
            so nothing is ever stranded underneath it.
          */}
          <div
            className="relative flex min-h-0 flex-1 flex-col"
            // Unset until measured, so the first frame uses the CSS fallback
            // rather than briefly reserving 0px and jumping.
            style={
              composerDock.height > 0
                ? ({
                    '--composer-dock-height': `${composerDock.height}px`,
                    '--composer-height': `${composerDock.height}px`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {/*
              The boundary wraps the transcript only. It used to enclose the
              composer too, so one bad message part took the input box down
              with it and left no way to type your way out — including no way
              to start a new chat, since the transcript is what crashed.
            */}
            <RendererErrorBoundary resetKey={selectedConversationId}>
              <ChatWindowSlot
                conversationId={selectedConversationId}
                hasCredential={hasCredential}
                isLoadingConversation={isLoadingConversation}
                isLoadingOlder={isLoadingOlder}
                onOpenSettings={() => runViewTransition(() => openSettings())}
                onSuggestionClick={appendToComposer}
                onLoadOlderMessages={handleLoadOlderMessages}
                onRespondToolApproval={handleRespondToolApproval}
                onRetryLastMessage={handleRetryLastMessage}
                onReviewChanges={openWorkbenchReview}
                onUndoChanges={handleUndoTurnEdits}
                onOpenAgentsPanel={openWorkbenchAgents}
                hasTools={hasModelTools}
                projectName={activeProject?.exists ? activeProject.title : null}
                onQuoteInPrompt={handleQuoteInPrompt}
                onExplainSelection={handleExplainSelection}
                onSearchInWorkspace={handleSearchInWorkspace}
                onCiteCitation={handleCiteCitation}
                onCiteCommentChange={handleCiteCommentChange}
              />
            </RendererErrorBoundary>

            {/*
              The dock. Opaque, so the transcript passing beneath it is cut
              cleanly at its top edge rather than showing through, and
              measured, so the transcript knows to stop there.
            */}
            <div
              className="absolute inset-x-0 bottom-0 z-20 bg-bg-base"
              ref={composerDock.ref}
            >
              <WorkspaceContextBar
                conversationId={selectedConversationId ?? undefined}
                mode={workspaceMode}
                executionTarget={executionTarget}
                worktreeRoot={activeWorktreeRoot}
                cloudSandboxEnabled={settings?.chat.cloudSandboxEnabled}
                minimal={conversationStarted}
                onOpenSettings={() => runViewTransition(() => openSettings('beta'))}
                onExecutionTargetChange={handleExecutionTargetChange}
                onWorktreeFromBranch={handleWorktreeFromBranch}
                onRemoveWorktree={handleRemoveWorktree}
                project={activeProject}
                projects={projects}
                projectContext={projectContext}
                disabled={!selectedConversationId}
                onProjectContextChanged={() => {
                  void refreshProjectContext();
                  void refreshProjects();
                }}
                onAttach={() => {
                  void attachProject({ conversationId: selectedConversationId ?? undefined });
                }}
                onSelect={(projectId) => {
                  if (!selectedConversationId) return;
                  void setConversationWorkspace(selectedConversationId, { projectId });
                }}
                onDetach={() => {
                  if (!selectedConversationId) return;
                  void setConversationWorkspace(selectedConversationId, { projectId: null });
                }}
                onReveal={(projectId) => {
                  void window.atlasChat.projects.reveal(projectId);
                }}
                onToggleAutoPull={(projectId, autoPull) => {
                  void setProjectAutoPull(projectId, autoPull);
                }}
                onRevealTarget={(target) => {
                  if (!selectedConversationId) return;
                  void window.atlasChat.workspace.revealPath({
                    conversationId: selectedConversationId,
                    target,
                  });
                }}
              />

              {subagentTakeover.mode !== 'normal' ? (
                <SubagentComposer
                  takeover={subagentTakeover}
                  onSend={sendSubagentFollowup}
                  onStop={stopSubagent}
                />
              ) : (
                <ChatComposerSlot
                  conversationId={selectedConversationId}
                  disabled={!selectedConversationId}
                onSlashAction={handleSlashAction}
                models={models}
                selectedModelId={selectedModelId}
                selectedProviderId={selectedProviderId}
                modelPickerOpen={modelPickerOpen}
                composerFocusNonce={composerFocusNonce}
                onSend={(message) => {
                  const conversationId = selectedConversationId;
                  captureEvent(POSTHOG_EVENTS.MESSAGE_SENT, {
                    hasFiles: message.files && message.files.length > 0,
                    fileCount: message.files?.length ?? 0,
                  });
                  const sentAttachmentIds = message.files.map((file) => file.id);
                  const sentCitationKeys = message.citations.map((entry) => entry.key);
                  // Tray citations serialize here, at the boundary: the draft
                  // text the user edited never held link bytes.
                  const text = mergeCitationsIntoMessage(
                    message.text,
                    message.citations.map((entry) => entry.citation),
                  );
                  return sendMessage({
                    text,
                    files: message.files,
                    // Pin the thread: the composer awaits a blob→dataURL pass
                    // before calling us, so the selection may have moved on.
                    conversationId: conversationId ?? undefined,
                  }).then(() => {
                    // Only a successful send clears the thread's draft; a failure
                    // leaves the text (and files) in place to retry.
                    if (conversationId) {
                      clearComposerDraft(conversationId, sentAttachmentIds, sentCitationKeys);
                    }
                  });
                }}
                onAbort={() => {
                  if (selectedConversationId) {
                    captureEvent(POSTHOG_EVENTS.MESSAGE_ABORTED);
                    void abortConversation(selectedConversationId);
                  }
                }}
                onSelectModel={(modelId, providerId) => {
                  if (selectedConversationId) {
                    captureEvent(POSTHOG_EVENTS.MODEL_SELECTED, { modelId });
                    setSelectedModel(selectedConversationId, modelId, providerId);
                  }
                }}
                onModelPickerOpenChange={setModelPickerOpen}
                onComposerFocusChange={setComposerFocused}
                onRefreshModels={() => void refreshModels()}
                isRefreshingModels={isRefreshingModels}
                customProviders={settings?.customProviders}
                credentials={settings?.providers}
                defaultFreeOnly={settings?.showFreeOnlyByDefault ?? true}
                onManageProviders={() => runViewTransition(() => openSettings('providers'))}
                reasoningEffort={settings?.chat.reasoningEffort ?? DEFAULT_REASONING_EFFORT}
                toolPermissionMode={toolPermissionMode}
                workspaceMode={workspaceMode}
                workspaceReady={workspaceReady}
                onWorkspaceModeChange={handleWorkspaceModeChange}
                onRequestProject={
                  selectedConversationId
                    ? () => void requestProjectForConversation(selectedConversationId, 'mode-menu')
                    : undefined
                }
                onReasoningEffortChange={(reasoningEffort) => void updatePreferences({ chat: { reasoningEffort } })}
                onToolPermissionModeChange={handleToolPermissionModeChange}
                onOpenGallery={() => setGalleryOpen(true)}
                />
              )}
            </div>
          </div>

          {/*
            The terminal sits under the composer and inside the conversation
            column, so the workbench keeps its full height beside it — the
            same division Codex draws between its bottom terminal and its
            right-hand panel.
          */}
          {terminalOpen && (
            <>
              <PanelResizeHandle
                ariaLabel="Resize terminal"
                orientation="horizontal"
                isResizing={terminalResize.isResizing}
                width={terminalResize.width}
                minWidth={terminalResize.minWidth}
                maxWidth={terminalResize.maxWidth}
                onPointerDown={terminalResize.onPointerDown}
                onKeyDown={terminalResize.onKeyDown}
                onReset={terminalResize.reset}
              />
              <RendererErrorBoundary resetKey={selectedConversationId}>
                {/* xterm and its addons ride in the dock's chunk; the dock only
                    mounts once someone opens the terminal. */}
                <Suspense fallback={null}>
                <TerminalDock
                  conversationId={selectedConversationId ?? undefined}
                  // First-paint cwd must mirror main's spawn rule (worktree
                  // target resolves to the worktree, not the project root);
                  // the PTY's report corrects it afterwards if they differ.
                  workspacePath={
                    activeProject?.exists
                      ? activeConversationSummary?.executionTarget === 'worktree' &&
                          activeWorktreeRoot
                        ? activeWorktreeRoot
                        : activeProject.root
                      : null
                  }
                  onClose={() => setTerminalOpen(false)}
                  onAddSelectionToPrompt={appendToComposer}
                  expanded={terminalExpanded}
                  onToggleExpanded={toggleTerminalExpanded}
                  shortcutLabel={shortcutLabelForCommand(resolvedKeybindings, 'terminal.toggle', {
                    context: keybindingContext,
                    platform: shortcutPlatform,
                  })}
                  className="shrink-0"
                  style={{ height: terminalResize.width }}
                />
                </Suspense>
              </RendererErrorBoundary>
            </>
          )}
            </>
          )}
        </div>

        {workbenchOpen && (
          <>
            {/* Derived-closed: pane stays mounted at zero so its state
                survives, but the handle would be a dead control. */}
            {!workbenchDerivedClosed && (
              <PanelResizeHandle
                ariaLabel="Resize workbench"
                isResizing={workbenchResize.isResizing}
                width={solvedColumns.details}
                minWidth={workbenchResize.minWidth}
                maxWidth={workbenchResize.maxWidth}
                onPointerDown={workbenchResize.onPointerDown}
                onKeyDown={workbenchResize.onKeyDown}
                onReset={workbenchResize.reset}
              />
            )}
            <aside
              className="shrink-0 overflow-hidden border-l border-border-default"
              style={{ width: workbenchDerivedClosed ? 0 : solvedColumns.details }}
              aria-label="Workbench"
              aria-hidden={workbenchDerivedClosed || undefined}
              inert={workbenchDerivedClosed || undefined}
            >
              <RendererErrorBoundary resetKey={selectedConversationId}>
                <WorkbenchPanelSlot
                  conversationId={selectedConversationId ?? undefined}
                  mode={workspaceMode}
                  hasProject={Boolean(activeProject?.exists)}
                  onSendComments={appendToComposer}
                  onAddSelectionToPrompt={appendToComposer}
                  onOpenOutputFile={(filePath) => void window.atlasChat.workspace.openFile(filePath)}
                />
              </RendererErrorBoundary>
            </aside>
          </>
        )}

        {/* The side chat (C5): a parallel transcript beside the main one.
            A sibling of the main panel rather than a child, so it spans the
            full window height and the chat's internal layout is untouched. */}
        <SideChatPane />
      </div>
    );

  return (
    <TooltipProvider>
      <AtlasToaster />
      <CommandPalette
        items={commandPaletteItems}
        conversations={commandPaletteConversations}
        initialQuery={commandPaletteInitialQuery}
        onSelectConversation={(id) => void loadConversation(id)}
        onOpenChange={(open) => {
          setCommandPaletteOpen(open);
          if (!open) {
            setCommandPaletteInitialQuery(null);
          }
        }}
        onSelect={runCommand}
        open={commandPaletteOpen}
      />
      {/*
        Mounted on first open and kept mounted after that: mounting it eagerly
        would load the chunk during boot for a modal most sessions never open,
        and unmounting it on close would cut the dialog's exit animation.
      */}
      {galleryMounted ? (
        <Suspense fallback={null}>
          <VisualGallery
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={(visual) => {
          setGalleryOpen(false);
          appendToComposer(visual.content);
        }}
          />
        </Suspense>
      ) : null}
      {/*
        One boundary for every route-level chunk. The chat shell is not lazy, so
        this only ever shows while a full-screen view (settings, sites, plugins,
        landing) is being fetched — a few milliseconds from local disk.
      */}
      <Suspense fallback={<LoadingScreen />}>{content}</Suspense>
    </TooltipProvider>
  );
}
