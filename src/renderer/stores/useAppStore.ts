import { create } from 'zustand';

import type {
  AppUpdateSnapshot,
  ChatInputFilePart,
  ChatMessagePart,
  ConversationPage,
  ConversationSummary,
  ConversationStats,
  DiagnosticsSnapshot,
  KeybindingRule,
  ModelSummary,
  ProviderCredentialSummary,
  ProviderId,
  RuntimeStateSnapshot,
  SettingsSection,
  SettingsSummary,
  SettingsUpdateRequest,
  StreamEvent,
  ToolApprovalResponseRequest
} from '../../shared/contracts';
import {
  MAX_TOTAL_ATTACHMENT_SIZE_BYTES,
  getAttachmentCapabilityError,
  getContentPreviewText,
  isSupportedAttachmentMediaType,
  normalizeAttachmentMediaType,
  sumAttachmentSize,
} from '../../shared/attachments';
import { parseMentions } from '../../shared/mentions';
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_TOOL_PERMISSION_MODE,
} from '../../shared/chatParameters';
import { resolveProviderMetadata } from '../../shared/providerMetadata';
import {
  DEFAULT_CONVERSATION_PAGE_SIZE,
  compactConversationPage,
  getLoadedConversationCounts,
  mergeConversationPage,
  reconcileConversationCache
} from './conversationCache';
import { notify } from '../lib/notify';
import {
  applyMetaEvent,
  applyRecoveredRuntimeEventsToStore,
  applyRuntimeSnapshotToStore,
  applyStreamingEvent,
  type DraftState,
  type RuntimeEventFanOut,
} from './streamEventReducers';

export type { DraftState };

type RefreshModelsOptions = {
  silent?: boolean;
};

type AppView = 'chat' | 'settings' | 'landing' | 'sites';

type AppState = {
  bootstrapping: boolean;
  initialized: boolean;
  bootstrapError: string | null;
  activeView: AppView;
  settingsSection: SettingsSection;
  commandPaletteOpen: boolean;
  modelPickerOpen: boolean;
  composerFocused: boolean;
  composerFocusNonce: number;
  activeCredentialProviderId: ProviderId;
  keyDraft: string;
  isSavingKey: boolean;
  isValidatingKey: boolean;
  isRefreshingModels: boolean;
  settings: SettingsSummary | null;
  models: ModelSummary[];
  conversations: ConversationSummary[];
  conversationDetails: Record<string, ConversationPage>;
  conversationStats: ConversationStats | null;
  diagnostics: DiagnosticsSnapshot | null;
  inactiveConversationIds: string[];
  isLoadingOlderByConversation: Record<string, boolean>;
  isLoadingConversationId: string | null;
  selectedConversationId: string | null;
  selectedModelIdByConversation: Record<string, string>;
  draftsByConversation: Record<string, DraftState | undefined>;
  requestToConversation: Record<string, string>;
  runtimeSequenceByConversation: Record<string, number>;
  updateState: AppUpdateSnapshot;
  bootstrap: () => Promise<void>;
  refreshModels: (options?: RefreshModelsOptions) => Promise<void>;
  refreshConversationList: () => Promise<void>;
  refreshConversationStats: () => Promise<void>;
  refreshDiagnostics: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  loadOlderMessages: (conversationId: string) => Promise<void>;
  createConversation: () => Promise<void>;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  openLanding: () => void;
  closeLanding: () => void;
  openSites: () => void;
  closeSites: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setModelPickerOpen: (open: boolean) => void;
  setComposerFocused: (focused: boolean) => void;
  requestComposerFocus: () => void;
  setActiveCredentialProvider: (providerId: ProviderId) => void;
  setKeyDraft: (value: string) => void;
  saveProviderKey: () => Promise<void>;
  validateProviderKey: () => Promise<void>;
  updatePreferences: (patch: SettingsUpdateRequest) => Promise<void>;
  setUpdateState: (snapshot: AppUpdateSnapshot) => void;
  checkForUpdates: (options?: { manual?: boolean }) => Promise<void>;
  performUpdatePrimaryAction: () => Promise<void>;
  setSelectedModel: (conversationId: string, modelId: string) => void;
  selectAdjacentConversation: (direction: 'previous' | 'next') => Promise<void>;
  selectConversationByIndex: (index: number) => Promise<void>;
  sendMessage: (message: { text: string; files: ChatInputFilePart[] }) => Promise<void>;
  resendLastUserMessage: () => Promise<void>;
  abortConversation: (conversationId: string) => Promise<void>;
  respondToolApproval: (request: ToolApprovalResponseRequest) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  handleStreamEvent: (event: StreamEvent) => Promise<void>;
};

// =============================================================================
// Pure helpers
// =============================================================================
function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected error';
}

function findCredential(settings: SettingsSummary | null, providerId: ProviderId): ProviderCredentialSummary | null {
  return settings?.providers.find((provider) => provider.providerId === providerId) ?? null;
}

