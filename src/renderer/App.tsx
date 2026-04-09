import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { DEFAULT_SETTINGS_APPEARANCE } from '../shared/contracts';
import type { AppUpdateSnapshot, DesignTheme, FontFamilyOverride, KeybindingCommand, StreamEvent, ThemeMode } from '../shared/contracts';
import { getDefaultKeybindingRules, resolveKeybindingRules } from '../shared/keybindings';
import { PROVIDER_METADATA } from '../shared/providerMetadata';
import { POSTHOG_EVENTS } from '../shared/posthog';
import { ChatWindow } from './components/ChatWindow';
import { CommandPalette } from './components/CommandPalette';
import { Composer } from './components/Composer';
import { OnboardingFlow } from './components/OnboardingFlow';
import { AppUpdateButton } from './components/AppUpdateButton';
import { RendererErrorBoundary } from './components/RendererErrorBoundary';
import { buildUsageSummary, SettingsWorkspace } from './components/SettingsWorkspace';
import { Sidebar } from './components/Sidebar';
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
import { captureEvent, identifyUser } from './lib/posthog';
import { prewarmMessageRendering } from './lib/messageRendering';
import { runViewTransition } from './lib/viewTransitions';
import { selectDiagnosticsSummary, selectLoadedConversationMetrics, useAppStore } from './stores/useAppStore';
import { notify } from './lib/notify';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-text-muted">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm">Loading...</span>
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

