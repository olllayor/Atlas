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
  SettingsSection,
  SettingsSummary,
  SettingsUpdateRequest,
  StreamEvent
} from '../../shared/contracts';
import {
  MAX_TOTAL_ATTACHMENT_SIZE_BYTES,
  getAttachmentCapabilityError,
  getContentPreviewText,
  isSupportedAttachmentMediaType,
  normalizeAttachmentMediaType,
  sumAttachmentSize,
} from '../../shared/attachments';
import { applyStreamEventToParts, buildUserMessageParts } from '../../shared/messageParts';
import { PROVIDER_METADATA } from '../../shared/providerMetadata';
import {
  DEFAULT_CONVERSATION_PAGE_SIZE,
  compactConversationPage,
  getLoadedConversationCounts,
  mergeConversationPage,
  reconcileConversationCache
} from './conversationCache';
import { notify } from '../lib/notify';

type DraftState = {
  requestId: string;
  providerId: ProviderId;
  modelId: string;
  parts: ChatMessagePart[];
  status: 'streaming' | 'error' | 'aborted';
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  startedAt: string;
};

type RefreshModelsOptions = {
  silent?: boolean;
};

type AppView = 'chat' | 'settings';

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
  abortConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  handleStreamEvent: (event: StreamEvent) => Promise<void>;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function findCredential(settings: SettingsSummary | null, providerId: ProviderId): ProviderCredentialSummary | null {
  return settings?.providers.find((provider) => provider.providerId === providerId) ?? null;
}