function getModelById(models: ModelSummary[], modelId: string | null) {
  if (!modelId) {
    return null;
  }
  return models.find((model) => model.id === modelId) ?? null;
}

function resolveSelectedModelId(
  selectedConversationId: string | null,
  selectedModelIdByConversation: Record<string, string>,
  conversationDetails: Record<string, ConversationPage>,
  models: ModelSummary[]
) {
  if (!selectedConversationId) {
    return null;
  }

  const explicit = selectedModelIdByConversation[selectedConversationId];
  if (explicit) {
    return explicit;
  }

  const persisted = conversationDetails[selectedConversationId]?.conversation.defaultModelId;
  if (persisted && models.some((model) => model.id === persisted)) {
    return persisted;
  }

  return models[0]?.id ?? null;
}

export function chooseDefaultModel(models: ModelSummary[], preferredProviderId?: ProviderId | null) {
  const availableModels = models.filter((model) => !model.archived);
  const preferredModels = preferredProviderId
    ? availableModels.filter((model) => model.providerId === preferredProviderId)
    : availableModels;

  return (
    preferredModels.find((model) => model.isFree)?.id ??
    preferredModels[0]?.id ??
    availableModels.find((model) => model.isFree)?.id ??
    availableModels[0]?.id ??
    null
  );
}

function collectRendererHeapBytes() {
  if (typeof performance === 'undefined') {
    return null;
  }
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  return memory?.usedJSHeapSize ?? null;
}

function resolveConversationIdForRequest(
  requestId: string,
  state: Pick<AppState, 'requestToConversation' | 'draftsByConversation' | 'conversationDetails' | 'selectedConversationId'>
) {
  const direct = state.requestToConversation[requestId];
  if (direct) {
    return direct;
  }

  for (const [conversationId, draft] of Object.entries(state.draftsByConversation)) {
    if (draft?.requestId === requestId) {
      return conversationId;
    }
  }

  for (const [conversationId, detail] of Object.entries(state.conversationDetails)) {
    const hasMatchingToolPart = detail.messages.some((message) =>
      message.parts.some((part) => part.type === 'tool' && part.requestId === requestId)
    );
    if (hasMatchingToolPart) {
      return conversationId;
    }
  }

  const streamingConversations = Object.entries(state.conversationDetails).filter(([, detail]) =>
    detail.messages.some((message) => message.role === 'assistant' && message.status === 'streaming')
  );

  if (streamingConversations.length === 1) {
    return streamingConversations[0][0];
  }

  return null;
}

