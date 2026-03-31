import { useEffect, useEffectEvent, useState } from 'react';

import type { StreamEvent } from '../shared/contracts';
import { ChatWindow } from './components/ChatWindow';
import { Composer } from './components/Composer';
import { OnboardingFlow } from './components/OnboardingFlow';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { useAppStore } from './stores/useAppStore';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-slate-500">
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
      <div className="w-full max-w-md rounded-2xl border border-rose-500/20 bg-[#111418] p-8 text-center shadow-2xl">
        <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-400">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
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
    bootstrap,
    refreshModels,
    loadConversation,
    createConversation,
    openSettings,
    closeSettings,
    setKeyDraft,
    saveOpenRouterKey,
    validateOpenRouterKey,
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

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const unsubscribe = window.cheapChat.chat.subscribe((event) => {
      onStreamEvent(event);
    });
    return unsubscribe;
  }, [onStreamEvent]);

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
          keyDraft={keyDraft}
          isSaving={isSavingKey}
          isValidating={isValidatingKey}
          isRefreshingModels={isRefreshingModels}
          onClose={closeSettings}
          onKeyDraftChange={setKeyDraft}
          onSaveKey={() => void saveOpenRouterKey()}
          onValidateKey={() => void validateOpenRouterKey()}
          onRefreshModels={() => void refreshModels()}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        collapsed={sidebarCollapsed}
        onSelect={(id) => void loadConversation(id)}
        onCreate={() => void createConversation()}
        onOpenSettings={openSettings}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {notice && (
          <div
            className={`flex items-center justify-between border-b px-4 py-2 text-sm ${
              notice.tone === 'error'
                ? 'border-rose-500/20 bg-rose-500/5 text-rose-200'
                : notice.tone === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200'
                  : 'border-amber-500/20 bg-amber-500/5 text-amber-200'
            }`}
          >
            <span>{notice.message}</span>
            <button onClick={dismissNotice} className="ml-3 text-slate-500 hover:text-white">
              ✕
            </button>
          </div>
        )}

        <ChatWindow
          detail={activeConversation}
          draft={activeDraft}
          hasCredential={hasCredential}
          onOpenSettings={openSettings}
        />

        <Composer
          value={composerValue}
          disabled={!selectedConversationId}
          isStreaming={activeDraft?.status === 'streaming'}
          models={models}
          selectedModelId={selectedModelId}
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
        keyDraft={keyDraft}
        isSaving={isSavingKey}
        isValidating={isValidatingKey}
        isRefreshingModels={isRefreshingModels}
        onClose={closeSettings}
        onKeyDraftChange={setKeyDraft}
        onSaveKey={() => void saveOpenRouterKey()}
        onValidateKey={() => void validateOpenRouterKey()}
        onRefreshModels={() => void refreshModels()}
      />
    </div>
  );
}
