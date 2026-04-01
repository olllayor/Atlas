import { useEffect, useEffectEvent, useState } from 'react';

import type { AppUpdateSnapshot, StreamEvent } from '../shared/contracts';
import { ChatWindow } from './components/ChatWindow';
import { Composer } from './components/Composer';
import { OnboardingFlow } from './components/OnboardingFlow';
import { AppUpdateButton } from './components/AppUpdateButton';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { useAppStore } from './stores/useAppStore';

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

export default function App() {
  const [composerValue, setComposerValue] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  const {
    bootstrapping,
    initialized,
    bootstrapError,
    settingsDialogOpen,
    keyDraft,
    isSavingKey,
    isValidatingKey,
    isRefreshingModels,
    settings,
    models,
    conversations,
    conversationDetails,
    selectedConversationId,
    selectedModelIdByConversation,
    draftsByConversation,
    notice,
    updateState,
    bootstrap,
    refreshModels,
    loadConversation,
    createConversation,
    openSettings,
    closeSettings,
    setKeyDraft,
    saveOpenRouterKey,
    validateOpenRouterKey,
    setUpdateState,
    checkForUpdates,
    performUpdatePrimaryAction,
    setSelectedModel,
    sendMessage,
    abortConversation,
    handleStreamEvent,
    dismissNotice,
  } = useAppStore();

  const activeConversation = selectedConversationId ? conversationDetails[selectedConversationId] ?? null : null;
  const activeDraft = selectedConversationId ? draftsByConversation[selectedConversationId] ?? null : null;
  const selectedModelId = selectedConversationId ? selectedModelIdByConversation[selectedConversationId] ?? null : null;
  const openRouterCredential = settings?.providers.find((p) => p.providerId === 'openrouter') ?? null;
  const hasCredential = Boolean(openRouterCredential?.hasSecret);

  const onStreamEvent = useEffectEvent((event: StreamEvent) => {
    void handleStreamEvent(event);
  });

  const onUpdateState = useEffectEvent((snapshot: AppUpdateSnapshot) => {
    setUpdateState(snapshot);
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
    if (initialized && !hasCredential && conversations.length === 0) {
      setShowOnboarding(true);
    }
  }, [initialized, hasCredential, conversations.length]);

  useEffect(() => {
    if (onboardingDone && hasCredential) {
      void refreshModels();
      setOnboardingDone(false);
    }
  }, [onboardingDone, hasCredential, refreshModels]);

  if (bootstrapping) return <LoadingScreen />;
  if (!initialized || bootstrapError) {
    return <ErrorScreen message={bootstrapError ?? 'Unknown error'} onRetry={() => void bootstrap()} />;
  }

  if (showOnboarding && !hasCredential) {
    return (
      <>
        <OnboardingFlow
          hasCredential={hasCredential}
          isSavingKey={isSavingKey}
          isValidatingKey={isValidatingKey}
          keyDraft={keyDraft}
          onKeyDraftChange={setKeyDraft}
          onSaveKey={() => void saveOpenRouterKey()}
          onValidateKey={() => void validateOpenRouterKey()}
          onContinue={() => {
            setShowOnboarding(false);
            setOnboardingDone(true);
          }}
        />
        <SettingsPanel
          open={settingsDialogOpen}
          settings={settings}
          updateState={updateState}
          keyDraft={keyDraft}
          isSaving={isSavingKey}
          isValidating={isValidatingKey}
          isRefreshingModels={isRefreshingModels}
          onClose={closeSettings}
          onKeyDraftChange={setKeyDraft}
          onSaveKey={() => void saveOpenRouterKey()}
          onValidateKey={() => void validateOpenRouterKey()}
          onCheckForUpdates={() => void checkForUpdates({ manual: true })}
          onRefreshModels={() => void refreshModels()}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base">
      <Sidebar
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        collapsed={sidebarCollapsed}
        onSelect={(id) => void loadConversation(id)}
        onCreate={() => void createConversation()}
        onOpenSettings={openSettings}
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

        <ChatWindow
          detail={activeConversation}
          draft={activeDraft}
          hasCredential={hasCredential}
          onOpenSettings={openSettings}
          onSuggestionClick={(prompt) => setComposerValue(prompt)}
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
      </div>

      <SettingsPanel
        open={settingsDialogOpen}
        settings={settings}
        updateState={updateState}
        keyDraft={keyDraft}
        isSaving={isSavingKey}
        isValidating={isValidatingKey}
        isRefreshingModels={isRefreshingModels}
        onClose={closeSettings}
        onKeyDraftChange={setKeyDraft}
        onSaveKey={() => void saveOpenRouterKey()}
        onValidateKey={() => void validateOpenRouterKey()}
        onCheckForUpdates={() => void checkForUpdates({ manual: true })}
        onRefreshModels={() => void refreshModels()}
      />
    </div>
  );
}