// =============================================================================
// Store
// =============================================================================
export const useAppStore = create<AppState>((set, get) => ({
  bootstrapping: true,
  initialized: false,
  bootstrapError: null,
  activeView: 'chat',
  settingsSection: 'general',
  commandPaletteOpen: false,
  modelPickerOpen: false,
  composerFocused: false,
  composerFocusNonce: 0,
  activeCredentialProviderId: '',
  keyDraft: '',
  isSavingKey: false,
  isValidatingKey: false,
  isRefreshingModels: false,
  settings: null,
  models: [],
  conversations: [],
  conversationDetails: {},
  conversationStats: null,
  diagnostics: null,
  inactiveConversationIds: [],
  isLoadingOlderByConversation: {},
  isLoadingConversationId: null,
  selectedConversationId: null,
  selectedModelIdByConversation: {},
  draftsByConversation: {},
  requestToConversation: {},
  runtimeSequenceByConversation: {},
  updateState: { status: 'idle' },

  bootstrap: async () => {
    set({ bootstrapping: true, bootstrapError: null });

    try {
      const settings = await window.atlasChat.settings.getSummary();
      let conversations = await window.atlasChat.conversations.list();

      if (conversations.length === 0) {
        const createdConversation = await window.atlasChat.conversations.create();
        conversations = [createdConversation];
      }

      const selectedConversationId = conversations[0]?.id ?? null;
      const [detail, runtimeState, models, updateState, conversationStats, diagnostics] = await Promise.all([
        selectedConversationId
          ? window.atlasChat.conversations.getPage(selectedConversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE })
          : Promise.resolve(null),
        selectedConversationId
          ? window.atlasChat.chat.getRuntimeState({ conversationId: selectedConversationId })
          : Promise.resolve(null),
        window.atlasChat.models.list({
          // Always load the full catalog: the model picker applies the
          // free-only preference itself, and a pre-filtered list would both
          // disable its toggle and hide an already-selected paid model.
          freeOnly: false,
          includeArchived: false,
          allowStale: true
        }),
        window.atlasChat.updates.getState(),
        window.atlasChat.conversations.getStats(),
        window.atlasChat.diagnostics.getSnapshot()
      ]);

      const defaultModelId = chooseDefaultModel(models, settings.defaultProviderId);
      const activeCredentialProviderId =
        settings.defaultProviderId ?? findConfiguredCredential(settings)?.providerId ?? '';

      set({
        bootstrapping: false,
        initialized: true,
        settings,
        models,
        conversations,
        conversationStats,
        diagnostics,
        activeCredentialProviderId,
        selectedConversationId,
        conversationDetails: buildBootstrapConversationDetails(selectedConversationId, detail, runtimeState),
        runtimeSequenceByConversation:
          selectedConversationId && runtimeState ? { [selectedConversationId]: runtimeState.lastSequence } : {},
        draftsByConversation:
          selectedConversationId && runtimeState
            ? (applyRuntimeSnapshotToStore(
                {
                  draftsByConversation: {},
                  conversationDetails: {},
                  requestToConversation: {},
                  runtimeSequenceByConversation: {}
                },
                selectedConversationId,
                runtimeState
              ).draftsByConversation ?? {})
            : {},
        updateState,
        selectedModelIdByConversation:
          defaultModelId && selectedConversationId
            ? {
                [selectedConversationId]:
                  detail?.conversation?.defaultModelId ??
                  chooseDefaultModel(models, detail?.conversation?.defaultProviderId ?? settings.defaultProviderId) ??
                  defaultModelId
              }
            : {}
      });

      if (models.length === 0) {
        void get().refreshModels({ silent: true });
      }
    } catch (error) {
      set({ bootstrapping: false, bootstrapError: getErrorMessage(error) });
    }
  },

  refreshModels: async ({ silent } = {}) => {
    set({ isRefreshingModels: true });

    try {
      const models = await window.atlasChat.models.refresh();
      const settings = await window.atlasChat.settings.getSummary();
      const state = get();
      const selectedModelId = resolveSelectedModelId(
        state.selectedConversationId,
        state.selectedModelIdByConversation,
        state.conversationDetails,
        models
      ) ?? chooseDefaultModel(models, settings.defaultProviderId);

      set((current) => ({
        isRefreshingModels: false,
        models,
        settings,
        selectedModelIdByConversation:
          selectedModelId && current.selectedConversationId
            ? {
                ...current.selectedModelIdByConversation,
                [current.selectedConversationId]: selectedModelId
              }
            : current.selectedModelIdByConversation,
      }));

      if (!silent) {
        notify({ tone: 'success', title: 'Model catalog refreshed.' });
      }
    } catch (error) {
      set({ isRefreshingModels: false });

      if (!silent) {
        notify({ tone: 'error', title: getErrorMessage(error) });
      }
    }
  },

  refreshConversationList: async () => {
    const [conversations, conversationStats] = await Promise.all([
      window.atlasChat.conversations.list(),
      window.atlasChat.conversations.getStats()
    ]);
    set({ conversations, conversationStats });
  },

  refreshConversationStats: async () => {
    const conversationStats = await window.atlasChat.conversations.getStats();
    set({ conversationStats });
  },

  refreshDiagnostics: async () => {
    const diagnostics = await window.atlasChat.diagnostics.getSnapshot();
    set({ diagnostics });
  },

  loadConversation: async (conversationId) => {
    const state = get();
    const previousSelectedId = state.selectedConversationId;
    const cacheState = reconcileConversationCache({
      conversationDetails: state.conversationDetails,
      inactiveConversationIds: state.inactiveConversationIds,
      previousSelectedId,
      nextSelectedId: conversationId
    });
    const cachedDetail = cacheState.conversationDetails[conversationId] ?? state.conversationDetails[conversationId];

    set((current) => ({
      selectedConversationId: conversationId,
      conversationDetails: cacheState.conversationDetails,
      inactiveConversationIds: cacheState.inactiveConversationIds,
      isLoadingConversationId: cachedDetail ? null : conversationId,
      selectedModelIdByConversation:
        !current.selectedModelIdByConversation[conversationId]
          ? {
              ...current.selectedModelIdByConversation,
              [conversationId]:
                cachedDetail?.conversation.defaultModelId ??
                chooseDefaultModel(current.models, cachedDetail?.conversation.defaultProviderId ?? current.settings?.defaultProviderId) ??
                ''
            }
          : current.selectedModelIdByConversation
    }));

    if (cachedDetail) {
      return;
    }

    try {
      const [detail, runtimeState] = await Promise.all([
        window.atlasChat.conversations.getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE }),
        window.atlasChat.chat.getRuntimeState({ conversationId }),
      ]);
      set((current) => ({
        ...applyRuntimeSnapshotToStore(current, conversationId, runtimeState),
        isLoadingConversationId:
          current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId,
        selectedModelIdByConversation:
          !current.selectedModelIdByConversation[conversationId]
            ? {
                ...current.selectedModelIdByConversation,
                [conversationId]:
                  runtimeState.conversation?.defaultModelId ??
                  detail.conversation.defaultModelId ??
                  chooseDefaultModel(current.models, runtimeState.conversation?.defaultProviderId ?? detail.conversation.defaultProviderId ?? current.settings?.defaultProviderId) ??
                  ''
              }
            : current.selectedModelIdByConversation
      }));
    } catch (error) {
      set((current) => ({
        isLoadingConversationId:
          current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId
      }));
      notify({ tone: 'error', title: getErrorMessage(error) });
    }
  },

  loadOlderMessages: async (conversationId) => {
    const state = get();
    const detail = state.conversationDetails[conversationId];

    if (!detail?.hasOlder || !detail.nextCursor || state.isLoadingOlderByConversation[conversationId]) {
      return;
    }

    set((current) => ({
      isLoadingOlderByConversation: { ...current.isLoadingOlderByConversation, [conversationId]: true }
    }));

    try {
      const page = await window.atlasChat.conversations.getPage(conversationId, {
        cursor: detail.nextCursor,
        limit: detail.limit
      });

      set((current) => {
        const currentDetail = current.conversationDetails[conversationId];
        if (!currentDetail) {
          return {
            isLoadingOlderByConversation: { ...current.isLoadingOlderByConversation, [conversationId]: false }
          };
        }

        const existingIds = new Set(currentDetail.messages.map((message) => message.id));
        const olderMessages = page.messages.filter((message) => !existingIds.has(message.id));

        return {
          conversationDetails: {
            ...current.conversationDetails,
            [conversationId]: {
              ...currentDetail,
              conversation: page.conversation,
              messages: [...olderMessages, ...currentDetail.messages],
              hasOlder: page.hasOlder,
              nextCursor: page.nextCursor,
              limit: page.limit
            }
          },
          isLoadingOlderByConversation: { ...current.isLoadingOlderByConversation, [conversationId]: false }
        };
      });
    } catch (error) {
      set((current) => ({
        isLoadingOlderByConversation: { ...current.isLoadingOlderByConversation, [conversationId]: false }
      }));
      notify({ tone: 'error', title: getErrorMessage(error) });
    }
  },

  createConversation: async () => {
    const created = await window.atlasChat.conversations.create();
    await get().refreshConversationList();
    set({ activeView: 'chat', commandPaletteOpen: false, modelPickerOpen: false });
    await get().loadConversation(created.id);
  },

  openSettings: (section = 'general') =>
    set({ activeView: 'settings', settingsSection: section, commandPaletteOpen: false, modelPickerOpen: false }),
  closeSettings: () => set({ activeView: 'chat', modelPickerOpen: false }),
  openLanding: () => set({ activeView: 'landing' }),
  closeLanding: () => set({ activeView: 'chat' }),
  openSites: () => set({ activeView: 'sites', commandPaletteOpen: false, modelPickerOpen: false }),
  closeSites: () => set({ activeView: 'chat' }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setModelPickerOpen: (open) => set({ modelPickerOpen: open }),
  setComposerFocused: (focused) => set({ composerFocused: focused }),
  requestComposerFocus: () =>
    set((state) => ({
      activeView: 'chat',
      commandPaletteOpen: false,
      composerFocusNonce: state.composerFocusNonce + 1
    })),
  setActiveCredentialProvider: (providerId) => set({ activeCredentialProviderId: providerId, keyDraft: '' }),
  setKeyDraft: (value) => set({ keyDraft: value }),

  saveProviderKey: async () => {
    const state = get();
    const providerId = state.activeCredentialProviderId;
    const secret = state.keyDraft.trim();
    const metadata = resolveProviderMetadata(providerId, state.settings?.customProviders ?? []);
    if (!secret) {
      notify({ tone: 'error', title: `Enter a ${metadata.label} API key before saving.` });
      return;
    }

    set({ isSavingKey: true });

    try {
      const settings = await window.atlasChat.settings.saveProviderKey(providerId, secret);
      set({ isSavingKey: false, settings, keyDraft: '', activeCredentialProviderId: providerId });
      notify({ tone: 'success', title: `${metadata.label} key saved to the OS keychain.` });
    } catch (error) {
      set({ isSavingKey: false });
      notify({ tone: 'error', title: getErrorMessage(error) });
    }
  },

  validateProviderKey: async () => {
    const state = get();
    const providerId = state.activeCredentialProviderId;
    const secretOverride = state.keyDraft.trim() || undefined;
    const metadata = resolveProviderMetadata(providerId, state.settings?.customProviders ?? []);
    set({ isValidatingKey: true });

    try {
      const settings = await window.atlasChat.settings.validateProviderKey(providerId, secretOverride);
      set({ isValidatingKey: false, settings, keyDraft: '' });
      notify({ tone: 'success', title: `${metadata.label} key validated successfully.` });
      await get().refreshModels({ silent: true });
    } catch (error) {
      set({ isValidatingKey: false });
      notify({ tone: 'error', title: getErrorMessage(error) });
    }
  },

  updatePreferences: async (patch) => {
    const settings = await window.atlasChat.settings.updatePreferences(patch);
    if (typeof patch.showFreeOnlyByDefault !== 'boolean') {
      set({ settings });
      return;
    }

    // The catalog no longer depends on this preference — the model picker
    // applies it — so there is nothing to refetch, only a default to seed for a
    // conversation that has not picked a model yet.
    set((state) => ({
      settings,
      selectedModelIdByConversation:
        state.selectedConversationId && !state.selectedModelIdByConversation[state.selectedConversationId]
          ? {
              ...state.selectedModelIdByConversation,
              [state.selectedConversationId]: chooseDefaultModel(state.models, settings.defaultProviderId) ?? ''
            }
          : state.selectedModelIdByConversation
    }));
  },

  setUpdateState: (snapshot) => set({ updateState: snapshot }),

  checkForUpdates: async ({ manual } = {}) => {
    try {
      const snapshot = await window.atlasChat.updates.check();
      set({ updateState: snapshot });

      if (manual && snapshot.status === 'error') {
        notify({ tone: 'error', title: snapshot.message });
      }
      if (manual && snapshot.status === 'not-available') {
        notify({ tone: 'info', title: 'Atlas is up to date.' });
      }
    } catch (error) {
      if (manual) {
        notify({ tone: 'error', title: getErrorMessage(error) });
      }
    }
  },

  performUpdatePrimaryAction: async () => {
    await window.atlasChat.updates.performPrimaryAction();
  },

  setSelectedModel: (conversationId, modelId) => {
    set((state) => ({
      selectedModelIdByConversation: { ...state.selectedModelIdByConversation, [conversationId]: modelId }
    }));
  },

  selectAdjacentConversation: async (direction) => {
    const state = get();
    const currentIndex = state.conversations.findIndex(
      (conversation) => conversation.id === state.selectedConversationId
    );
    if (currentIndex === -1) {
      return;
    }
    const nextConversation =
      direction === 'previous' ? state.conversations[currentIndex - 1] : state.conversations[currentIndex + 1];
    if (!nextConversation) {
      return;
    }
    set({ activeView: 'chat', commandPaletteOpen: false, modelPickerOpen: false });
    await get().loadConversation(nextConversation.id);
  },

  selectConversationByIndex: async (index) => {
    const conversation = get().conversations[index];
    if (!conversation) {
      return;
    }
    set({ activeView: 'chat', commandPaletteOpen: false, modelPickerOpen: false });
    await get().loadConversation(conversation.id);
  },

  sendMessage: async (message) => {
    const trimmed = message.text.trim();
    const normalizedFiles = message.files.map((file) => ({
      ...file,
      mediaType: normalizeAttachmentMediaType(file.mediaType, file.filename),
    }));

    if (!trimmed && normalizedFiles.length === 0) {
      return;
    }

    const state = get();
    const conversationId = state.selectedConversationId;
    if (!conversationId) {
      throw new Error('No conversation selected.');
    }

    const draft = state.draftsByConversation[conversationId];
    if (draft?.status === 'streaming') {
      return;
    }

    const detail =
      state.conversationDetails[conversationId] ??
      (await window.atlasChat.conversations.getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE }));
    const modelId =
      resolveSelectedModelId(
        conversationId,
        state.selectedModelIdByConversation,
        { ...state.conversationDetails, [conversationId]: detail },
        state.models
      ) ?? chooseDefaultModel(state.models, detail.conversation.defaultProviderId ?? state.settings?.defaultProviderId);

    if (!modelId) {
      notify({ tone: 'error', title: 'Refresh the model catalog and select a model before sending.' });
      return;
    }

    const selectedModel = getModelById(state.models, modelId);
    const providerId = selectedModel?.providerId ?? detail.conversation.defaultProviderId ?? state.settings?.defaultProviderId;
    if (!selectedModel || !providerId) {
      notify({ tone: 'error', title: 'Select a valid model before sending.' });
      return;
    }

    const unsupportedAttachment = normalizedFiles.find(
      (file) => !isSupportedAttachmentMediaType(file.mediaType, file.filename),
    );
    if (unsupportedAttachment) {
      notify({ tone: 'error', title: `${unsupportedAttachment.filename ?? 'This file'} is not a supported attachment type.` });
      return;
    }

    const totalAttachmentBytes = sumAttachmentSize(normalizedFiles);
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      notify({ tone: 'error', title: 'Attachments are too large to send together.' });
      return;
    }

    const attachmentCapabilityError = getAttachmentCapabilityError(selectedModel, normalizedFiles);
    if (attachmentCapabilityError) {
      notify({ tone: 'error', title: attachmentCapabilityError });
      return;
    }

    const credential = findCredential(state.settings, providerId);
    if (!credential?.hasSecret) {
      notify({ tone: 'error', title: `Save a ${resolveProviderMetadata(providerId, state.settings?.customProviders ?? []).label} API key before sending with this model.` });
      set({ activeCredentialProviderId: providerId });
      return;
    }

    const inputParts = [
      ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
      ...normalizedFiles.map((file) => ({
        type: 'file' as const,
        filename: file.filename,
        mediaType: file.mediaType,
        sizeBytes: file.sizeBytes ?? null,
        url: file.url,
      })),
    ];
    const previewContent = getContentPreviewText(trimmed, inputParts);

    let request;
    try {
      request = await window.atlasChat.chat.start({
        conversationId,
        providerId,
        modelId,
        messages: [{ role: 'user' as const, content: previewContent, parts: inputParts }],
        enableTools: Boolean(selectedModel.supportsTools),
        mentions: parseMentions(trimmed),
        temperature: 0.65,
        // Models without a thinking mode ignore this; the adapters gate on the
        // catalog's supportsReasoning before sending anything.
        reasoningEffort: state.settings?.chat.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
        toolPermissionMode: state.settings?.chat.toolPermissionMode ?? DEFAULT_TOOL_PERMISSION_MODE
      });
    } catch (error) {
      notify({ tone: 'error', title: getErrorMessage(error) });
      throw error;
    }

    const now = new Date().toISOString();
    const optimisticId = `optimistic-${request.requestId}`;
    const optimisticMessage = {
      id: optimisticId,
      conversationId,
      role: 'user' as const,
      content: previewContent,
      reasoning: null,
      parts: [{ type: 'text' as const, text: trimmed, state: 'done' as const, id: `${optimisticId}-text-0` }],
      status: 'complete' as const,
      providerId,
      modelId,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: now
    };

    set((current) => ({
      conversationDetails: {
        ...current.conversationDetails,
        [conversationId]: {
          ...detail,
          messages: [...detail.messages, optimisticMessage]
        }
      },
      conversationStats: current.conversationStats
        ? { ...current.conversationStats, storedMessageCount: current.conversationStats.storedMessageCount + 1 }
        : current.conversationStats,
      draftsByConversation: {
        ...current.draftsByConversation,
        [conversationId]: {
          requestId: request.requestId,
          providerId,
          modelId,
          parts: [],
          status: 'streaming',
          startedAt: now
        }
      },
      requestToConversation: { ...current.requestToConversation, [request.requestId]: conversationId },
      conversations: current.conversations
        .map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                updatedAt: now,
                lastMessageAt: now,
                lastMessagePreview: previewContent,
                lastUserMessagePreview: previewContent,
                defaultProviderId: providerId,
                defaultModelId: modelId
              }
            : conversation
        )
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    }));
  },

  resendLastUserMessage: async () => {
    const state = get();
    const conversationId = state.selectedConversationId;
    if (!conversationId) {
      return;
    }
    const detail = state.conversationDetails[conversationId];
    if (!detail) {
      return;
    }
    const lastUser = [...detail.messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) {
      return;
    }
    const text = lastUser.parts
      .filter((part): part is Extract<typeof lastUser.parts[number], { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
      .trim() || lastUser.content.trim();
    if (!text) {
      return;
    }
    await get().sendMessage({ text, files: [] });
  },

  abortConversation: async (conversationId) => {
    const draft = get().draftsByConversation[conversationId];
    if (!draft || draft.status !== 'streaming') {
      return;
    }
    await window.atlasChat.chat.abort(draft.requestId);
  },

  respondToolApproval: async (request) => {
    set((state) => {
      const conversationId = resolveConversationIdForRequest(request.requestId, state);
      if (!conversationId) {
        return state;
      }
      return {
        requestToConversation: { ...state.requestToConversation, [request.requestId]: conversationId }
      };
    });
    await window.atlasChat.chat.respondToolApproval(request);
  },

  deleteConversation: async (conversationId) => {
    const state = get();
    const draft = state.draftsByConversation[conversationId];

    if (draft?.status === 'streaming') {
      await window.atlasChat.chat.abort(draft.requestId);
    }

    // Snapshot the previous state so we can roll back if the IPC delete fails.
    const previousDetail = state.conversationDetails[conversationId];
    const previousDraft = state.draftsByConversation[conversationId];
    const previousSelectedModel = state.selectedModelIdByConversation[conversationId];
    const previousSequence = state.runtimeSequenceByConversation[conversationId];
    const previousLoadingOlder = state.isLoadingOlderByConversation[conversationId];
    const previousConversations = state.conversations;
    const previousSelectedId = state.selectedConversationId;
    const previousRequestMap = state.requestToConversation;

    set((current) => {
      const { [conversationId]: _deletedDetail, ...restDetails } = current.conversationDetails;
      const { [conversationId]: _deletedDraft, ...restDrafts } = current.draftsByConversation;
      const { [conversationId]: _deletedModel, ...restSelectedModels } = current.selectedModelIdByConversation;
      const { [conversationId]: _deletedSequence, ...restSequences } = current.runtimeSequenceByConversation;
      const { [conversationId]: _loadingOlder, ...restLoadingOlder } = current.isLoadingOlderByConversation;
      const requestToConversation = Object.fromEntries(
        Object.entries(current.requestToConversation).filter(([, mappedConversationId]) => mappedConversationId !== conversationId)
      );
      const conversations = current.conversations.filter((conversation) => conversation.id !== conversationId);
      const nextSelectedConversationId =
        current.selectedConversationId === conversationId
          ? conversations[0]?.id ?? null
          : current.selectedConversationId;

      return {
        conversations,
        conversationDetails: restDetails,
        draftsByConversation: restDrafts,
        selectedModelIdByConversation: restSelectedModels,
        runtimeSequenceByConversation: restSequences,
        isLoadingOlderByConversation: restLoadingOlder,
        inactiveConversationIds: current.inactiveConversationIds.filter((id) => id !== conversationId),
        requestToConversation,
        selectedConversationId: nextSelectedConversationId
      };
    });

    try {
      await window.atlasChat.conversations.delete(conversationId);
    } catch (error) {
      // Roll back the optimistic UI update so the conversation reappears.
      set((current) => ({
        conversationDetails: previousDetail
          ? { ...current.conversationDetails, [conversationId]: previousDetail }
          : current.conversationDetails,
        draftsByConversation: previousDraft
          ? { ...current.draftsByConversation, [conversationId]: previousDraft }
          : current.draftsByConversation,
        selectedModelIdByConversation: previousSelectedModel
          ? { ...current.selectedModelIdByConversation, [conversationId]: previousSelectedModel }
          : current.selectedModelIdByConversation,
        runtimeSequenceByConversation: previousSequence
          ? { ...current.runtimeSequenceByConversation, [conversationId]: previousSequence }
          : current.runtimeSequenceByConversation,
        isLoadingOlderByConversation: previousLoadingOlder
          ? { ...current.isLoadingOlderByConversation, [conversationId]: previousLoadingOlder }
          : current.isLoadingOlderByConversation,
        conversations: previousConversations,
        requestToConversation: previousRequestMap,
        selectedConversationId: previousSelectedId
      }));
      notify({ tone: 'error', title: getErrorMessage(error) });
      return;
    }

    const [conversations, conversationStats] = await Promise.all([
      window.atlasChat.conversations.list(),
      window.atlasChat.conversations.getStats()
    ]);

    if (conversations.length === 0) {
      const createdConversation = await window.atlasChat.conversations.create();
      await get().refreshConversationList();
      await get().loadConversation(createdConversation.id);
      return;
    }

    const nextSelectedConversationId = get().selectedConversationId;
    set({ conversations, conversationStats });

    if (nextSelectedConversationId && conversations.some((conversation) => conversation.id === nextSelectedConversationId)) {
      const loadedDetail = get().conversationDetails[nextSelectedConversationId];
      if (!loadedDetail) {
        await get().loadConversation(nextSelectedConversationId);
      }
      return;
    }

    await get().loadConversation(conversations[0].id);
  },

  handleStreamEvent: async (event) => {
    const state = get();
    const conversationId =
      event.type === 'runtime-sync'
        ? event.conversationId
        : resolveConversationIdForRequest(event.requestId, state);

    if (!conversationId) {
      return;
    }

    if (!state.requestToConversation[event.requestId]) {
      set((current) => ({
        requestToConversation: { ...current.requestToConversation, [event.requestId]: conversationId }
      }));
    }

    if (event.type === 'runtime-sync') {
      const currentSequence = get().runtimeSequenceByConversation[conversationId] ?? 0;
      if (event.sequence <= currentSequence) {
        return;
      }
      const recovery = await window.atlasChat.chat.recoverEvents({
        conversationId,
        afterSequence: currentSequence,
      });
      if (recovery.events.length === 0) {
        const snapshot = await window.atlasChat.chat.getRuntimeState({ conversationId });
        set((current) => ({
          ...applyRuntimeSnapshotToStore(current, conversationId, snapshot),
          requestToConversation: { ...current.requestToConversation, [event.requestId]: conversationId },
        }));
        return;
      }
      set((current) => applyRecoveredRuntimeEventsToStore(current, conversationId, recovery.events));
      return;
    }

    // Apply a per-stream event (text/reasoning/tool/visual). The pure
    // reducer handles the fan-out to draft + detail so this branch stays
    // short and obvious.
    const streamPatch = applyStreamingEvent(state, conversationId, event);
    if (streamPatch) {
      set((current) => ({ ...current, ...streamPatch }));
      return;
    }

    if (event.type === 'meta') {
      const metaPatch = applyMetaEvent(state, conversationId, event);
      if (metaPatch) {
        set((current) => ({ ...current, ...metaPatch }));
      }
      return;
    }

    if (event.type === 'error') {
      const [page, conversations, conversationStats, diagnostics] = await Promise.all([
        window.atlasChat.conversations.getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE }),
        window.atlasChat.conversations.list(),
        window.atlasChat.conversations.getStats(),
        window.atlasChat.diagnostics.getSnapshot()
      ]);
      const shouldShowNotice = event.code === 'auth_error' || event.code === 'missing_credential';

      set((s) => {
        const draft = s.draftsByConversation[conversationId];
        const { [event.requestId]: _omitted, ...restRequests } = s.requestToConversation;
        const nextDrafts = { ...s.draftsByConversation };

        if (draft) {
          nextDrafts[conversationId] = {
            ...draft,
            status: event.code === 'aborted' ? 'aborted' : 'error',
            errorMessage: event.message
          };
        } else {
          delete nextDrafts[conversationId];
        }

        return {
          requestToConversation: restRequests,
          conversationDetails: {
            ...s.conversationDetails,
            [conversationId]: mergeConversationPage(s.conversationDetails[conversationId], page)
          },
          conversations,
          conversationStats,
          diagnostics,
          draftsByConversation: nextDrafts
        };
      });

      if (shouldShowNotice) {
        notify({ tone: 'error', title: event.message });
      }
      return;
    }

    // Terminal event (finish / completion): drop the draft and refresh from
    // the main process so the persisted message is the source of truth.
    const [page, conversations, conversationStats, diagnostics] = await Promise.all([
      window.atlasChat.conversations.getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE }),
      window.atlasChat.conversations.list(),
      window.atlasChat.conversations.getStats(),
      window.atlasChat.diagnostics.getSnapshot()
    ]);

    set((s) => {
      const { [conversationId]: draft, ...restDrafts } = s.draftsByConversation;
      const { [event.requestId]: _omitted, ...restRequests } = s.requestToConversation;

      return {
        requestToConversation: restRequests,
        draftsByConversation: restDrafts,
        conversationDetails: {
          ...s.conversationDetails,
          [conversationId]: mergeConversationPage(s.conversationDetails[conversationId], page)
        },
        conversations,
        conversationStats,
        diagnostics
      };
    });
  },
}));