function resolveThemeMode(mode: ThemeMode, prefersDark: boolean) {
  if (mode === 'system') {
    return prefersDark ? 'dark' : 'light';
  }

  return mode;
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
  const [composerValue, setComposerValue] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [showConversationJumpHints, setShowConversationJumpHints] = useState(false);
  const [showNewChatShortcutHint, setShowNewChatShortcutHint] = useState(false);
  const [showSidebarToggleShortcutHint, setShowSidebarToggleShortcutHint] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
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
    selectAdjacentConversation,
    selectConversationByIndex,
    sendMessage,
    abortConversation,
    respondToolApproval,
    deleteConversation,
    handleStreamEvent,
    openLanding,
    closeLanding,
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
      conversationDetails: state.conversationDetails,
      conversationStats: state.conversationStats,
      diagnostics: state.diagnostics,
      isLoadingOlderByConversation: state.isLoadingOlderByConversation,
      isLoadingConversationId: state.isLoadingConversationId,
      selectedConversationId: state.selectedConversationId,
      selectedModelIdByConversation: state.selectedModelIdByConversation,
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
      selectAdjacentConversation: state.selectAdjacentConversation,
      selectConversationByIndex: state.selectConversationByIndex,
      sendMessage: state.sendMessage,
      abortConversation: state.abortConversation,
      respondToolApproval: state.respondToolApproval,
      deleteConversation: state.deleteConversation,
      handleStreamEvent: state.handleStreamEvent,
      openLanding: state.openLanding,
      closeLanding: state.closeLanding,
    }))
  );
  const loadedMetrics = useAppStore(useShallow(selectLoadedConversationMetrics));
  const diagnosticsSummary = useAppStore(useShallow(selectDiagnosticsSummary));

  const activeConversation = selectedConversationId ? conversationDetails[selectedConversationId] ?? null : null;
  const activeDraft = selectedConversationId ? draftsByConversation[selectedConversationId] ?? null : null;
  const isLoadingOlder = selectedConversationId ? Boolean(isLoadingOlderByConversation[selectedConversationId]) : false;
  const isLoadingConversation =
    selectedConversationId != null && isLoadingConversationId === selectedConversationId;
  const selectedModelId = selectedConversationId ? selectedModelIdByConversation[selectedConversationId] ?? null : null;
  const hasCredential = Boolean(settings?.providers.some((provider) => provider.hasSecret));
  const activeCredentialProvider = PROVIDER_METADATA[activeCredentialProviderId];
  const appearance = settings?.appearance ?? DEFAULT_SETTINGS_APPEARANCE;
  const themeMode = appearance.themeMode;
  const sidebarItems = buildSidebarConversationItems({
    conversations,
    draftsByConversation,
    now: Date.now(),
  });
  const resolvedKeybindings = useMemo(
    () => resolveKeybindingRules(settings?.keyboard.keybindings ?? getDefaultKeybindingRules()),
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
          (definition.command === 'sidebar.toggle' && activeView !== 'chat') ||
          (definition.command === 'models.openSwitcher' && (activeView !== 'chat' || !selectedConversationId || activeDraft?.status === 'streaming')) ||
          ((definition.command === 'conversation.previous' || definition.command === 'conversation.next') &&
            !selectedConversationId),
        section: definition.section,
        shortcutLabel: shortcutLabelForCommand(resolvedKeybindings, definition.command, {
          context: keybindingContext,
          platform: shortcutPlatform
        }),
        title: definition.title,
      })),
    [activeDraft?.status, activeView, keybindingContext, resolvedKeybindings, selectedConversationId, shortcutPlatform]
  );

  const onStreamEvent = useEffectEvent((event: StreamEvent) => {
    void handleStreamEvent(event);
  });

  const onUpdateState = useEffectEvent((snapshot: AppUpdateSnapshot) => {
    setUpdateState(snapshot);
  });

  const runCommand = useEffectEvent((command: KeybindingCommand) => {
    if (command === 'app.commandPalette.toggle') {
      setModelPickerOpen(false);
      captureEvent(POSTHOG_EVENTS.COMMAND_PALETTE_OPENED);
      setCommandPaletteOpen(!commandPaletteOpen);
      return;
    }

    if (command === 'chat.new') {
      setCommandPaletteOpen(false);
      setModelPickerOpen(false);
      captureEvent(POSTHOG_EVENTS.CONVERSATION_CREATED);
      void createConversation();
      return;
    }

    if (command === 'sidebar.toggle') {
      if (activeView !== 'chat') {
        return;
      }

      setCommandPaletteOpen(false);
      runViewTransition(() => {
        setSidebarCollapsed((current) => !current);
      });
      return;
    }

    if (command === 'settings.open') {
      setCommandPaletteOpen(false);
      captureEvent(POSTHOG_EVENTS.SETTINGS_OPENED);
      runViewTransition(() => {
        openSettings('general');
      });
      return;
    }

    if (command === 'composer.focus') {
      requestComposerFocus();
      return;
    }

    if (command === 'models.openSwitcher') {
      if (activeView !== 'chat' || !selectedConversationId || activeDraft?.status === 'streaming') {
        return;
      }

      setCommandPaletteOpen(false);
      setModelPickerOpen(!modelPickerOpen);
      return;
    }

    if (command === 'conversation.previous') {
      setCommandPaletteOpen(false);
      setModelPickerOpen(false);
      void selectAdjacentConversation('previous');
      return;
    }

    if (command === 'conversation.next') {
      setCommandPaletteOpen(false);
      setModelPickerOpen(false);
      void selectAdjacentConversation('next');
      return;
    }

    if (command.startsWith('conversation.jump.')) {
      const index = Number(command.split('.').at(-1));
      if (Number.isFinite(index) && index >= 1) {
        setCommandPaletteOpen(false);
        setModelPickerOpen(false);
        void selectConversationByIndex(index - 1);
      }
    }
  });

  useEffect(() => {
    void bootstrap();
    void identifyUser();
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

  useEffect(() => {
    if (initialized && !hasCredential) {
      setShowOnboarding(true);
      return;
    }

    if (hasCredential) {
      setShowOnboarding(false);
    }
  }, [initialized, hasCredential]);

  useEffect(() => {
    if (onboardingDone && hasCredential) {
      void refreshModels();
      setOnboardingDone(false);
    }
  }, [onboardingDone, hasCredential, refreshModels]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = resolveThemeMode(themeMode, mediaQuery.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.designTheme = appearance.designTheme;
  }, [appearance.designTheme]);

  useEffect(() => {
    document.documentElement.dataset.borderRadius = appearance.borderRadius;
  }, [appearance.borderRadius]);

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
        keyDraft={keyDraft}
        isSaving={isSavingKey}
        isValidating={isValidatingKey}
        isRefreshingModels={isRefreshingModels}
        activeSection={settingsSection}
        activeCredentialProviderId={activeCredentialProviderId}
        shortcutPlatform={shortcutPlatform}
        onBack={() => runViewTransition(() => closeSettings())}
        onNavigate={setSettingsSection}
        onSelectProvider={setActiveCredentialProvider}
        onKeyDraftChange={setKeyDraft}
        onSaveKey={() => {
          captureEvent(POSTHOG_EVENTS.PROVIDER_KEY_SAVED, { providerId: activeCredentialProviderId });
          void saveProviderKey();
        }}
        onValidateKey={() => {
          captureEvent(POSTHOG_EVENTS.PROVIDER_KEY_VALIDATED, { providerId: activeCredentialProviderId });
          void validateProviderKey();
        }}
        onThemeModeChange={(mode) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'themeMode', value: mode });
          void updatePreferences({ appearance: { themeMode: mode } });
          const modeLabel = mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light';
          notify({ tone: 'info', title: `Theme mode: ${modeLabel}` });
        }}
        onDesignThemeChange={(theme) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'designTheme', value: theme });
          void updatePreferences({ appearance: { designTheme: theme } });
          const themeLabel = theme === 'default' ? 'Default' : theme === 'xai' ? 'xAI' : 'Cursor';
          notify({ tone: 'info', title: `Design theme: ${themeLabel}` });
        }}
        onBorderRadiusChange={(mode) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'borderRadius', value: mode });
          void updatePreferences({ appearance: { borderRadius: mode } });
          notify({
            tone: 'info',
            title: mode === 'none' ? 'Sharp edges enabled' : 'Border radius: Theme default',
          });
        }}
        onUiFontSizeChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'uiFontSize', value });
          void updatePreferences({ appearance: { uiFontSize: value } });
          notify({ tone: 'info', title: `UI font size: ${value}px` });
        }}
        onCodeFontSizeChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'codeFontSize', value });
          void updatePreferences({ appearance: { codeFontSize: value } });
          notify({ tone: 'info', title: `Code font size: ${value}px` });
        }}
        onUiFontFamilyChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'uiFontFamily', value });
          void updatePreferences({ appearance: { uiFontFamily: value } });
          const fontLabel = value === 'system' ? 'System' : value === 'mono' ? 'Monospace' : 'System';
          notify({ tone: 'info', title: `UI font: ${fontLabel}` });
        }}
        onCodeFontFamilyChange={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'codeFontFamily', value });
          void updatePreferences({ appearance: { codeFontFamily: value } });
          const fontLabel = value === 'system' ? 'System' : value === 'mono' ? 'Monospace' : 'System';
          notify({ tone: 'info', title: `Code font: ${fontLabel}` });
        }}
        onUpdateKeybindings={(rules) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'keybindings' });
          void updatePreferences({ keyboard: { keybindings: rules } });
        }}
        onToggleFreeModels={(value) => {
          captureEvent(POSTHOG_EVENTS.PREFERENCES_UPDATED, { setting: 'showFreeOnlyByDefault', value });
          void updatePreferences({ showFreeOnlyByDefault: value });
        }}
        onUpdateAction={() => {
          if (updateState.status === 'available' || updateState.status === 'downloaded') {
            void performUpdatePrimaryAction();
            return;
          }

          void checkForUpdates({ manual: true });
        }}
        onRefreshModels={() => void refreshModels()}
      />
    ) : showOnboarding && !hasCredential ? (
      <OnboardingFlow
        hasCredential={hasCredential}
        providerId={activeCredentialProviderId}
        providerLabel={activeCredentialProvider.label}
        providerLink={activeCredentialProvider.keyLink}
        providerLinkLabel={activeCredentialProvider.keyLinkLabel}
        isSavingKey={isSavingKey}
        isValidatingKey={isValidatingKey}
        keyDraft={keyDraft}
        onProviderChange={setActiveCredentialProvider}
        onKeyDraftChange={setKeyDraft}
        onSaveKey={() => void saveProviderKey()}
        onValidateKey={() => void validateProviderKey()}
        onContinue={() => {
          captureEvent(POSTHOG_EVENTS.ONBOARDING_COMPLETED);
          setShowOnboarding(false);
          setOnboardingDone(true);
        }}
      />
    ) : (
      <div
        className={`flex h-screen overflow-hidden ${
          sidebarCollapsed
            ? 'bg-bg-base'
            : 'bg-bg-base'
        }`}
      >
        <Sidebar
          items={sidebarItems}
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
          onOpenSettings={(section) => runViewTransition(() => openSettings(section))}
          onOpenLanding={() => openLanding()}
          onRefreshModels={() => void refreshModels()}
          onCheckForUpdates={() => void checkForUpdates({ manual: true })}
          onToggleCollapsed={() => runViewTransition(() => setSidebarCollapsed(!sidebarCollapsed))}
        />

        <div
          className={`relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base`}
          style={{ viewTransitionName: 'app-main-panel' }}
        >
          {/* Draggable title bar area for main content - matches sidebar height */}
          <div
            className={`relative h-[52px] shrink-0 ${sidebarCollapsed ? '' : 'border-b border-white/6'}`}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <AppUpdateButton updateState={updateState} onClick={() => void performUpdatePrimaryAction()} />
          </div>

          <RendererErrorBoundary resetKey={selectedConversationId}>
            <ChatWindow
              detail={activeConversation}
              draft={activeDraft}
              hasCredential={hasCredential}
              isLoadingConversation={isLoadingConversation}
              isLoadingOlder={isLoadingOlder}
              onOpenSettings={() => runViewTransition(() => openSettings())}
              onSuggestionClick={(prompt) => setComposerValue(prompt)}
              onLoadOlderMessages={(conversationId) => loadOlderMessages(conversationId)}
              onRespondToolApproval={(request) => respondToolApproval(request)}
            />

            <Composer
              value={composerValue}
              disabled={!selectedConversationId}
              isStreaming={activeDraft?.status === 'streaming'}
              models={models}
              selectedModelId={selectedModelId}
              modelPickerOpen={modelPickerOpen}
              composerFocusNonce={composerFocusNonce}
              detail={activeConversation}
              draft={activeDraft}
              onChange={setComposerValue}
              onSend={(message) => {
                const fallbackValue = message.text;
                captureEvent(POSTHOG_EVENTS.MESSAGE_SENT, {
                  hasFiles: message.files && message.files.length > 0,
                  fileCount: message.files?.length ?? 0,
                });
                return sendMessage({
                  text: message.text,
                  files: message.files,
                })
                  .then(() => setComposerValue(''))
                  .catch(() => setComposerValue(fallbackValue));
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
              onOpenGallery={() => setGalleryOpen(true)}
            />
          </RendererErrorBoundary>
        </div>
      </div>
    );

  return (
    <TooltipProvider>
      <AtlasToaster />
      <CommandPalette
        items={commandPaletteItems}
        onOpenChange={setCommandPaletteOpen}
        onSelect={runCommand}
        open={commandPaletteOpen}
      />
      <VisualGallery
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={(visual) => {
          setGalleryOpen(false);
          setComposerValue(visual.content);
        }}
      />
      {content}
    </TooltipProvider>
  );
}
