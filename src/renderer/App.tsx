import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  DEFAULT_SETTINGS_APPEARANCE,
  designThemeSupportsLight,
  resolveAppliedThemeMode,
} from '../shared/contracts';
import type { AppUpdateSnapshot, DesignTheme, FontFamilyOverride, KeybindingCommand, StreamEvent, ThemeMode } from '../shared/contracts';
import { getDefaultKeybindingRules, resolveKeybindingRules } from '../shared/keybindings';
import type { ToolPermissionMode } from '../shared/chatParameters';
import { DEFAULT_REASONING_EFFORT, DEFAULT_TOOL_PERMISSION_MODE } from '../shared/chatParameters';
import type { WorkspaceMode } from '../shared/workspaceModes';
import { DEFAULT_WORKSPACE_MODE, isWorkspaceModeReady, shouldPromptForProject } from '../shared/workspaceModes';
import { resolveProviderMetadata } from '../shared/providerMetadata';
import { POSTHOG_EVENTS } from '../shared/posthog';
import { ChatWindow } from './components/ChatWindow';
import { CommandPalette } from './components/CommandPalette';
import { ChatComposerSlot } from './components/ChatComposerSlot';
import { OnboardingFlow } from './components/OnboardingFlow';
import { RendererErrorBoundary } from './components/RendererErrorBoundary';
import { buildUsageSummary, SettingsWorkspace } from './components/SettingsWorkspace';
import { SitesWorkspace } from './components/sites/SitesWorkspace';
import { Sidebar } from './components/Sidebar';
import { PanelResizeHandle } from './components/PanelResizeHandle';
import { WorkbenchPanel, type WorkbenchTab } from './components/workbench/WorkbenchPanel';
import { WorkspaceContextBar } from './components/workspace/WorkspaceContextBar';
import { TerminalDock } from './components/workbench/TerminalDock';
import { OpenInIdeButton } from './components/workspace/OpenInIdeButton';
import { TerminalToggle, WorkbenchToggle, WorkspaceModeSwitch } from './components/workspace/WorkspaceModeSwitch';
import { useMeasuredHeight } from './hooks/useMeasuredHeight';
import { usePersistentFlag, useResizablePanel } from './hooks/useResizablePanel';
import { useWorkspaceContext } from './hooks/useWorkspaceContext';
import { VisualGallery } from './components/ai-elements/visual-gallery';
import { AtlasToaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { XAILandingPage } from './components/XAILandingPage';
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
import { isMacPlatform } from './lib/platform';
import { buildThemeOverrides } from './lib/themeOverrides';
import { runViewTransition } from './lib/viewTransitions';
import { cn } from './lib/utils';
import {
  EMPTY_COMPOSER_ATTACHMENTS,
  hasArchivedConversations,
  selectDiagnosticsSummary,
  selectLoadedConversationMetrics,
  useAppStore,
} from './stores/useAppStore';

// macOS traffic lights overlay the top-left of the frameless window; the main
// titlebar needs extra left inset only there, and only when the collapsed rail
// is too narrow to clear them (Windows/Linux controls sit top-right via
// titleBarOverlay).
const isMacLike = isMacPlatform;

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-text-muted">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
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
  const [workbenchOpen, setWorkbenchOpen] = usePersistentFlag('atlas.workbench.open', false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('review');
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
    conversationDetails,
    isLoadingOlderByConversation,
    isLoadingConversationId,
    selectedConversationId,
    selectedModelIdByConversation,
    draftsByConversation,
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
    closeSites,
    projects,
    refreshProjects,
    attachProject,
    detachProject,
    renameProject,
    setProjectPinned,
    setConversationPinned,
    setConversationArchived,
    setConversationWorkspace,
    setConversationToolPermissionMode,
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
      conversationDetails: state.conversationDetails,
      conversationStats: state.conversationStats,
      diagnostics: state.diagnostics,
      isLoadingOlderByConversation: state.isLoadingOlderByConversation,
      isLoadingConversationId: state.isLoadingConversationId,
      selectedConversationId: state.selectedConversationId,
      selectedModelIdByConversation: state.selectedModelIdByConversation,
      // `composerDraftsByConversation` / `composerAttachmentsByConversation` are
      // deliberately absent: they change on every keystroke, and this selector
      // is shallow-compared, so subscribing to them here re-rendered the whole
      // window per character. `ChatComposerSlot` reads them instead.
      draftsByConversation: state.draftsByConversation,
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
      closeSites: state.closeSites,
      projects: state.projects,
      refreshProjects: state.refreshProjects,
      attachProject: state.attachProject,
      createConversationInProject: state.createConversationInProject,
      forkConversation: state.forkConversation,
      detachProject: state.detachProject,
      renameProject: state.renameProject,
      setProjectPinned: state.setProjectPinned,
      setConversationPinned: state.setConversationPinned,
      setConversationArchived: state.setConversationArchived,
      setConversationWorkspace: state.setConversationWorkspace,
      setConversationToolPermissionMode: state.setConversationToolPermissionMode,
    }))
  );
  const loadedMetrics = useAppStore(useShallow(selectLoadedConversationMetrics));
  const diagnosticsSummary = useAppStore(useShallow(selectDiagnosticsSummary));

  const activeConversation = selectedConversationId ? conversationDetails[selectedConversationId] ?? null : null;
  const activeDraft = selectedConversationId ? draftsByConversation[selectedConversationId] ?? null : null;
  /**
   * A session nobody has spoken in yet — no stored turns and no draft in
   * flight. Same test the transcript uses to decide it should show the
   * suggestions screen, so the workspace chips and that screen come and go
   * together rather than on two different definitions of "new".
   */
  const isUntouchedSession = Boolean(
    activeConversation && activeConversation.messages.length === 0 && !activeDraft
  );
  const isLoadingOlder = selectedConversationId ? Boolean(isLoadingOlderByConversation[selectedConversationId]) : false;
  const isLoadingConversation =
    selectedConversationId != null && isLoadingConversationId === selectedConversationId;
  const selectedModelId = selectedConversationId ? selectedModelIdByConversation[selectedConversationId] ?? null : null;

  // Mode and project are per conversation, not per window: two threads on two
  // repos are the normal case, and a global switch would silently retarget the
  // one you were not looking at.
  const activeConversationSummary = selectedConversationId
    ? conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
    : null;
  const workspaceMode = activeConversationSummary?.workspaceMode ?? DEFAULT_WORKSPACE_MODE;
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
  const handleWorkspaceModeChange = useCallback(
    (mode: WorkspaceMode) => {
      if (!selectedConversationId) return;
      captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'workspaceMode', value: mode });
      void setConversationWorkspace(selectedConversationId, { mode });
      // Code is the mode with a panel worth seeing; opening it on the switch
      // saves the second click without locking the two together — the toggle
      // still wins afterwards.
      if (mode === 'code') {
        setWorkbenchOpen(true);
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
    [activeProject, requestProjectForConversation, selectedConversationId, setConversationWorkspace, setWorkbenchOpen]
  );
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
  // What the main process detected about that folder — project type, framework,
  // configured env keys. Fetched, not derived: it comes from the filesystem.
  const { context: projectContext, refresh: refreshProjectContext } = useWorkspaceContext(
    selectedConversationId,
    activeProject?.id ?? null,
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
  const selectedModelSummary = useMemo(
    () => (selectedModelId ? models.find((m) => m.id === selectedModelId) ?? null : null),
    [models, selectedModelId]
  );
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
  const sidebarItems = useMemo(
    () =>
      buildSidebarConversationItems({
        conversations,
        draftsByConversation,
        now: nowMs,
      }),
    [conversations, draftsByConversation, nowMs]
  );
  /**
   * Archived chats get the same row view model as live ones — they are the same
   * rows with different verbs, and building them a second way would drift.
   * `draftsByConversation` still applies: an archived chat keeps its in-memory
   * transcript, so a row can legitimately report the turn it was on.
   */
  const archivedSidebarItems = useMemo(
    () =>
      buildSidebarConversationItems({
        conversations: archivedConversations,
        draftsByConversation,
        now: nowMs,
      }),
    [archivedConversations, draftsByConversation, nowMs]
  );
  const hasArchivedChats = hasArchivedConversations({
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
          (definition.command === 'models.openSwitcher' && (activeView !== 'chat' || !selectedConversationId || activeDraft?.status === 'streaming')) ||
          ((definition.command === 'conversation.previous' || definition.command === 'conversation.next') &&
            !selectedConversationId) ||
          ((definition.command === 'workspace.mode.toggle' || definition.command === 'workspace.project.attach') &&
            (activeView !== 'chat' || !selectedConversationId)),
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
    [activeDraft?.status, activeView, keybindingContext, resolvedKeybindings, selectedConversationId, shortcutPlatform]
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
      captureEvent(POSTHOG_EVENTS.COMMAND_PALETTE_OPENED);
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
        setWorkbenchOpen(true);
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

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      // Clamped against the design theme: `default` and `xai` have no light
      // palette, and `color-scheme: light` under them turned native controls
      // white while every app surface stayed dark.
      const resolved = resolveAppliedThemeMode(themeMode, appearance.designTheme, mediaQuery.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [themeMode, appearance.designTheme]);

  useEffect(() => {
    document.documentElement.dataset.designTheme = appearance.designTheme;
  }, [appearance.designTheme]);

  useEffect(() => {
    document.documentElement.dataset.borderRadius = appearance.borderRadius;
  }, [appearance.borderRadius]);

  // Color overrides ride on top of the design theme as inline custom
  // properties; removing an override falls straight back to the theme value.
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
  }, [appearance]);

  // Vibrancy is a macOS window material. Off macOS the window stays opaque, so
  // a see-through sidebar would blend into a hardcoded window colour instead of
  // the desktop — the setting is stored but never stamped there.
  useEffect(() => {
    document.documentElement.dataset.translucentSidebar =
      appearance.translucentSidebar && isMacLike ? 'true' : 'false';
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
    const root = document.documentElement;
    root.style.setProperty('--ui-font-size', `${appearance.uiFontSize}px`);
    root.style.setProperty('--code-font-size', `${appearance.codeFontSize}px`);
    root.style.setProperty('--font-ui-family', buildFontFamilyValue(appearance.uiFontFamily, '--font-ui-system'));
    root.style.setProperty('--font-code-mono', buildFontFamilyValue(appearance.codeFontFamily, '--font-mono-system'));
  }, [appearance.codeFontFamily, appearance.codeFontSize, appearance.uiFontFamily, appearance.uiFontSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      setShowConversationJumpHints(
        shouldShowConversationJumpHints(event, resolvedKeybindings, {
          context: keybindingContext,
          platform: shortcutPlatform
        })
      );
      setShowNewChatShortcutHint(
        shouldShowShortcutHintForCommand(event, resolvedKeybindings, 'chat.new', {
          context: keybindingContext,
          platform: shortcutPlatform
        })
      );
      setShowSidebarToggleShortcutHint(
        shouldShowShortcutHintForCommand(event, resolvedKeybindings, 'sidebar.toggle', {
          context: keybindingContext,
          platform: shortcutPlatform
        })
      );

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
      setShowConversationJumpHints(
        shouldShowConversationJumpHints(event, resolvedKeybindings, {
          context: keybindingContext,
          platform: shortcutPlatform
        })
      );
      setShowNewChatShortcutHint(
        shouldShowShortcutHintForCommand(event, resolvedKeybindings, 'chat.new', {
          context: keybindingContext,
          platform: shortcutPlatform
        })
      );
      setShowSidebarToggleShortcutHint(
        shouldShowShortcutHintForCommand(event, resolvedKeybindings, 'sidebar.toggle', {
          context: keybindingContext,
          platform: shortcutPlatform
        })
      );
    };

    const onWindowBlur = () => {
      setShowConversationJumpHints(false);
      setShowNewChatShortcutHint(false);
      setShowSidebarToggleShortcutHint(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    return () => {
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
    ) : activeView === 'sites' ? (
      <SitesWorkspace onBack={() => runViewTransition(() => closeSites())} />
    ) : activeView === 'settings' ? (
      <SettingsWorkspace
        settings={settings}
        updateState={updateState}
        usageSummary={buildUsageSummary({
          settings,
          conversationPages: conversationDetails,
          conversationStats,
          diagnostics,
          rendererHeapBytes: diagnosticsSummary.rendererHeapBytes,
        })}
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
          onCreate={() => void createConversation()}
          onDelete={(id) => void deleteConversation(id)}
          onRename={(id, title) => void renameConversation(id, title)}
          onOpenSettings={(section) => runViewTransition(() => openSettings(section))}
          onAttachProject={() => {
            void attachProject({ conversationId: selectedConversationId ?? undefined });
          }}
          onCreateInProject={(projectId) => void createConversationInProject(projectId)}
          onRevealProject={(projectId) => void window.atlasChat.projects.reveal(projectId)}
          onDetachProject={(projectId) => void detachProject(projectId)}
          onRenameProject={(projectId, title) => void renameProject(projectId, title)}
          onForkConversation={(id) => void forkConversation(id)}
          onSetConversationPinned={(id, pinned) => void setConversationPinned(id, pinned)}
          onArchiveConversation={(id) => void setConversationArchived(id, true)}
          onRestoreConversation={(id) => void setConversationArchived(id, false)}
          onLoadArchivedChats={() => void loadArchivedConversations()}
          onSetProjectPinned={(projectId, pinned) => void setProjectPinned(projectId, pinned)}
          onOpenLanding={() => openLanding()}
          workspaceMode={workspaceMode}
          onOpenSites={() => runViewTransition(() => openSites())}
          onOpenSearch={() => {
            setModelPickerOpen(false);
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
              // Mid-stream the rung is already baked into the request in
              // flight; the composer chip greys out for the same reason.
              permissionDisabled={activeDraft?.status === 'streaming'}
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
        />

        {/* Resizing is meaningless while the rail is collapsed. */}
        {!sidebarCollapsed && (
          <PanelResizeHandle
            ariaLabel="Resize sidebar"
            isResizing={sidebarResize.isResizing}
            width={sidebarResize.width}
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
              sidebarCollapsed && isMacLike && 'pl-12'
            )}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            {/* Title + streaming badge are inert text: they drag the window. */}
            <div className="flex min-w-0 items-center gap-2.5">
              {activeConversation?.conversation ? (
                <h2 className="truncate text-md font-medium text-text-primary">
                  {activeConversation.conversation.title}
                </h2>
              ) : null}
              {activeDraft?.status === 'streaming' ? (
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
              <WorkbenchToggle open={workbenchOpen} onToggle={setWorkbenchOpen} />
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
                ? ({ '--composer-dock-height': `${composerDock.height}px` } as React.CSSProperties)
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
              <ChatWindow
                detail={activeConversation}
                draft={activeDraft}
                hasCredential={hasCredential}
                isLoadingConversation={isLoadingConversation}
                isLoadingOlder={isLoadingOlder}
                onOpenSettings={() => runViewTransition(() => openSettings())}
                onSuggestionClick={appendToComposer}
                onLoadOlderMessages={(conversationId) => loadOlderMessages(conversationId)}
                onRespondToolApproval={(request) => respondToolApproval(request)}
                onRetryLastMessage={() => void resendLastUserMessage()}
                onReviewChanges={() => {
                  setWorkbenchOpen(true);
                  setWorkbenchTab('review');
                }}
                onUndoChanges={handleUndoTurnEdits}
                hasTools={hasModelTools}
                projectName={activeProject?.exists ? activeProject.title : null}
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
              {/*
                Chips only on an untouched session. Once the conversation has a
                turn in it the folder, runner and branch are settled facts that the
                transcript itself evidences — leaving the strip up spends a row of
                the composer's column restating them above every reply.
              */}
              {isUntouchedSession ? (
                <WorkspaceContextBar
                  conversationId={selectedConversationId ?? undefined}
                  mode={workspaceMode}
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
                />
              ) : null}

              <ChatComposerSlot
                conversationId={selectedConversationId}
                disabled={!selectedConversationId}
                isStreaming={activeDraft?.status === 'streaming'}
                models={models}
                selectedModelId={selectedModelId}
                modelPickerOpen={modelPickerOpen}
                composerFocusNonce={composerFocusNonce}
                detail={activeConversation}
                draft={activeDraft}
                onSend={(message) => {
                  const conversationId = selectedConversationId;
                  captureEvent(POSTHOG_EVENTS.MESSAGE_SENT, {
                    hasFiles: message.files && message.files.length > 0,
                    fileCount: message.files?.length ?? 0,
                  });
                  const sentAttachmentIds = message.files.map((file) => file.id);
                  return sendMessage({
                    text: message.text,
                    files: message.files,
                    // Pin the thread: the composer awaits a blob→dataURL pass
                    // before calling us, so the selection may have moved on.
                    conversationId: conversationId ?? undefined,
                  }).then(() => {
                    // Only a successful send clears the thread's draft; a failure
                    // leaves the text (and files) in place to retry.
                    if (conversationId) {
                      clearComposerDraft(conversationId, sentAttachmentIds);
                    }
                  });
                }}
                onAbort={() => {
                  if (selectedConversationId) {
                    captureEvent(POSTHOG_EVENTS.MESSAGE_ABORTED);
                    void abortConversation(selectedConversationId);
                  }
                }}
                onSelectModel={(modelId) => {
                  if (selectedConversationId) {
                    captureEvent(POSTHOG_EVENTS.MODEL_SELECTED, { modelId });
                    setSelectedModel(selectedConversationId, modelId);
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
                <TerminalDock
                  conversationId={selectedConversationId ?? undefined}
                  workspacePath={activeProject?.exists ? activeProject.root : null}
                  onClose={() => setTerminalOpen(false)}
                  expanded={terminalExpanded}
                  onToggleExpanded={toggleTerminalExpanded}
                  shortcutLabel={shortcutLabelForCommand(resolvedKeybindings, 'terminal.toggle', {
                    context: keybindingContext,
                    platform: shortcutPlatform,
                  })}
                  className="shrink-0"
                  style={{ height: terminalResize.width }}
                />
              </RendererErrorBoundary>
            </>
          )}
        </div>

        {workbenchOpen && (
          <>
            <PanelResizeHandle
              ariaLabel="Resize workbench"
              isResizing={workbenchResize.isResizing}
              width={workbenchResize.width}
              minWidth={workbenchResize.minWidth}
              maxWidth={workbenchResize.maxWidth}
              onPointerDown={workbenchResize.onPointerDown}
              onKeyDown={workbenchResize.onKeyDown}
              onReset={workbenchResize.reset}
            />
            <aside
              className="shrink-0 overflow-hidden border-l border-border-default"
              style={{ width: workbenchResize.width }}
              aria-label="Workbench"
            >
              <RendererErrorBoundary resetKey={selectedConversationId}>
                <WorkbenchPanel
                  conversationId={selectedConversationId ?? undefined}
                  mode={workspaceMode}
                  messages={activeConversation?.messages ?? []}
                  activeTab={workbenchTab}
                  onTabChange={setWorkbenchTab}
                  onClose={() => setWorkbenchOpen(false)}
                  onSendComments={appendToComposer}
                />
              </RendererErrorBoundary>
            </aside>
          </>
        )}
      </div>
    );

  return (
    <TooltipProvider>
      <AtlasToaster />
      <CommandPalette
        items={commandPaletteItems}
        conversations={commandPaletteConversations}
        onSelectConversation={(id) => void loadConversation(id)}
        onOpenChange={setCommandPaletteOpen}
        onSelect={runCommand}
        open={commandPaletteOpen}
      />
      <VisualGallery
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={(visual) => {
          setGalleryOpen(false);
          appendToComposer(visual.content);
        }}
      />
      {content}
    </TooltipProvider>
  );
}
