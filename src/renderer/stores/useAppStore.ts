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
  ToolApprovalResponseRequest,
  ToolPermissionMode,
  WorkspaceMode,
  WorkspaceProject
} from '../../shared/contracts';
import { isWorkspaceModeReady } from '../../shared/workspaceModes';
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
import { notify, notifyError } from '../lib/notify';
import {
  applyMetaEvent,
  applyNoticeEvent,
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

/**
 * A composer attachment staged but not yet sent. Structurally identical to
 * `ComposerAttachment` in the composer; declared here so the store does not
 * have to import from the component tree.
 */
export type ComposerAttachmentDraft = {
  id: string;
  type: 'file';
  mediaType: string;
  url: string;
  filename?: string;
  sizeBytes?: number;
};

/** Stable identity so consumers do not re-render on every empty read. */
export const EMPTY_COMPOSER_ATTACHMENTS: ComposerAttachmentDraft[] = [];

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
  /** Unsent composer text, per conversation. A single global string leaked
   *  half-typed messages into whichever thread you switched to. */
  composerDraftsByConversation: Record<string, string>;
  /** Staged (not yet sent) composer attachments, per conversation. */
  composerAttachmentsByConversation: Record<string, ComposerAttachmentDraft[]>;
  draftsByConversation: Record<string, DraftState | undefined>;
  requestToConversation: Record<string, string>;
  runtimeSequenceByConversation: Record<string, number>;
  /** Every folder the user has attached, most recently used first. */
  projects: WorkspaceProject[];
  updateState: AppUpdateSnapshot;
  bootstrap: () => Promise<void>;
  refreshModels: (options?: RefreshModelsOptions) => Promise<void>;
  /** Re-reads the cached catalog after a main-process change, no network. */
  reloadModels: () => Promise<void>;
  refreshConversationList: () => Promise<void>;
  refreshConversationStats: () => Promise<void>;
  refreshDiagnostics: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  loadOlderMessages: (conversationId: string) => Promise<void>;
  createConversation: () => Promise<void>;
  /** New conversation already bound to a project and set to Code mode. */
  createConversationInProject: (projectId: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  /** Opens the native folder picker unless a root is supplied. Null when cancelled. */
  attachProject: (options?: { root?: string; conversationId?: string }) => Promise<WorkspaceProject | null>;
  detachProject: (projectId: string) => Promise<void>;
  setConversationWorkspace: (
    conversationId: string,
    patch: { mode?: WorkspaceMode; projectId?: string | null }
  ) => Promise<void>;
  setConversationToolPermissionMode: (
    conversationId: string,
    mode: ToolPermissionMode
  ) => Promise<void>;
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
  setComposerDraft: (conversationId: string, value: string) => void;
  setComposerAttachments: (
    conversationId: string,
    updater: (previous: ComposerAttachmentDraft[]) => ComposerAttachmentDraft[]
  ) => void;
  /**
   * Clear a thread's composer text and retire the attachments that were
   * actually sent. `sentAttachmentIds` is the snapshot taken when the send
   * began — anything staged afterwards survives.
   */
  clearComposerDraft: (conversationId: string, sentAttachmentIds?: readonly string[]) => void;
  selectAdjacentConversation: (direction: 'previous' | 'next') => Promise<void>;
  selectConversationByIndex: (index: number) => Promise<void>;
  sendMessage: (message: {
    text: string;
    files: ChatInputFilePart[];
    /**
     * The thread the send was composed in, captured before the composer's
     * awaited blob→dataURL conversion. Without it we would re-read
     * `selectedConversationId` here and post into whatever thread the user
     * switched to mid-conversion. Falls back to the selection when absent.
     */
    conversationId?: string;
  }) => Promise<void>;
  resendLastUserMessage: () => Promise<void>;
  abortConversation: (conversationId: string) => Promise<void>;
  respondToolApproval: (request: ToolApprovalResponseRequest) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
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

  // The explicit pick is checked against the catalog like the persisted one:
  // disabling or deleting a provider takes its models out of the catalog while
  // every conversation that had chosen one still names it, and an id nothing can
  // serve is not a selection — it is a send that fails in the main process.
  const explicit = selectedModelIdByConversation[selectedConversationId];
  if (explicit && models.some((model) => model.id === explicit)) {
    return explicit;
  }

  const persisted = conversationDetails[selectedConversationId]?.conversation.defaultModelId;
  if (persisted && models.some((model) => model.id === persisted)) {
    return persisted;
  }

  // Null, not `models[0]`: this only answers "does the conversation already have
  // a model?". Every caller falls through to `chooseDefaultModel`, which knows
  // about the remembered model and skips archived entries — returning the first
  // catalog row here preempted that and was why a new chat ignored the last pick.
  return null;
}

/**
 * Re-points conversations whose selected model the catalog no longer offers.
 *
 * Disabling a provider (or deleting one) is the common case: its models leave
 * the catalog immediately, but every conversation that had picked one still
 * names it. Left alone, the picker renders with no model and the send fails
 * against a provider whose adapter the main process has already torn down.
 *
 * Returns the original map when nothing moved, so a reload that changed nothing
 * does not invalidate every subscriber to this slice.
 */
export function repointUnavailableModels(
  selections: Record<string, string>,
  models: ModelSummary[],
  fallbackModelId: string | null
): Record<string, string> {
  const available = new Set(models.filter((model) => !model.archived).map((model) => model.id));
  const next: Record<string, string> = {};
  let changed = false;

  for (const [conversationId, modelId] of Object.entries(selections)) {
    if (available.has(modelId)) {
      next[conversationId] = modelId;
      continue;
    }

    changed = true;
    // With an empty catalog there is nothing to fall back to; the entry is
    // dropped rather than pinned to a model that is also gone.
    if (fallbackModelId) {
      next[conversationId] = fallbackModelId;
    }
  }

  return changed ? next : selections;
}

/**
 * The model a conversation opens on when it has not recorded one of its own.
 *
 * The last model the user picked wins, because it is the only signal that
 * reflects an actual choice — everything after it is inference. Falling straight
 * to "first free model in the catalog" meant every new chat silently reset to
 * some arbitrary free model, no matter what the user had been working in.
 * `lastModelId` arrives pre-validated against the live catalog, so a model whose
 * provider has since been removed simply does not appear here.
 */
export function chooseDefaultModel(
  models: ModelSummary[],
  preferredProviderId?: ProviderId | null,
  lastModelId?: string | null
) {
  const availableModels = models.filter((model) => !model.archived);

  if (lastModelId && availableModels.some((model) => model.id === lastModelId)) {
    return lastModelId;
  }

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
  composerDraftsByConversation: {},
  composerAttachmentsByConversation: {},
  draftsByConversation: {},
  requestToConversation: {},
  runtimeSequenceByConversation: {},
  projects: [],
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
      const [detail, runtimeState, models, updateState, conversationStats, diagnostics, projects] = await Promise.all([
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
        window.atlasChat.diagnostics.getSnapshot(),
        window.atlasChat.projects.list()
      ]);

      const defaultModelId = chooseDefaultModel(models, settings.defaultProviderId, settings.chat.lastModelId);
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
        projects,
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
                  chooseDefaultModel(
                    models,
                    detail?.conversation?.defaultProviderId ?? settings.defaultProviderId,
                    settings.chat.lastModelId
                  ) ??
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

  reloadModels: async () => {
    try {
      const models = await window.atlasChat.models.list({
        freeOnly: false,
        includeArchived: false,
        allowStale: true
      });

      set((current) => {
        const fallbackModelId = chooseDefaultModel(
          models,
          current.settings?.defaultProviderId,
          current.settings?.chat.lastModelId
        );

        return {
          models,
          // This reload is how a window learns a provider was disabled or
          // removed, so it is also where selections pointing into the vanished
          // provider have to be re-pointed.
          selectedModelIdByConversation: repointUnavailableModels(
            current.selectedModelIdByConversation,
            models,
            fallbackModelId
          )
        };
      });
    } catch {
      // The pre-change snapshot stays; the next refresh gets another chance.
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
      ) ?? chooseDefaultModel(models, settings.defaultProviderId, settings.chat.lastModelId);

      set((current) => {
        // Every conversation is checked, not just the visible one: a refresh
        // that drops a provider leaves stale picks behind on the others too,
        // and they surface as a broken send the moment one is opened.
        const repointed = repointUnavailableModels(
          current.selectedModelIdByConversation,
          models,
          selectedModelId
        );

        return {
          isRefreshingModels: false,
          models,
          settings,
          selectedModelIdByConversation:
            selectedModelId && current.selectedConversationId
              ? { ...repointed, [current.selectedConversationId]: selectedModelId }
              : repointed,
        };
      });

      if (!silent) {
        notify({ tone: 'success', title: 'Model catalog refreshed' });
      }
    } catch (error) {
      set({ isRefreshingModels: false });

      if (!silent) {
        notifyError('Could not refresh the model catalog', error);
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
                chooseDefaultModel(
                  current.models,
                  cachedDetail?.conversation.defaultProviderId ?? current.settings?.defaultProviderId,
                  current.settings?.chat.lastModelId
                ) ??
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
        ...applyRuntimeSnapshotToStore(current, conversationId, runtimeState, detail),
        isLoadingConversationId:
          current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId,
        selectedModelIdByConversation:
          !current.selectedModelIdByConversation[conversationId]
            ? {
                ...current.selectedModelIdByConversation,
                [conversationId]:
                  runtimeState.conversation?.defaultModelId ??
                  detail.conversation.defaultModelId ??
                  chooseDefaultModel(
                    current.models,
                    runtimeState.conversation?.defaultProviderId ?? detail.conversation.defaultProviderId ?? current.settings?.defaultProviderId,
                    current.settings?.chat.lastModelId
                  ) ??
                  ''
              }
            : current.selectedModelIdByConversation
      }));
    } catch (error) {
      set((current) => ({
        isLoadingConversationId:
          current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId
      }));
      notifyError('Could not open the conversation', error);
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
      notifyError('Could not load older messages', error);
    }
  },

  createConversation: async () => {
    /*
      "New chat" means new chat *here*. The project comes from the conversation
      on screen, not from the main process's remembered id — that only moves on
      an explicit workspace change, so opening a chat in another folder and
      hitting the shortcut filed the new chat under the previous folder.

      Reading an unfiled chat states `null`, which is equally deliberate: it
      keeps the next chat unfiled instead of adopting the last project used.
    */
    const { conversations, selectedConversationId } = get();
    const active = selectedConversationId
      ? (conversations.find((conversation) => conversation.id === selectedConversationId) ?? null)
      : null;

    const created = await window.atlasChat.conversations.create(
      active ? { projectId: active.projectId } : undefined
    );

    await get().refreshConversationList();
    set((state) => ({
      activeView: 'chat',
      commandPaletteOpen: false,
      modelPickerOpen: false,
      // Main persists this as the new fallback; mirror it so the cached
      // summary does not report a project the user has moved on from.
      settings: state.settings
        ? { ...state.settings, chat: { ...state.settings.chat, lastProjectId: created.projectId } }
        : state.settings
    }));
    await get().loadConversation(created.id);
  },

  createConversationInProject: async (projectId) => {
    // Bound at creation, not patched after: the row used to appear under
    // Recents for a frame and then jump into the project.
    const created = await window.atlasChat.conversations.create({ projectId });
    await get().setConversationWorkspace(created.id, { mode: 'code', projectId });
    await get().refreshConversationList();
    set({ activeView: 'chat', commandPaletteOpen: false, modelPickerOpen: false });
    await get().loadConversation(created.id);
  },

  refreshProjects: async () => {
    set({ projects: await window.atlasChat.projects.list() });
  },

  attachProject: async ({ root, conversationId } = {}) => {
    const project = await window.atlasChat.projects.create(root ? { root } : undefined);

    if (!project) {
      // The user cancelled the picker. Not an error, and nothing changes.
      return null;
    }

    await get().refreshProjects();

    const target = conversationId ?? get().selectedConversationId;
    if (target) {
      await get().setConversationWorkspace(target, { projectId: project.id });
    }

    return project;
  },

  detachProject: async (projectId) => {
    await window.atlasChat.projects.delete(projectId);
    await Promise.all([get().refreshProjects(), get().refreshConversationList()]);
  },

  setConversationWorkspace: async (conversationId, patch) => {
    const previous = get().conversations;

    // Optimistic: the mode switch drives visible chrome, and waiting a round
    // trip to repaint it reads as lag.
    const applyLocally = (conversation: ConversationSummary) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            workspaceMode: patch.mode ?? conversation.workspaceMode,
            projectId: patch.projectId === undefined ? conversation.projectId : patch.projectId
          }
        : conversation;

    set({ conversations: previous.map(applyLocally) });

    try {
      const workspace = await window.atlasChat.conversations.setWorkspace({ conversationId, ...patch });

      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, workspaceMode: workspace.mode, projectId: workspace.projectId }
            : conversation
        ),
        settings: state.settings
          ? {
              ...state.settings,
              chat: {
                ...state.settings.chat,
                workspaceMode: workspace.mode,
                lastProjectId: workspace.projectId
              }
            }
          : state.settings
      }));

      if (patch.projectId) {
        await get().refreshProjects();
      }
    } catch (error) {
      set({ conversations: previous });
      notifyError('Could not update the workspace', error);
    }
  },

  setConversationToolPermissionMode: async (conversationId: string, mode: ToolPermissionMode) => {
    const previous = get().conversations;

    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, toolPermissionMode: mode } : c
      )
    }));

    try {
      await window.atlasChat.conversations.setToolPermissionMode({
        conversationId,
        toolPermissionMode: mode
      });
    } catch (error) {
      set({ conversations: previous });
      notifyError('Could not update tool permission mode', error);
    }
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
      notify({ tone: 'error', title: `Enter a ${metadata.label} API key before saving` });
      return;
    }

    set({ isSavingKey: true });

    try {
      const settings = await window.atlasChat.settings.saveProviderKey(providerId, secret);
      set({ isSavingKey: false, settings, keyDraft: '', activeCredentialProviderId: providerId });
      notify({ tone: 'success', title: `${metadata.label} key saved`, description: 'Stored in the OS keychain' });
    } catch (error) {
      set({ isSavingKey: false });
      notifyError('Could not save the API key', error);
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
      notify({ tone: 'success', title: `${metadata.label} key is valid` });
      await get().refreshModels({ silent: true });
    } catch (error) {
      set({ isValidatingKey: false });
      notifyError('Could not validate the API key', error);
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
              [state.selectedConversationId]:
                chooseDefaultModel(state.models, settings.defaultProviderId, settings.chat.lastModelId) ?? ''
            }
          : state.selectedModelIdByConversation
    }));
  },

  setUpdateState: (snapshot) => set({ updateState: snapshot }),

  checkForUpdates: async ({ manual } = {}) => {
    try {
      const snapshot = await window.atlasChat.updates.check();
      set({ updateState: snapshot });

      // The single owner of update-check feedback — the sidebar menu used to
      // report the same outcome a second time, in a different tone.
      if (!manual) {
        return;
      }

      if (snapshot.status === 'error') {
        notify({ tone: 'error', title: 'Update check failed', description: snapshot.message });
      } else if (snapshot.status === 'not-available') {
        notify({
          tone: 'info',
          title: 'Atlas is up to date',
          description: snapshot.currentVersion ? `Version ${snapshot.currentVersion}` : undefined,
        });
      } else if (snapshot.status === 'available') {
        notify({
          tone: 'info',
          title: 'Update available',
          description: snapshot.latestVersion ?? undefined,
        });
      }
    } catch (error) {
      if (manual) {
        notifyError('Update check failed', error);
      }
    }
  },

  performUpdatePrimaryAction: async () => {
    await window.atlasChat.updates.performPrimaryAction();
  },

  setSelectedModel: (conversationId, modelId) => {
    set((state) => ({
      selectedModelIdByConversation: { ...state.selectedModelIdByConversation, [conversationId]: modelId },
      settings: state.settings
        ? { ...state.settings, chat: { ...state.settings.chat, lastModelId: modelId } }
        : state.settings
    }));

    // Persisted so the choice survives a restart, not just this session. A
    // failure here only costs the remembered default, so it stays silent.
    void window.atlasChat.settings.updatePreferences({ chat: { lastModelId: modelId } }).catch(() => undefined);
  },

  setComposerDraft: (conversationId, value) => {
    set((state) => {
      if ((state.composerDraftsByConversation[conversationId] ?? '') === value) {
        return {};
      }

      return {
        composerDraftsByConversation: { ...state.composerDraftsByConversation, [conversationId]: value }
      };
    });
  },

  setComposerAttachments: (conversationId, updater) => {
    set((state) => {
      const previous = state.composerAttachmentsByConversation[conversationId] ?? EMPTY_COMPOSER_ATTACHMENTS;
      const next = updater(previous);
      if (next === previous) {
        return {};
      }

      return {
        composerAttachmentsByConversation: { ...state.composerAttachmentsByConversation, [conversationId]: next }
      };
    });
  },

  clearComposerDraft: (conversationId, sentAttachmentIds) => {
    set((state) => {
      const { [conversationId]: _text, ...restText } = state.composerDraftsByConversation;
      const { [conversationId]: staged, ...restFiles } = state.composerAttachmentsByConversation;
      const sent = sentAttachmentIds ? new Set(sentAttachmentIds) : null;
      // Only the files that went out with this send are retired: the send is
      // async, so anything staged while it was in flight must stay put.
      const wasSent = (file: ComposerAttachmentDraft) => (sent ? sent.has(file.id) : true);
      const remaining = (staged ?? []).filter((file) => !wasSent(file));

      // Sent files were copied to data URLs for the send; the object URLs
      // they were staged with are now garbage.
      for (const file of staged ?? []) {
        if (wasSent(file) && file.url.startsWith('blob:')) {
          URL.revokeObjectURL(file.url);
        }
      }

      return {
        composerAttachmentsByConversation: remaining.length
          ? { ...restFiles, [conversationId]: remaining }
          : restFiles,
        composerDraftsByConversation: restText
      };
    });
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
    const conversationId = message.conversationId ?? state.selectedConversationId;
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
      ) ??
      chooseDefaultModel(
        state.models,
        detail.conversation.defaultProviderId ?? state.settings?.defaultProviderId,
        state.settings?.chat.lastModelId
      );

    if (!modelId) {
      notify({ tone: 'error', title: 'Select a model before sending', description: 'Refresh the model catalog to load one' });
      return;
    }

    const selectedModel = getModelById(state.models, modelId);
    const providerId = selectedModel?.providerId ?? detail.conversation.defaultProviderId ?? state.settings?.defaultProviderId;
    if (!selectedModel || !providerId) {
      notify({ tone: 'error', title: 'Select a valid model before sending' });
      return;
    }

    const unsupportedAttachment = normalizedFiles.find(
      (file) => !isSupportedAttachmentMediaType(file.mediaType, file.filename),
    );
    if (unsupportedAttachment) {
      notify({ tone: 'error', title: 'Unsupported attachment', description: `${unsupportedAttachment.filename ?? 'This file'} is not a supported type` });
      return;
    }

    const totalAttachmentBytes = sumAttachmentSize(normalizedFiles);
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      notify({ tone: 'error', title: 'Attachments are too large to send together' });
      return;
    }

    const attachmentCapabilityError = getAttachmentCapabilityError(selectedModel, normalizedFiles);
    if (attachmentCapabilityError) {
      // A written sentence from `getAttachmentCapabilityError`, e.g. "Claude
      // Haiku cannot read images" — it belongs in the detail line, under a
      // title that says which step refused.
      notify({ tone: 'error', title: 'Attachment not supported by this model', description: attachmentCapabilityError });
      return;
    }

    const credential = findCredential(state.settings, providerId);
    if (!credential?.hasSecret) {
      notify({ tone: 'error', title: 'API key required', description: `Save a ${resolveProviderMetadata(providerId, state.settings?.customProviders ?? []).label} key to use this model` });
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
        enableTools: selectedModel.supportsTools !== false,
        mentions: parseMentions(trimmed),
        temperature: 0.65,
        // Models without a thinking mode ignore this; the adapters gate on the
        // catalog's supportsReasoning before sending anything.
        reasoningEffort: state.settings?.chat.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
        toolPermissionMode:
          state.conversations.find((c) => c.id === conversationId)?.toolPermissionMode ??
          state.settings?.chat.toolPermissionMode ??
          DEFAULT_TOOL_PERMISSION_MODE
      });
    } catch (error) {
      notifyError('Could not send the message', error);
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
    await get().sendMessage({ text, files: [], conversationId });
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

  renameConversation: async (conversationId, title) => {
    const normalized = title.replace(/\s+/g, ' ').trim().slice(0, 200);
    const previousConversations = get().conversations;
    const previousDetail = get().conversationDetails[conversationId];
    const previousTitle = previousConversations.find(
      (conversation) => conversation.id === conversationId
    )?.title;

    if (!normalized || normalized === previousTitle) {
      return;
    }

    // Optimistic: the row is under the user's cursor, so it must change now.
    set((current) => ({
      conversations: current.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, title: normalized } : conversation
      ),
      conversationDetails: previousDetail
        ? {
            ...current.conversationDetails,
            [conversationId]: {
              ...previousDetail,
              conversation: { ...previousDetail.conversation, title: normalized }
            }
          }
        : current.conversationDetails
    }));

    try {
      await window.atlasChat.conversations.rename(conversationId, normalized);
    } catch (error) {
      // Roll back only this row's title. Restoring the whole snapshot would
      // also undo any reordering, additions or deletions that landed while
      // the rename was in flight.
      set((current) => ({
        conversations: current.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, title: previousTitle ?? conversation.title }
            : conversation
        ),
        conversationDetails: previousDetail
          ? { ...current.conversationDetails, [conversationId]: previousDetail }
          : current.conversationDetails
      }));
      notifyError('Could not rename the conversation', error);
    }
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
      const { [conversationId]: _deletedComposerText, ...restComposerText } = current.composerDraftsByConversation;
      const { [conversationId]: deletedComposerFiles, ...restComposerFiles } = current.composerAttachmentsByConversation;
      // Staged files hold object URLs; dropping the map alone would leak them.
      for (const file of deletedComposerFiles ?? []) {
        if (file.url.startsWith('blob:')) {
          URL.revokeObjectURL(file.url);
        }
      }
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
        composerDraftsByConversation: restComposerText,
        composerAttachmentsByConversation: restComposerFiles,
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
      notifyError('Could not delete the conversation', error);
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
    // Title generation finishes after the turn's `done`, outside any request
    // lifecycle — patch the sidebar row in place and stop.
    if (event.type === 'conversation-title') {
      set((current) => ({
        conversations: current.conversations.map((conversation) =>
          conversation.id === event.conversationId
            ? { ...conversation, title: event.title }
            : conversation
        ),
      }));
      return;
    }

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

    if (event.type === 'notice') {
      const noticePatch = applyNoticeEvent(state, conversationId, event);
      if (noticePatch) {
        set((current) => ({ ...current, ...noticePatch }));
      }
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
        // Whatever the provider or the runtime said, verbatim — so it goes in
        // the description, where it has three lines instead of one.
        notify({ tone: 'error', title: 'Generation failed', description: event.message });
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
export const _internal = { applyRuntimeSnapshotToStore, applyRecoveredRuntimeEventsToStore, applyStreamingEvent, applyMetaEvent, applyNoticeEvent };