function findConfiguredCredential(settings: SettingsSummary | null): ProviderCredentialSummary | null {
  return settings?.providers.find((provider) => provider.hasSecret) ?? null;
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

function chooseDefaultModel(models: ModelSummary[], preferredProviderId?: ProviderId | null) {
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
    memory?: {
      usedJSHeapSize?: number;
    };
  }).memory;

  return memory?.usedJSHeapSize ?? null;
}

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
  activeCredentialProviderId: 'openrouter',
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
  updateState: { status: 'idle' },

  bootstrap: async () => {
    set({
      bootstrapping: true,
      bootstrapError: null
    });

    try {
      const settings = await window.atlasChat.settings.getSummary();
      let conversations = await window.atlasChat.conversations.list();

      if (conversations.length === 0) {
        const createdConversation = await window.atlasChat.conversations.create();
        conversations = [createdConversation];
      }

      const selectedConversationId = conversations[0]?.id ?? null;
      const [detail, models, updateState, conversationStats, diagnostics] = await Promise.all([
        selectedConversationId
          ? window.atlasChat.conversations.getPage(selectedConversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE })
          : Promise.resolve(null),
        window.atlasChat.models.list({
          freeOnly: settings.showFreeOnlyByDefault,
          includeArchived: false,
          allowStale: true
        }),
        window.atlasChat.updates.getState(),
        window.atlasChat.conversations.getStats(),
        window.atlasChat.diagnostics.getSnapshot()
      ]);

      const defaultModelId = chooseDefaultModel(models, settings.defaultProviderId);
      const activeCredentialProviderId =
        settings.defaultProviderId ?? findConfiguredCredential(settings)?.providerId ?? 'openrouter';

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
        conversationDetails: detail && selectedConversationId ? { [selectedConversationId]: detail } : {},
        updateState,
        selectedModelIdByConversation:
          defaultModelId && selectedConversationId
            ? {
                [selectedConversationId]:
                  detail?.conversation.defaultModelId ??
                  chooseDefaultModel(models, detail?.conversation.defaultProviderId ?? settings.defaultProviderId) ??
                  defaultModelId
              }
            : {}
      });

      if (models.length === 0 || settings.providers.some((provider) => provider.hasSecret)) {
        void get().refreshModels({ silent: true });
      }
    } catch (error) {
      set({
        bootstrapping: false,
        bootstrapError: getErrorMessage(error)
      });
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
        models: settings.showFreeOnlyByDefault ? models.filter((model) => model.isFree) : models,
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
        notify({
          tone: 'success',
          title: 'Model catalog refreshed.'
        });
      }
    } catch (error) {
      set({ isRefreshingModels: false });

      if (!silent) {
        notify({
          tone: 'error',
          title: getErrorMessage(error)
        });
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
      const detail = await window.atlasChat.conversations.getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE });
      set((current) => ({
        conversationDetails: {
          ...current.conversationDetails,
          [conversationId]: detail
        },
        isLoadingConversationId:
          current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId,
        selectedModelIdByConversation:
          !current.selectedModelIdByConversation[conversationId]
            ? {
                ...current.selectedModelIdByConversation,
                [conversationId]:
                  detail.conversation.defaultModelId ??
                  chooseDefaultModel(current.models, detail.conversation.defaultProviderId ?? current.settings?.defaultProviderId) ??
                  ''
              }
            : current.selectedModelIdByConversation
      }));
    } catch (error) {
      set((current) => ({
        isLoadingConversationId:
          current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId
      }));

      notify({
        tone: 'error',
        title: getErrorMessage(error)
      });
    }
  },

  loadOlderMessages: async (conversationId) => {
    const state = get();
    const detail = state.conversationDetails[conversationId];

    if (!detail?.hasOlder || !detail.nextCursor || state.isLoadingOlderByConversation[conversationId]) {
      return;
    }

    set((current) => ({
      isLoadingOlderByConversation: {
        ...current.isLoadingOlderByConversation,
        [conversationId]: true
      }
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
            isLoadingOlderByConversation: {
              ...current.isLoadingOlderByConversation,
              [conversationId]: false
            }
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
          isLoadingOlderByConversation: {
            ...current.isLoadingOlderByConversation,
            [conversationId]: false
          }
        };
      });
    } catch (error) {
      set((current) => ({
        isLoadingOlderByConversation: {
          ...current.isLoadingOlderByConversation,
          [conversationId]: false
        }
      }));

      notify({
        tone: 'error',
        title: getErrorMessage(error)
      });
    }
  },

  createConversation: async () => {
    const created = await window.atlasChat.conversations.create();
    await get().refreshConversationList();
    set({
      activeView: 'chat',
      commandPaletteOpen: false,
      modelPickerOpen: false
    });
    await get().loadConversation(created.id);
  },

  openSettings: (section = 'general') =>
    set({
      activeView: 'settings',
      settingsSection: section,
      commandPaletteOpen: false,
      modelPickerOpen: false
    }),
  closeSettings: () => set({ activeView: 'chat', modelPickerOpen: false }),
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
    const metadata = PROVIDER_METADATA[providerId];
    if (!secret) {
      notify({
        tone: 'error',
        title: `Enter a ${metadata.label} API key before saving.`
      });
      return;
    }

    set({ isSavingKey: true });

    try {
      const settings = await window.atlasChat.settings.saveProviderKey(providerId, secret);
      set({
        isSavingKey: false,
        settings,
        keyDraft: '',
        activeCredentialProviderId: providerId
      });

      notify({
        tone: 'success',
        title: `${metadata.label} key saved to the OS keychain.`
      });
    } catch (error) {
      set({
        isSavingKey: false
      });

      notify({
        tone: 'error',
        title: getErrorMessage(error)
      });
    }
  },

  validateProviderKey: async () => {
    const state = get();
    const providerId = state.activeCredentialProviderId;
    const secretOverride = state.keyDraft.trim() || undefined;
    const metadata = PROVIDER_METADATA[providerId];
    set({ isValidatingKey: true });

    try {
      const settings = await window.atlasChat.settings.validateProviderKey(providerId, secretOverride);
      set({
        isValidatingKey: false,
        settings,
        keyDraft: '',
      });

      notify({
        tone: 'success',
        title: `${metadata.label} key validated successfully.`
      });
      await get().refreshModels({ silent: true });
    } catch (error) {
      set({
        isValidatingKey: false
      });

      notify({
        tone: 'error',
        title: getErrorMessage(error)
      });
    }
  },

  updatePreferences: async (patch) => {
    const settings = await window.atlasChat.settings.updatePreferences(patch);
    if (typeof patch.showFreeOnlyByDefault !== 'boolean') {
      set({ settings });
      return;
    }

    const models = await window.atlasChat.models.list({
      freeOnly: settings.showFreeOnlyByDefault,
      includeArchived: false,
      allowStale: true
    });

    set((state) => ({
      settings,
      models,
      selectedModelIdByConversation:
        state.selectedConversationId && !state.selectedModelIdByConversation[state.selectedConversationId]
          ? {
              ...state.selectedModelIdByConversation,
              [state.selectedConversationId]: chooseDefaultModel(models, settings.defaultProviderId) ?? ''
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
        notify({
          tone: 'error',
          title: snapshot.message
        });
      }

      if (manual && snapshot.status === 'not-available') {
        notify({
          tone: 'info',
          title: 'Atlas is up to date.'
        });
      }
    } catch (error) {
      if (manual) {
        notify({
          tone: 'error',
          title: getErrorMessage(error)
        });
      }
    }
  },

  performUpdatePrimaryAction: async () => {
    await window.atlasChat.updates.performPrimaryAction();
  },

  setSelectedModel: (conversationId, modelId) => {
    set((state) => ({
      selectedModelIdByConversation: {
        ...state.selectedModelIdByConversation,
        [conversationId]: modelId
      }
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

    set({
      activeView: 'chat',
      commandPaletteOpen: false,
      modelPickerOpen: false
    });
    await get().loadConversation(nextConversation.id);
  },

  selectConversationByIndex: async (index) => {
    const conversation = get().conversations[index];
    if (!conversation) {
      return;
    }

    set({
      activeView: 'chat',
      commandPaletteOpen: false,
      modelPickerOpen: false
    });
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
        {
          ...state.conversationDetails,
          [conversationId]: detail
        },
        state.models
    ) ?? chooseDefaultModel(state.models, detail.conversation.defaultProviderId ?? state.settings?.defaultProviderId);

    if (!modelId) {
      notify({
        tone: 'error',
        title: 'Refresh the model catalog and select a model before sending.'
      });
      return;
    }

    const selectedModel = getModelById(state.models, modelId);
    const providerId = selectedModel?.providerId ?? detail.conversation.defaultProviderId ?? state.settings?.defaultProviderId;

    if (!selectedModel || !providerId) {
      notify({
        tone: 'error',
        title: 'Select a valid model before sending.'
      });
      return;
    }

    const unsupportedAttachment = normalizedFiles.find(
      (file) => !isSupportedAttachmentMediaType(file.mediaType, file.filename),
    );

    if (unsupportedAttachment) {
      notify({
        tone: 'error',
        title: `${unsupportedAttachment.filename ?? 'This file'} is not a supported attachment type.`,
      });
      return;
    }

    const totalAttachmentBytes = sumAttachmentSize(normalizedFiles);
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      notify({
        tone: 'error',
        title: 'Attachments are too large to send together.',
      });
      return;
    }

    const attachmentCapabilityError = getAttachmentCapabilityError(selectedModel, normalizedFiles);
    if (attachmentCapabilityError) {
      notify({
        tone: 'error',
        title: attachmentCapabilityError,
      });
      return;
    }

    const credential = findCredential(state.settings, providerId);
    if (!credential?.hasSecret) {
      notify({
        tone: 'error',
        title: `Save a ${PROVIDER_METADATA[providerId].label} API key before sending with this model.`
      });

      set({
        activeCredentialProviderId: providerId
      });
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
        messages: [
          {
            role: 'user' as const,
            content: previewContent,
            parts: inputParts,
          },
        ],
        enableTools: Boolean(selectedModel.supportsTools),
        temperature: 0.65
      });
    } catch (error) {
      notify({
        tone: 'error',
        title: getErrorMessage(error),
      });
      throw error;
    }

    const now = new Date().toISOString();
    const optimisticParts = buildUserMessageParts({
      content: trimmed,
      parts: inputParts,
      idPrefix: request.requestId,
    });

    set((current) => ({
      conversationDetails: {
        ...current.conversationDetails,
        [conversationId]: {
          ...detail,
          messages: [
            ...detail.messages,
            {
              id: `optimistic-${request.requestId}`,
              conversationId,
              role: 'user' as const,
              content: previewContent,
              reasoning: null,
              parts: optimisticParts,
              status: 'complete' as const,
              providerId,
              modelId,
              inputTokens: null,
              outputTokens: null,
              reasoningTokens: null,
              latencyMs: null,
              errorCode: null,
              createdAt: now
            }
          ]
        }
      },
      conversationStats: current.conversationStats
        ? {
            ...current.conversationStats,
            storedMessageCount: current.conversationStats.storedMessageCount + 1
          }
        : current.conversationStats,
      draftsByConversation: {
        ...current.draftsByConversation,
        [conversationId]: {
          requestId: request.requestId,
          providerId,
          modelId,
          parts: [],
          status: 'streaming' as const,
          startedAt: now
        }
      },
      requestToConversation: {
        ...current.requestToConversation,
        [request.requestId]: conversationId
      },
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

  abortConversation: async (conversationId) => {
    const draft = get().draftsByConversation[conversationId];
    if (!draft || draft.status !== 'streaming') {
      return;
    }

    await window.atlasChat.chat.abort(draft.requestId);
  },

  deleteConversation: async (conversationId) => {
    const state = get();
    const draft = state.draftsByConversation[conversationId];

    if (draft?.status === 'streaming') {
      await window.atlasChat.chat.abort(draft.requestId);
    }

    set((current) => {
      const { [conversationId]: _deletedDetail, ...restDetails } = current.conversationDetails;
      const { [conversationId]: _deletedDraft, ...restDrafts } = current.draftsByConversation;
      const { [conversationId]: _deletedModel, ...restSelectedModels } = current.selectedModelIdByConversation;
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
        isLoadingOlderByConversation: restLoadingOlder,
        inactiveConversationIds: current.inactiveConversationIds.filter((id) => id !== conversationId),
        requestToConversation,
        selectedConversationId: nextSelectedConversationId
      };
    });

    await window.atlasChat.conversations.delete(conversationId);

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
    const conversationId = get().requestToConversation[event.requestId];

    if (!conversationId) {
      return;
    }

    if (
      event.type === 'chunk' ||
      event.type === 'reasoning' ||
      event.type === 'tool-input-start' ||
      event.type === 'tool-input-delta' ||
      event.type === 'tool-input-available' ||
      event.type === 'tool-output-available' ||
      event.type === 'tool-output-error' ||
      event.type === 'tool-output-denied'
    ) {
      set((state) => {
        const draft = state.draftsByConversation[conversationId];
        if (!draft) {
          return state;
        }

        return {
          draftsByConversation: {
            ...state.draftsByConversation,
            [conversationId]: {
              ...draft,
              parts: applyStreamEventToParts(draft.parts, event)
            }
          }
        };
      });
      return;
    }

    if (event.type === 'meta') {
      set((state) => {
        const draft = state.draftsByConversation[conversationId];
        if (!draft) {
          return state;
        }

        return {
          draftsByConversation: {
            ...state.draftsByConversation,
            [conversationId]: {
              ...draft,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              reasoningTokens: event.reasoningTokens,
              latencyMs: event.latencyMs
            }
          }
        };
      });
      return;
    }

    if (event.type === 'error') {
      const [page, conversations, conversationStats, diagnostics] = await Promise.all([
        window.atlasChat.conversations.getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE }),
        window.atlasChat.conversations.list(),
        window.atlasChat.conversations.getStats(),
        window.atlasChat.diagnostics.getSnapshot()
      ]);
      const shouldShowNotice =
        event.code === 'auth_error' || event.code === 'missing_credential';

      set((state) => {
        const draft = state.draftsByConversation[conversationId];
        if (!draft) {
          return state;
        }

        const { [event.requestId]: _omitted, ...restRequests } = state.requestToConversation;

        return {
          requestToConversation: restRequests,
          conversationDetails: {
            ...state.conversationDetails,
            [conversationId]: mergeConversationPage(state.conversationDetails[conversationId], page)
          },
          conversations,
          conversationStats,
          diagnostics,
          draftsByConversation: {
            ...state.draftsByConversation,
            [conversationId]: {
              ...draft,
              status: event.code === 'aborted' ? 'aborted' : 'error',
              errorMessage: event.message
            }
          }
        };
      });

      if (shouldShowNotice) {
        notify({
          tone: 'error',
          title: event.message
        });
      }
      return;
    }

    const [page, conversations, conversationStats, diagnostics] = await Promise.all([
      window.atlasChat.conversations.getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE }),
      window.atlasChat.conversations.list(),
      window.atlasChat.conversations.getStats(),
      window.atlasChat.diagnostics.getSnapshot()
    ]);

    set((state) => {
      const { [conversationId]: draft, ...restDrafts } = state.draftsByConversation;
      const { [event.requestId]: _omitted, ...restRequests } = state.requestToConversation;

      return {
        requestToConversation: restRequests,
        draftsByConversation: restDrafts,
        conversationDetails: {
          ...state.conversationDetails,
          [conversationId]: mergeConversationPage(state.conversationDetails[conversationId], page)
        },
        conversations,
        conversationStats,
        diagnostics
      };
    });
  },

}));

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
