import { useEffect, useEffectEvent, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { AppUpdateSnapshot, StreamEvent, ThemeMode } from '../shared/contracts';
import { PROVIDER_METADATA } from '../shared/providerMetadata';
import { ChatWindow } from './components/ChatWindow';
import { Composer } from './components/Composer';
import { OnboardingFlow } from './components/OnboardingFlow';
import { AppUpdateButton } from './components/AppUpdateButton';
import { RendererErrorBoundary } from './components/RendererErrorBoundary';
import { buildUsageSummary, SettingsWorkspace } from './components/SettingsWorkspace';
import { Sidebar } from './components/Sidebar';
import { buildSidebarConversationItems } from './components/sidebarViewModel';
import { prewarmMessageRendering } from './lib/messageRendering';
import { selectDiagnosticsSummary, selectLoadedConversationMetrics, useAppStore } from './stores/useAppStore';

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

export default function App() {
  const [composerValue, setComposerValue] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  const {
    bootstrapping,
    initialized,
    bootstrapError,
    activeView,
    settingsSection,
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
    notice,
    updateState,
    bootstrap,
    refreshModels,
    loadConversation,
    loadOlderMessages,
    createConversation,
    openSettings,
    closeSettings,
    setSettingsSection,
    setActiveCredentialProvider,
    setKeyDraft,
    saveProviderKey,
    validateProviderKey,
    updatePreferences,
    setUpdateState,
    checkForUpdates,
    performUpdatePrimaryAction,
    setSelectedModel,
    sendMessage,
    abortConversation,
    deleteConversation,
    handleStreamEvent,
    dismissNotice,
  } = useAppStore(
    useShallow((state) => ({
      bootstrapping: state.bootstrapping,
      initialized: state.initialized,
      bootstrapError: state.bootstrapError,
      activeView: state.activeView,
      settingsSection: state.settingsSection,
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
      notice: state.notice,
      updateState: state.updateState,
      bootstrap: state.bootstrap,
      refreshModels: state.refreshModels,
      loadConversation: state.loadConversation,
      loadOlderMessages: state.loadOlderMessages,
      createConversation: state.createConversation,
      openSettings: state.openSettings,
      closeSettings: state.closeSettings,
      setSettingsSection: state.setSettingsSection,
      setActiveCredentialProvider: state.setActiveCredentialProvider,
      setKeyDraft: state.setKeyDraft,
      saveProviderKey: state.saveProviderKey,
      validateProviderKey: state.validateProviderKey,
      updatePreferences: state.updatePreferences,
      setUpdateState: state.setUpdateState,
      checkForUpdates: state.checkForUpdates,
      performUpdatePrimaryAction: state.performUpdatePrimaryAction,
      setSelectedModel: state.setSelectedModel,
      sendMessage: state.sendMessage,
      abortConversation: state.abortConversation,
      deleteConversation: state.deleteConversation,
      handleStreamEvent: state.handleStreamEvent,
      dismissNotice: state.dismissNotice,
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
  const themeMode = settings?.appearance.themeMode ?? 'dark';
  const sidebarItems = buildSidebarConversationItems({
    conversations,
    draftsByConversation,
    now: Date.now(),
  });

  const onStreamEvent = useEffectEvent((event: StreamEvent) => {
    void handleStreamEvent(event);
  });

  const onUpdateState = useEffectEvent((snapshot: AppUpdateSnapshot) => {
    setUpdateState(snapshot);
  });

  useEffect(() => {
    void bootstrap();
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

  if (bootstrapping) return <LoadingScreen />;
  if (!initialized || bootstrapError) {
    return <ErrorScreen message={bootstrapError ?? 'Unknown error'} onRetry={() => void bootstrap()} />;
  }

  if (activeView === 'settings') {
    const usageSummary = buildUsageSummary({
      settings,
      conversationPages: conversationDetails,
      conversationStats,
      diagnostics,
      rendererHeapBytes: diagnosticsSummary.rendererHeapBytes,
    });

    return (
      <SettingsWorkspace
        settings={settings}
        updateState={updateState}
        usageSummary={usageSummary}
        notice={notice}
        keyDraft={keyDraft}
        isSaving={isSavingKey}
        isValidating={isValidatingKey}
        isRefreshingModels={isRefreshingModels}
        activeSection={settingsSection}
        activeCredentialProviderId={activeCredentialProviderId}
        onBack={closeSettings}
        onNavigate={setSettingsSection}
        onDismissNotice={dismissNotice}
        onSelectProvider={setActiveCredentialProvider}
        onKeyDraftChange={setKeyDraft}
        onSaveKey={() => void saveProviderKey()}
        onValidateKey={() => void validateProviderKey()}
        onThemeModeChange={(mode) => void updatePreferences({ appearance: { themeMode: mode } })}
        onToggleFreeModels={(value) => void updatePreferences({ showFreeOnlyByDefault: value })}
        onUpdateAction={() => {
          if (updateState.status === 'available' || updateState.status === 'downloaded') {
            void performUpdatePrimaryAction();
            return;
          }

          void checkForUpdates({ manual: true });
        }}
        onRefreshModels={() => void refreshModels()}
      />
    );
  }

  if (showOnboarding && !hasCredential) {
    return (
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
          setShowOnboarding(false);
          setOnboardingDone(true);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base">
      <Sidebar
        items={sidebarItems}
        selectedConversationId={selectedConversationId}
        collapsed={sidebarCollapsed}
        settings={settings}
        updateState={updateState}
        isRefreshingModels={isRefreshingModels}
        conversationStats={conversationStats}
        loadedMessageCount={loadedMetrics.loadedMessageCount}
        onSelect={(id) => void loadConversation(id)}
        onCreate={() => void createConversation()}
        onDelete={(id) => void deleteConversation(id)}
        onOpenSettings={openSettings}
        onRefreshModels={() => void refreshModels()}
        onCheckForUpdates={() => void checkForUpdates({ manual: true })}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(87,104,173,0.13),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_18%)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.02),transparent_18%,transparent_82%,rgba(255,255,255,0.02))]" />
        {/* Draggable title bar area for main content - matches sidebar height */}
        <div
          className="relative h-[52px] shrink-0 border-b border-white/6"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <AppUpdateButton updateState={updateState} onClick={() => void performUpdatePrimaryAction()} />
        </div>

        {notice && (
          <div
            className={`flex items-center justify-between border-b px-4 py-2 text-sm ${
              notice.tone === 'error'
                ? 'border-error-border bg-error-bg text-error-text'
                : notice.tone === 'success'
                  ? 'border-success-border bg-success-bg text-success-text'
                  : 'border-warning-border bg-warning-bg text-warning-text'
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <span>{notice.message}</span>
            <button onClick={dismissNotice} className="ml-3 text-text-muted hover:text-text-primary">
              ✕
            </button>
          </div>
        )}

        <RendererErrorBoundary resetKey={selectedConversationId}>
          <ChatWindow
            detail={activeConversation}
            draft={activeDraft}
            hasCredential={hasCredential}
            isLoadingConversation={isLoadingConversation}
            isLoadingOlder={isLoadingOlder}
            onOpenSettings={openSettings}
            onSuggestionClick={(prompt) => setComposerValue(prompt)}
            onLoadOlderMessages={(conversationId) => loadOlderMessages(conversationId)}
          />

          <Composer
            value={composerValue}
            disabled={!selectedConversationId}
            isStreaming={activeDraft?.status === 'streaming'}
            models={models}
            selectedModelId={selectedModelId}
            detail={activeConversation}
            draft={activeDraft}
            onChange={setComposerValue}
            onSend={() => {
              const payload = composerValue;
              void sendMessage(payload)
                .then(() => setComposerValue(''))
                .catch(() => setComposerValue(payload));
            }}
            onAbort={() => {
              if (selectedConversationId) void abortConversation(selectedConversationId);
            }}
            onSelectModel={(modelId) => {
              if (selectedConversationId) setSelectedModel(selectedConversationId, modelId);
            }}
            onRefreshModels={() => void refreshModels()}
            isRefreshingModels={isRefreshingModels}
          />
        </RendererErrorBoundary>
      </div>
    </div>
  );
}
