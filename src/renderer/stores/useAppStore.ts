import { create } from 'zustand';

import type {
  ChatMessagePart,
  ConversationDetail,
  ConversationSummary,
  ModelSummary,
  ProviderCredentialSummary,
  ProviderId,
  SettingsSummary,
  StreamEvent
} from '../../shared/contracts';
import { applyStreamEventToParts } from '../../shared/messageParts';

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

type Notice = {
  tone: 'error' | 'success' | 'info';
  message: string;
};

type RefreshModelsOptions = {
  silent?: boolean;
};

type AppState = {
  bootstrapping: boolean;
  initialized: boolean;
  bootstrapError: string | null;
  settingsDialogOpen: boolean;
  keyDraft: string;
  isSavingKey: boolean;
  isValidatingKey: boolean;
  isRefreshingModels: boolean;
  settings: SettingsSummary | null;
  models: ModelSummary[];
  conversations: ConversationSummary[];
  conversationDetails: Record<string, ConversationDetail>;
  selectedConversationId: string | null;
  selectedModelIdByConversation: Record<string, string>;
  draftsByConversation: Record<string, DraftState | undefined>;
  requestToConversation: Record<string, string>;
  notice: Notice | null;
  bootstrap: () => Promise<void>;
  refreshModels: (options?: RefreshModelsOptions) => Promise<void>;
  refreshConversationList: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  createConversation: () => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  setKeyDraft: (value: string) => void;
  saveOpenRouterKey: () => Promise<void>;
  validateOpenRouterKey: () => Promise<void>;
  updatePreferences: (patch: { showFreeOnlyByDefault?: boolean }) => Promise<void>;
  setSelectedModel: (conversationId: string, modelId: string) => void;
  sendMessage: (content: string) => Promise<void>;
  abortConversation: (conversationId: string) => Promise<void>;
  handleStreamEvent: (event: StreamEvent) => Promise<void>;
  dismissNotice: () => void;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function findOpenRouterCredential(settings: SettingsSummary | null): ProviderCredentialSummary | null {
  return settings?.providers.find((provider) => provider.providerId === 'openrouter') ?? null;
}

function resolveSelectedModelId(
  selectedConversationId: string | null,
  selectedModelIdByConversation: Record<string, string>,
  conversationDetails: Record<string, ConversationDetail>,
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

function chooseDefaultModel(models: ModelSummary[]) {
  return models.find((model) => model.isFree && !model.archived)?.id ?? models[0]?.id ?? null;
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapping: true,
  initialized: false,
  bootstrapError: null,
  settingsDialogOpen: false,
  keyDraft: '',
  isSavingKey: false,
  isValidatingKey: false,
  isRefreshingModels: false,
  settings: null,
  models: [],
  conversations: [],
  conversationDetails: {},
  selectedConversationId: null,
  selectedModelIdByConversation: {},
  draftsByConversation: {},
  requestToConversation: {},
  notice: null,

  bootstrap: async () => {
    set({
      bootstrapping: true,
      bootstrapError: null
    });

    try {
      const settings = await window.cheapChat.settings.getSummary();
      let conversations = await window.cheapChat.conversations.list();

      if (conversations.length === 0) {
        const createdConversation = await window.cheapChat.conversations.create();
        conversations = [createdConversation];
      }

      const selectedConversationId = conversations[0]?.id ?? null;
      const [detail, models] = await Promise.all([
        selectedConversationId ? window.cheapChat.conversations.get(selectedConversationId) : Promise.resolve(null),
        window.cheapChat.models.list({
          freeOnly: settings.showFreeOnlyByDefault,
          includeArchived: false,
          allowStale: true
        })
      ]);

      const defaultModelId = chooseDefaultModel(models);

      set({
        bootstrapping: false,
        initialized: true,
        settings,
        models,
        conversations,
        selectedConversationId,
        conversationDetails: detail && selectedConversationId ? { [selectedConversationId]: detail } : {},
        selectedModelIdByConversation:
          defaultModelId && selectedConversationId
            ? { [selectedConversationId]: detail?.conversation.defaultModelId ?? defaultModelId }
            : {}
      });

      if (findOpenRouterCredential(settings)?.hasSecret) {
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
      const models = await window.cheapChat.models.refresh();
      const settings = await window.cheapChat.settings.getSummary();
      const state = get();
      const selectedModelId = resolveSelectedModelId(
        state.selectedConversationId,
        state.selectedModelIdByConversation,
        state.conversationDetails,
        models
      );

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
        notice: silent
          ? current.notice
          : {
              tone: 'success',
              message: 'Model catalog refreshed.'
            }
      }));
    } catch (error) {
      set((current) => ({
        isRefreshingModels: false,
        notice: silent
          ? current.notice
          : {
              tone: 'error',
              message: getErrorMessage(error)
            }
      }));
    }
  },

  refreshConversationList: async () => {
    const conversations = await window.cheapChat.conversations.list();
    set({ conversations });
  },

  loadConversation: async (conversationId) => {
    const detail = await window.cheapChat.conversations.get(conversationId);
    set((state) => ({
      selectedConversationId: conversationId,
      conversationDetails: {
        ...state.conversationDetails,
        [conversationId]: detail
      },
      selectedModelIdByConversation:
        detail.conversation.defaultModelId && !state.selectedModelIdByConversation[conversationId]
          ? {
              ...state.selectedModelIdByConversation,
              [conversationId]: detail.conversation.defaultModelId
            }
          : state.selectedModelIdByConversation
    }));
  },

  createConversation: async () => {
    const created = await window.cheapChat.conversations.create();
    await get().refreshConversationList();
    await get().loadConversation(created.id);
  },

  openSettings: () => set({ settingsDialogOpen: true }),
  closeSettings: () => set({ settingsDialogOpen: false }),
  setKeyDraft: (value) => set({ keyDraft: value }),

  saveOpenRouterKey: async () => {
    const secret = get().keyDraft.trim();
    if (!secret) {
      set({
        notice: {
          tone: 'error',
          message: 'Enter an OpenRouter API key before saving.'
        }
      });
      return;
    }

    set({ isSavingKey: true });

    try {
      const settings = await window.cheapChat.settings.saveOpenRouterKey(secret);
      set({
        isSavingKey: false,
        settings,
        keyDraft: '',
        notice: {
          tone: 'success',
          message: 'OpenRouter key saved to the OS keychain.'
        }
      });
    } catch (error) {
      set({
        isSavingKey: false,
        notice: {
          tone: 'error',
          message: getErrorMessage(error)
        }
      });
    }
  },

  validateOpenRouterKey: async () => {
    set({ isValidatingKey: true });

    try {
      const settings = await window.cheapChat.settings.validateOpenRouterKey();
      set({
        isValidatingKey: false,
        settings,
        notice: {
          tone: 'success',
          message: 'OpenRouter key validated successfully.'
        }
      });
      await get().refreshModels({ silent: true });
    } catch (error) {
      set({
        isValidatingKey: false,
        notice: {
          tone: 'error',
          message: getErrorMessage(error)
        }
      });
    }
  },

  updatePreferences: async (patch) => {
    const settings = await window.cheapChat.settings.updatePreferences(patch);
    const models = await window.cheapChat.models.list({
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
              [state.selectedConversationId]: chooseDefaultModel(models) ?? ''
            }
          : state.selectedModelIdByConversation
    }));
  },

  setSelectedModel: (conversationId, modelId) => {
    set((state) => ({
      selectedModelIdByConversation: {
        ...state.selectedModelIdByConversation,
        [conversationId]: modelId
      }
    }));
  },

  sendMessage: async (content) => {
    const trimmed = content.trim();
    if (!trimmed) {
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

    const detail = state.conversationDetails[conversationId] ?? (await window.cheapChat.conversations.get(conversationId));
    const modelId =
      resolveSelectedModelId(
        conversationId,
        state.selectedModelIdByConversation,
        {
          ...state.conversationDetails,
          [conversationId]: detail
        },
        state.models
      ) ?? chooseDefaultModel(state.models);

    if (!modelId) {
      set({
        notice: {
          tone: 'error',
          message: 'Refresh the model catalog and select a model before sending.'
        }
      });
      return;
    }

    const completeMessages = detail.messages
      .filter((message) => message.status === 'complete')
      .map((message) => ({
        role: message.role,
        content: message.content
      }));

    const request = await window.cheapChat.chat.start({
      conversationId,
      providerId: 'openrouter' as const,
      modelId,
      messages: [...completeMessages, { role: 'user' as const, content: trimmed }],
      enableTools: Boolean(state.models.find((model) => model.id === modelId)?.supportsTools),
      temperature: 0.65
    });

    const now = new Date().toISOString();

    set((current) => ({
      conversationDetails: {
        ...current.conversationDetails,
        [conversationId]: {
          conversation: detail.conversation,
          messages: [
            ...detail.messages,
            {
              id: `optimistic-${request.requestId}`,
              conversationId,
              role: 'user' as const,
              content: trimmed,
              reasoning: null,
              parts: [
                {
                  id: `text-${request.requestId}`,
                  type: 'text' as const,
                  text: trimmed,
                  state: 'done' as const
                }
              ],
              status: 'complete' as const,
              providerId: 'openrouter' as const,
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
      draftsByConversation: {
        ...current.draftsByConversation,
        [conversationId]: {
          requestId: request.requestId,
          providerId: 'openrouter' as const,
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
                lastMessagePreview: trimmed,
                defaultProviderId: 'openrouter' as const,
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

    await window.cheapChat.chat.abort(draft.requestId);
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
      const detail = await window.cheapChat.conversations.get(conversationId);
      const conversations = await window.cheapChat.conversations.list();
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
            [conversationId]: detail
          },
          conversations,
          draftsByConversation: {
            ...state.draftsByConversation,
            [conversationId]: {
              ...draft,
              status: event.code === 'aborted' ? 'aborted' : 'error',
              errorMessage: event.message
            }
          },
          notice: shouldShowNotice
            ? {
                tone: 'error',
                message: event.message
              }
            : null
        };
      });
      return;
    }

    const detail = await window.cheapChat.conversations.get(conversationId);
    const conversations = await window.cheapChat.conversations.list();

    set((state) => {
      const { [conversationId]: _draft, ...restDrafts } = state.draftsByConversation;
      const { [event.requestId]: _omitted, ...restRequests } = state.requestToConversation;

      return {
        requestToConversation: restRequests,
        draftsByConversation: restDrafts,
        conversationDetails: {
          ...state.conversationDetails,
          [conversationId]: detail
        },
        conversations
      };
    });
  },

  dismissNotice: () => set({ notice: null })
}));