// =============================================================================
// Helpers
// =============================================================================
function findConfiguredCredential(settings: SettingsSummary | null): ProviderCredentialSummary | null {
  return settings?.providers.find((provider) => provider.hasSecret) ?? null;
}

function buildBootstrapConversationDetails(
  selectedConversationId: string | null,
  detail: ConversationPage | null | undefined,
  runtimeState: RuntimeStateSnapshot | null
) {
  if (!selectedConversationId) return {};
  const mergedConversation = runtimeState?.conversation ?? detail?.conversation ?? null;
  if (runtimeState && mergedConversation) {
    return {
      [selectedConversationId]: {
        conversation: mergedConversation,
        messages: runtimeState.messages ?? [],
        hasOlder: detail?.hasOlder ?? false,
        nextCursor: detail?.nextCursor ?? null,
        limit: detail?.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE,
      },
    };
  }
  if (detail) {
    return { [selectedConversationId]: detail };
  }
  return {};
}

// =============================================================================
// Selectors
// =============================================================================
export function selectLoadedConversationMetrics(state: AppState) {
  return getLoadedConversationCounts(state.conversationDetails);
}

export function selectDiagnosticsSummary(state: AppState) {
  const loadedMetrics = getLoadedConversationCounts(state.conversationDetails);
  return {
    rendererHeapBytes: collectRendererHeapBytes(),
    loadedConversationCount: loadedMetrics.loadedConversationCount,
    loadedMessageCount: loadedMetrics.loadedMessageCount,
    storedConversationCount: state.conversationStats?.storedConversationCount ?? 0,
    storedMessageCount: state.conversationStats?.storedMessageCount ?? 0,
    databaseSizeBytes: state.conversationStats?.databaseSizeBytes ?? state.diagnostics?.databaseSizeBytes ?? 0,
    mainProcessRssBytes: state.diagnostics?.mainProcess.rssBytes ?? null,
    collectedAt: state.diagnostics?.collectedAt ?? null,
    build: state.diagnostics?.build ?? null,
    mainProcess: state.diagnostics?.mainProcess ?? null
  };
}

export function selectCompactedConversationForCache(detail: ConversationPage) {
  return compactConversationPage(detail);
}

// Re-export helper for tests that need to drive the pure reducers directly.
export const _internal = { applyRuntimeSnapshotToStore, applyRecoveredRuntimeEventsToStore, applyStreamingEvent, applyMetaEvent };
