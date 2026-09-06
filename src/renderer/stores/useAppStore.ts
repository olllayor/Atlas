import { create } from 'zustand';

import type {
  AppUpdateSnapshot,
  ChatInputFilePart,
  ChatMessagePart,
  ConversationPage,
  ConversationGoalView,
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
  WorkspaceProject,
  WorkLogEntry
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
import { stripAssistantCitations } from '../../shared/citations';
import type { AssistantCitation, CitedQuoteEntry } from '../../shared/citations';
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
import { antigravityModelLabel, isAntigravityCurrentModel } from '../../shared/antigravityModels';
import { modelNeedsApiKey } from '../components/modelSelectorViewModel';
import { notify, notifyError, repeatingToastId } from '../lib/notify';
import { hasPendingApprovalInParts } from '../lib/attention';
import { formatSnoozeClockLabel } from '../lib/snooze';
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

type AppView = 'chat' | 'settings' | 'landing' | 'sites' | 'plugins';

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

/**
 * Cited quotes staged in the composer tray, per conversation. Objects, not
 * serialized links — the textarea never holds href bytes, so comment edits
 * rewrite an entry instead of hunting link bytes in the draft string.
 */
export type { CitedQuoteEntry };

/** Immutable empty list so selectors return a stable reference when idle. */
export const EMPTY_COMPOSER_CITATIONS: CitedQuoteEntry[] = [];

/** One queued follow-up as the composer dock shows it. */
export type QueuedFollowupEntry = {
  requestId: string;
  preview: string;
};

/** Immutable empty list so selectors return a stable reference when idle. */
export const EMPTY_QUEUED_FOLLOWUPS: QueuedFollowupEntry[] = [];

/**
 * Stand-in for the loaded-page map, for subscribers that only want it under a
 * condition. Returning this instead of the live map keeps their selector
 * result identical across the flushes where the condition is false.
 */
export const EMPTY_CONVERSATION_PAGES: Record<string, ConversationPage> = {};

type AppState = {
  bootstrapping: boolean;
  initialized: boolean;
  bootstrapError: string | null;
  activeView: AppView;
  settingsSection: SettingsSection;
  commandPaletteOpen: boolean;
  commandPaletteInitialQuery: string | null;
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
  /**
   * Archived chats, kept deliberately out of `conversations`.
   *
   * `conversations` is not just the sidebar's data — the command palette and
   * the jump-by-index shortcuts read the same array, so an archived row landing
   * there would be reachable from three places that are supposed to have
   * stopped showing it. This list is a second, on-demand view of the same
   * table and nothing but the Archived section reads it.
   */
  archivedConversations: ConversationSummary[];
  /** True only while the on-demand archive fetch is in flight. */
  isLoadingArchivedConversations: boolean;
  /**
   * Whether `archivedConversations` has ever been fetched. Distinct from
   * "the list is empty": before the first fetch an empty array means "unknown",
   * afterwards it means "there is nothing archived".
   */
  hasLoadedArchivedConversations: boolean;
  conversationDetails: Record<string, ConversationPage>;
  activitiesByConversation: Record<string, WorkLogEntry[]>;
  conversationStats: ConversationStats | null;
  diagnostics: DiagnosticsSnapshot | null;
  inactiveConversationIds: string[];
  isLoadingOlderByConversation: Record<string, boolean>;
  isLoadingConversationId: string | null;
  selectedConversationId: string | null;
  selectedModelIdByConversation: Record<string, string>;
  selectedProviderIdByConversation: Record<string, ProviderId>;
  /** Unsent composer text, per conversation. A single global string leaked
   *  half-typed messages into whichever thread you switched to. */
  composerDraftsByConversation: Record<string, string>;
  /** Staged (not yet sent) composer attachments, per conversation. */
  composerAttachmentsByConversation: Record<string, ComposerAttachmentDraft[]>;
  /** Staged (not yet sent) cited quotes, per conversation. */
  composerCitationsByConversation: Record<string, CitedQuoteEntry[]>;
  draftsByConversation: Record<string, DraftState | undefined>;
  requestToConversation: Record<string, string>;
  runtimeSequenceByConversation: Record<string, number>;
  /**
   * Follow-ups accepted while a conversation's turn was still running, keyed
   * by conversation, oldest first. The main process owns the real queue; this
   * mirrors it just enough for the composer dock to list and cancel entries.
   * An entry disappears the moment any main-side event carries its requestId —
   * that is either dispatch (its turn started) or a terminal event.
   */
  queuedByConversation: Record<string, QueuedFollowupEntry[]>;
  /**
   * The open side chat (C5): an ephemeral parallel transcript hanging off a
   * parent chat. Null when closed. The side row lives outside every listing;
   * promoting it is what gives it a sidebar life of its own.
   */
  sideChat: { parentId: string; sideId: string } | null;
  /** Per-conversation persistent objective (/goal), projected from main. */
  goalsByConversation: Record<string, ConversationGoalView>;
  /** Every folder the user has attached, most recently used first. */
  projects: WorkspaceProject[];
  updateState: AppUpdateSnapshot;
  bootstrap: () => Promise<void>;
  refreshModels: (options?: RefreshModelsOptions) => Promise<void>;
  /** Re-reads the cached catalog after a main-process change, no network. */
  reloadModels: () => Promise<void>;
  refreshConversationList: () => Promise<void>;
  /**
   * Fills `archivedConversations`. Called when the Archived section is first
   * expanded rather than at boot: `includeArchived` scans the whole table, and
   * most sessions never open the section at all.
   */
  loadArchivedConversations: () => Promise<void>;
  refreshConversationStats: () => Promise<void>;
  refreshDiagnostics: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  /**
   * Assistant turns that finished while their conversation was not the
   * selected one, per conversation. The attention model (activity popover,
   * ⌘⌥A) reads this; opening a conversation clears its count.
   */
  unreadByConversation: Record<string, number>;
  markConversationRead: (conversationId: string) => void;
  markConversationUnread: (conversationId: string) => void;
  regenerateConversationTitle: (conversationId: string) => Promise<void>;
  markAllConversationsRead: () => void;
  /**
   * Refetches one conversation's page into the cache without touching the
   * selection or drafts. The subagent composer uses it to pull followup turns
   * into an open child transcript — child turns run outside the normal
   * request/stream plumbing, so no push event carries them.
   */
  reloadConversationDetail: (conversationId: string) => Promise<void>;
  loadOlderMessages: (conversationId: string) => Promise<void>;
  /** Creates a conversation, opens it, and resolves with the created summary (deep links seed drafts from it). */
  createConversation: () => Promise<import('../../shared/contracts').ConversationSummary>;
  /** New conversation already bound to a project and set to Code mode. */
  createConversationInProject: (projectId: string) => Promise<void>;
  /**
   * A new conversation seeded with an existing one's history, opened straight
   * away. The original is untouched.
   */
  forkConversation: (conversationId: string) => Promise<void>;
  /**
   * Opens the side chat for a conversation (defaulting to the one on screen):
   * reuses its most recent side chat when one exists, otherwise starts a new
   * one. The parent's selection never moves.
   */
  openSideChat: (parentConversationId?: string) => Promise<void>;
  /** Closes the side pane. The side row survives, still hidden from listings. */
  closeSideChat: () => void;
  /** Promotes the open side chat into a normal conversation and opens it. */
  promoteSideChat: () => Promise<void>;
  /** Fetches the conversation's goal projection into the map (null clears it). */
  loadGoal: (conversationId: string) => Promise<void>;
  setGoal: (conversationId: string, objective: string, mode?: 'replace' | 'edit') => Promise<ConversationGoalView>;
  pauseGoal: (conversationId: string) => Promise<void>;
  resumeGoal: (conversationId: string) => Promise<void>;
  clearGoal: (conversationId: string) => Promise<void>;
  /** Idempotent: binds the goalsEvent push exactly once per session. */
  bindGoalEvents: () => void;
  refreshProjects: () => Promise<void>;
  /** Opens the native folder picker unless a root is supplied. Null when cancelled. */
  attachProject: (options?: { root?: string; conversationId?: string }) => Promise<WorkspaceProject | null>;
  detachProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, title: string) => Promise<void>;
  setProjectPinned: (projectId: string, pinned: boolean) => Promise<void>;
  setProjectAutoPull: (projectId: string, autoPull: boolean) => Promise<void>;
  setConversationPinned: (conversationId: string, pinned: boolean) => Promise<void>;
  /** Hides the chat from the sidebar without destroying it. Reversible. */
  setConversationArchived: (conversationId: string, archived: boolean) => Promise<void>;
  /** Parks the chat as done (or re-activates it). Settled chats stay listed. */
  setConversationSettled: (conversationId: string, settled: boolean) => Promise<void>;
  /** Snoozes until an ISO wake time, or clears the snooze with null. */
  setConversationSnoozed: (conversationId: string, snoozedUntil: string | null) => Promise<void>;
  setConversationWorkspace: (
    conversationId: string,
    patch: {
      mode?: WorkspaceMode;
      executionTarget?: import('../../shared/workspaceModes').ExecutionTarget;
      projectId?: string | null;
      /** Commitish a fresh worktree starts from; ignored if one already exists. */
      worktreeBaseBranch?: string | null;
    }
  ) => Promise<void>;
  /** Deletes the conversation's git worktree and resets its target to local, with an optimistic list update. */
  removeConversationWorktree: (conversationId: string) => Promise<void>;
  setConversationToolPermissionMode: (
    conversationId: string,
    mode: ToolPermissionMode
  ) => Promise<void>;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  openLanding: () => void;
  closeLanding: () => void;
  openPlugins: () => void;
  closePlugins: () => void;
  openSites: () => void;
  closeSites: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setCommandPaletteInitialQuery: (query: string | null) => void;
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
  setSelectedModel: (conversationId: string, modelId: string, providerId?: ProviderId) => void;
  setComposerDraft: (conversationId: string, value: string) => void;
  setComposerAttachments: (
    conversationId: string,
    updater: (previous: ComposerAttachmentDraft[]) => ComposerAttachmentDraft[]
  ) => void;
  /**
   * Stages a cited quote in the conversation's tray. Returns the entry key,
   * which the comment editor uses to rewrite this exact entry later.
   */
  addComposerCitation: (conversationId: string, citation: AssistantCitation) => string;
  updateComposerCitation: (conversationId: string, key: string, citation: AssistantCitation) => void;
  removeComposerCitation: (conversationId: string, key: string) => void;
  setComposerCitations: (
    conversationId: string,
    updater: (previous: CitedQuoteEntry[]) => CitedQuoteEntry[]
  ) => void;
  /**
   * Clear a thread's composer text and retire the attachments that were
   * actually sent. `sentAttachmentIds` is the snapshot taken when the send
   * began — anything staged afterwards survives.
   */
  clearComposerDraft: (
    conversationId: string,
    sentAttachmentIds?: readonly string[],
    sentCitationKeys?: readonly string[]
  ) => void;
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
  cancelQueuedFollowup: (requestId: string) => Promise<void>;
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

function isSameModel(a: Pick<ModelSummary, 'id' | 'providerId'>, b: Pick<ModelSummary, 'id' | 'providerId'>) {
  return a.id === b.id && a.providerId === b.providerId;
}

function getModelById(models: ModelSummary[], modelId: string | null, providerId?: ProviderId | null) {
  if (!modelId) {
    return null;
  }
  if (providerId) {
    const exact = models.find((model) => !model.archived && model.id === modelId && model.providerId === providerId);
    if (exact) return exact;
  }
  const candidates = models.filter((model) => model.id === modelId);
  if (candidates.length === 0) return null;
  const nonArchived = candidates.filter((m) => !m.archived);
  const pool = nonArchived.length > 0 ? nonArchived : candidates;
  // Deterministic tie-break: providerId ASC, mirrors DB fallback.
  let best = pool[0];
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].providerId < best.providerId) best = pool[i];
  }
  return best;
}

export function prunePinnedProviders(
  pins: Record<string, ProviderId>,
  selections: Record<string, string>,
  models: ModelSummary[]
): Record<string, ProviderId> {
  const alive = new Set(models.filter((m) => !m.archived).map((m) => `${m.providerId}\u0000${m.id}`));
  let changed = false;
  const next: Record<string, ProviderId> = {};
  for (const [conversationId, providerId] of Object.entries(pins)) {
    const modelId = selections[conversationId];
    if (!modelId) {
      changed = true;
      continue;
    }
    if (alive.has(`${providerId}\u0000${modelId}`)) {
      next[conversationId] = providerId;
    } else {
      changed = true;
    }
  }
  // Also drop pins where no selection exists? Already handled.
  // Identity-stable: return original when nothing moved.
  return changed ? next : pins;
}

export function resolveSelectedModelId(
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
  if (explicit && (models.some((model) => model.id === explicit) || models.length === 0)) {
    return explicit;
  }

  const detail = conversationDetails[selectedConversationId];
  const persisted = detail?.conversation.defaultModelId;
  const isAntigravityConversation =
    detail?.conversation.defaultProviderId === 'antigravity' ||
    (persisted !== undefined && persisted !== null && isAntigravityCurrentModel(persisted));

  if (
    persisted &&
    (models.some((model) => model.id === persisted) ||
      models.length === 0 ||
      isAntigravityConversation)
  ) {
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

/**
 * Keeps only the archived rows out of an `includeArchived` listing.
 *
 * That call returns live *and* archived rows in one array — convenient for the
 * main process, useless here, because the live half is already in
 * `conversations` and a row present in both arrays would render twice.
 */
export function selectArchivedConversations(conversations: ConversationSummary[]) {
  return conversations.filter((conversation) => conversation.archivedAt != null);
}

function toEpochMs(timestamp: string | null | undefined) {
  const value = Date.parse(timestamp ?? '');
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Inserts (or replaces) one row in the archived list, in the order the server
 * would have returned it — most recently updated first, same as
 * `conversations.list()`.
 *
 * Patching rather than refetching is the whole point: a refetch after every
 * archive would re-pay the full-table scan the section is lazy about in the
 * first place, and the row we need is already in hand — `setArchived` resolves
 * to the updated summary.
 */
export function mergeArchivedConversation(
  archived: ConversationSummary[],
  conversation: ConversationSummary
) {
  return [conversation, ...archived.filter((entry) => entry.id !== conversation.id)].sort(
    (left, right) => toEpochMs(right.updatedAt) - toEpochMs(left.updatedAt)
  );
}

/**
 * Whether the Archived section should exist at all, answered without fetching.
 *
 * `storedConversationCount` counts every row in the table; `conversations` is
 * that same table minus `archived_at IS NOT NULL`. The gap between them *is*
 * the archive, which is how a section that only loads on demand can still know
 * to stay hidden for a user who has never archived anything. Once a fetch has
 * landed its result is authoritative and the arithmetic is dropped.
 */
export function hasArchivedConversations(params: {
  storedConversationCount: number | null;
  liveConversationCount: number;
  archivedConversationCount: number;
  hasLoadedArchived: boolean;
}) {
  if (params.hasLoadedArchived) {
    return params.archivedConversationCount > 0;
  }

  return (params.storedConversationCount ?? 0) > params.liveConversationCount;
}

export function resolveArchivedConversationsCount(params: {
  storedConversationCount: number | null;
  liveConversationCount: number;
  archivedConversationCount: number;
  hasLoadedArchived: boolean;
}): number {
  if (params.hasLoadedArchived) {
    return params.archivedConversationCount;
  }
  if (params.storedConversationCount != null) {
    return Math.max(0, params.storedConversationCount - params.liveConversationCount);
  }
  return 0;
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
/** The OS shows one folder picker; a second request while it is up joins the first. */
let attachProjectInFlight: Promise<WorkspaceProject | null> | null = null;
/** Module-level once-guard: the goalsEvent push is bound for the app's lifetime. */
let goalEventsBound = false;

let updatePreferencesSeq = 0;

export const resetUpdatePreferencesSeqForTesting = () => {
  updatePreferencesSeq = 0;
};

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapping: true,
  initialized: false,
  bootstrapError: null,
  activeView: 'chat',
  settingsSection: 'general',
  commandPaletteOpen: false,
  commandPaletteInitialQuery: null,
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
  archivedConversations: [],
  isLoadingArchivedConversations: false,
  hasLoadedArchivedConversations: false,
  conversationDetails: {},
  activitiesByConversation: {},
  conversationStats: null,
  diagnostics: null,
  inactiveConversationIds: [],
  isLoadingOlderByConversation: {},
  isLoadingConversationId: null,
  selectedConversationId: null,
  selectedModelIdByConversation: {},
  selectedProviderIdByConversation: {},
  composerDraftsByConversation: {},
  composerAttachmentsByConversation: {},
  composerCitationsByConversation: {},
  draftsByConversation: {},
  requestToConversation: {},
  runtimeSequenceByConversation: {},
  queuedByConversation: {},
  unreadByConversation: {},
  sideChat: null,
  goalsByConversation: {},
  markConversationRead: (conversationId) => {
    set((current) => {
      if (!(conversationId in current.unreadByConversation)) return {};
      const { [conversationId]: _cleared, ...rest } = current.unreadByConversation;
      return { unreadByConversation: rest };
    });
  },
  markConversationUnread: (conversationId) => {
    set((current) => ({
      unreadByConversation: {
        ...current.unreadByConversation,
        [conversationId]: (current.unreadByConversation[conversationId] ?? 0) + 1 || 1,
      },
    }));
  },
  regenerateConversationTitle: async (conversationId) => {
    try {
      const updated = await window.atlasChat.conversations.regenerateTitle(conversationId);
      set((current) => ({
        conversations: current.conversations.map((c) =>
          c.id === conversationId ? { ...c, title: updated.title } : c
        ),
        archivedConversations: current.archivedConversations.map((c) =>
          c.id === conversationId ? { ...c, title: updated.title } : c
        ),
      }));
    } catch (error) {
      console.error('Failed to regenerate conversation title', error);
    }
  },
  markAllConversationsRead: () => {
    set({ unreadByConversation: {} });
  },
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
          ? window.atlasChat.chat.getRuntimeState({ conversationId: selectedConversationId }).catch(() => null)
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

      const snapshotPatch =
        selectedConversationId && runtimeState
          ? applyRuntimeSnapshotToStore(
              {
                draftsByConversation: {},
                activitiesByConversation: {},
                conversationDetails: {},
                requestToConversation: {},
                runtimeSequenceByConversation: {},
              },
              selectedConversationId,
              runtimeState
            )
          : null;

      // Resolve provider for the bootstrapped selection so (id, provider) travels together.
      const bootstrappedModelId =
        detail?.conversation?.defaultModelId ??
        chooseDefaultModel(
          models,
          detail?.conversation?.defaultProviderId ?? settings.defaultProviderId,
          settings.chat.lastModelId
        ) ??
        defaultModelId;
      const bootstrappedProviderId = (() => {
        if (!bootstrappedModelId || !selectedConversationId) return null;
        const pinned = detail?.conversation?.defaultProviderId ?? null;
        const model = getModelById(models, bootstrappedModelId, pinned);
        return model?.providerId ?? pinned ?? settings.defaultProviderId ?? null;
      })();

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
        draftsByConversation: snapshotPatch?.draftsByConversation ?? {},
        activitiesByConversation: snapshotPatch?.activitiesByConversation ?? {},
        updateState,
        selectedModelIdByConversation:
          bootstrappedModelId && selectedConversationId
            ? { [selectedConversationId]: bootstrappedModelId }
            : {},
        selectedProviderIdByConversation:
          bootstrappedModelId && bootstrappedProviderId && selectedConversationId
            ? { [selectedConversationId]: bootstrappedProviderId }
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

        const repointed = repointUnavailableModels(
          current.selectedModelIdByConversation,
          models,
          fallbackModelId
        );
        const prunedPins = prunePinnedProviders(
          current.selectedProviderIdByConversation,
          repointed,
          models
        );

        return {
          models,
          selectedModelIdByConversation: repointed,
          selectedProviderIdByConversation: prunedPins
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

      set((current) => {
        const selectedModelId =
          resolveSelectedModelId(
            current.selectedConversationId,
            current.selectedModelIdByConversation,
            current.conversationDetails,
            models
          ) ?? chooseDefaultModel(models, settings.defaultProviderId, settings.chat.lastModelId);

        const repointedBase = repointUnavailableModels(
          current.selectedModelIdByConversation,
          models,
          selectedModelId
        );
        const finalSelections =
          selectedModelId && current.selectedConversationId
            ? { ...repointedBase, [current.selectedConversationId]: selectedModelId }
            : repointedBase;

        let nextPins = prunePinnedProviders(current.selectedProviderIdByConversation, finalSelections, models);
        if (selectedModelId && current.selectedConversationId) {
          const existingPin = current.selectedProviderIdByConversation[current.selectedConversationId] ?? null;
          const resolvedModel = getModelById(models, selectedModelId, existingPin);
          const providerToStore =
            resolvedModel?.providerId ??
            current.conversationDetails[current.selectedConversationId!]?.conversation.defaultProviderId ??
            settings.defaultProviderId ??
            null;
          if (providerToStore && nextPins[current.selectedConversationId] !== providerToStore) {
            nextPins = { ...nextPins, [current.selectedConversationId]: providerToStore };
          }
        }

        return {
          isRefreshingModels: false,
          models,
          settings,
          selectedModelIdByConversation: finalSelections,
          selectedProviderIdByConversation: nextPins
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

  loadArchivedConversations: async () => {
    if (get().isLoadingArchivedConversations) {
      return;
    }

    set({ isLoadingArchivedConversations: true });

    try {
      const conversations = await window.atlasChat.conversations.list({ includeArchived: true });
      set({
        archivedConversations: selectArchivedConversations(conversations),
        hasLoadedArchivedConversations: true,
        isLoadingArchivedConversations: false,
      });
    } catch (error) {
      set({ isLoadingArchivedConversations: false });
      notifyError('Could not load archived chats', error);
    }
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

    set((current) => {
      const needsModel = !current.selectedModelIdByConversation[conversationId];
      const modelId = needsModel
        ? (cachedDetail?.conversation.defaultModelId ??
          chooseDefaultModel(
            current.models,
            cachedDetail?.conversation.defaultProviderId ?? current.settings?.defaultProviderId,
            current.settings?.chat.lastModelId
          ) ??
          '')
        : null;
      const providerId = (() => {
        if (!needsModel || !modelId) return null;
        const pinned = cachedDetail?.conversation.defaultProviderId ?? current.settings?.defaultProviderId ?? null;
        const m = getModelById(current.models, modelId, pinned);
        return m?.providerId ?? pinned;
      })();

      return {
        selectedConversationId: conversationId,
        unreadByConversation: current.unreadByConversation[conversationId]
          ? (() => {
              const { [conversationId]: _cleared, ...rest } = current.unreadByConversation;
              return rest;
            })()
          : current.unreadByConversation,
        conversationDetails: cacheState.conversationDetails,
        inactiveConversationIds: cacheState.inactiveConversationIds,
        isLoadingConversationId: cachedDetail ? null : conversationId,
        selectedModelIdByConversation: needsModel && modelId
          ? { ...current.selectedModelIdByConversation, [conversationId]: modelId }
          : current.selectedModelIdByConversation,
        selectedProviderIdByConversation:
          needsModel && modelId && providerId && !current.selectedProviderIdByConversation[conversationId]
            ? { ...current.selectedProviderIdByConversation, [conversationId]: providerId }
            : current.selectedProviderIdByConversation
      };
    });

    if (cachedDetail) {
      return;
    }

    try {
      const pageStart = performance.now();
      const pagePromise = window.atlasChat.conversations
        .getPage(conversationId, { limit: DEFAULT_CONVERSATION_PAGE_SIZE })
        .then((res) => ({ res, durationMs: performance.now() - pageStart }));

      const runtimeStart = performance.now();
      const runtimePromise = window.atlasChat.chat
        .getRuntimeState({ conversationId })
        .then((res) => ({ res, durationMs: performance.now() - runtimeStart }))
        .catch(() => ({ res: null, durationMs: performance.now() - runtimeStart }));

      const [pageResult, runtimeResult] = await Promise.all([pagePromise, runtimePromise]);
      const detail = pageResult.res;
      const activeRuntimeState = runtimeResult.res;

      if (import.meta.env.DEV) {
        console.info(
          `[perf] Cold load conversation ${conversationId}: getPage=${pageResult.durationMs.toFixed(1)}ms (${detail.messages.length} msgs), getRuntimeState=${runtimeResult.durationMs.toFixed(1)}ms`
        );
      }
      set((current) => {
        const needsModel = !current.selectedModelIdByConversation[conversationId];
        const modelId = needsModel
          ? (activeRuntimeState?.conversation?.defaultModelId ??
            detail.conversation.defaultModelId ??
            chooseDefaultModel(
              current.models,
              activeRuntimeState?.conversation?.defaultProviderId ?? detail.conversation.defaultProviderId ?? current.settings?.defaultProviderId,
              current.settings?.chat.lastModelId
            ) ??
            '')
          : null;
        const providerId = (() => {
          if (!needsModel || !modelId) return null;
          const pinned =
            activeRuntimeState?.conversation?.defaultProviderId ?? detail.conversation.defaultProviderId ?? current.settings?.defaultProviderId ?? null;
          const m = getModelById(current.models, modelId, pinned);
          return m?.providerId ?? pinned;
        })();

        const basePatch = activeRuntimeState
          ? applyRuntimeSnapshotToStore(current, conversationId, activeRuntimeState, detail)
          : {
              conversationDetails: {
                ...current.conversationDetails,
                [conversationId]: detail
              }
            };

        return {
          ...basePatch,
          isLoadingConversationId:
            current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId,
          selectedModelIdByConversation: needsModel && modelId
            ? { ...current.selectedModelIdByConversation, [conversationId]: modelId }
            : current.selectedModelIdByConversation,
          selectedProviderIdByConversation:
            needsModel && modelId && providerId && !current.selectedProviderIdByConversation[conversationId]
              ? { ...current.selectedProviderIdByConversation, [conversationId]: providerId }
              : current.selectedProviderIdByConversation
        };
      });
    } catch (error) {
      set((current) => ({
        isLoadingConversationId:
          current.isLoadingConversationId === conversationId ? null : current.isLoadingConversationId
      }));
      notifyError('Could not open the conversation', error);
    }
  },

  reloadConversationDetail: async (conversationId) => {
    try {
      const page = await window.atlasChat.conversations.getPage(conversationId, {
        limit: DEFAULT_CONVERSATION_PAGE_SIZE,
      });
      set((current) => ({
        conversationDetails: {
          ...current.conversationDetails,
          [conversationId]: mergeConversationPage(current.conversationDetails[conversationId], page)
        }
      }));
    } catch {
      // A failed refresh keeps the stale transcript; the next poll retries.
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
      "New chat" means new chat *here*. The project and mode come from the
      conversation on screen, not from the main process's remembered id — that
      only moves on an explicit workspace change, so opening a chat in another
      folder and hitting the shortcut filed the new chat under the previous
      folder.

      Reading an unfiled chat states `null`, which is equally deliberate: it
      keeps the next chat unfiled instead of adopting the last project used.
      Mode rides along for the same reason: a Code project chat spawns the next
      Code project chat, never an unfiled Work chat that would vanish from the
      Code sidebar.
    */
    const { conversations, selectedConversationId, activeView } = get();
    const active = activeView === 'chat' && selectedConversationId
      ? (conversations.find((conversation) => conversation.id === selectedConversationId) ?? null)
      : null;

    const created = await window.atlasChat.conversations.create(
      active ? { projectId: active.projectId, workspaceMode: active.workspaceMode } : undefined
    );

    await get().refreshConversationList();
    set((state) => ({
      activeView: 'chat',
      commandPaletteOpen: false,
      commandPaletteInitialQuery: null,
      modelPickerOpen: false,
      // Main persists this as the new fallback; mirror it so the cached
      // summary does not report a project the user has moved on from.
      settings: state.settings
        ? { ...state.settings, chat: { ...state.settings.chat, lastProjectId: created.projectId } }
        : state.settings
    }));
    await get().loadConversation(created.id);
    return created;
  },

  createConversationInProject: async (projectId) => {
    // Bound at creation with mode: 'code', not patched after: creating with the
    // mode directly avoids mutating the global default workspace mode in settings.
    const created = await window.atlasChat.conversations.create({ projectId, workspaceMode: 'code' });
    await get().refreshConversationList();
    set((state) => ({
      activeView: 'chat',
      commandPaletteOpen: false,
      commandPaletteInitialQuery: null,
      modelPickerOpen: false,
      settings: state.settings
        ? { ...state.settings, chat: { ...state.settings.chat, lastProjectId: created.projectId } }
        : state.settings
    }));
    await get().loadConversation(created.id);
  },

  forkConversation: async (conversationId) => {
    try {
      // No `throughMessageId`: forking from the sidebar has no message in hand,
      // so it takes the whole thread. Picking a point is the transcript's job
      // and the IPC already accepts one.
      const fork = await window.atlasChat.conversations.fork({ conversationId });
      await get().refreshConversationList();
      set({ activeView: 'chat', commandPaletteOpen: false, commandPaletteInitialQuery: null, modelPickerOpen: false });
      await get().loadConversation(fork.id);
    } catch (error) {
      notifyError('Could not fork the chat', error);
    }
  },

  openSideChat: async (parentConversationId) => {
    const parentId = parentConversationId ?? get().selectedConversationId;
    if (!parentId) {
      return;
    }

    try {
      const existing = get().sideChat;
      if (existing?.parentId === parentId) {
        // Already open on this parent: just make sure its page is fresh.
        await get().reloadConversationDetail(existing.sideId);
        return;
      }

      // Reuse the most recent side chat of this parent before minting another,
      // or the ⌘⌥S spam leaves a trail of identical hidden rows.
      const sides = await window.atlasChat.conversations.listSide(parentId);
      const side = sides[0] ?? (await window.atlasChat.conversations.startSide({ conversationId: parentId }));

      await get().reloadConversationDetail(side.id);
      set({ sideChat: { parentId, sideId: side.id } });
    } catch (error) {
      notifyError('Could not open the side chat', error);
    }
  },

  closeSideChat: () => {
    set({ sideChat: null });
  },

  promoteSideChat: async () => {
    const { sideChat } = get();
    if (!sideChat) {
      return;
    }

    try {
      const promoted = await window.atlasChat.conversations.promoteSide(sideChat.sideId);
      set({ sideChat: null });
      if (promoted) {
        await get().refreshConversationList();
        await get().loadConversation(sideChat.sideId);
      } else {
        notify({ tone: 'error', title: 'Nothing to promote', description: 'This side chat is already a normal conversation.' });
      }
    } catch (error) {
      notifyError('Could not promote the side chat', error);
    }
  },

  loadGoal: async (conversationId) => {
    const goal = await window.atlasChat.goals.get(conversationId);
    set((current) => {
      const next = { ...current.goalsByConversation };
      if (goal) {
        next[conversationId] = goal;
      } else if (conversationId in current.goalsByConversation) {
        delete next[conversationId];
      } else {
        return {};
      }
      return { goalsByConversation: next };
    });
  },

  setGoal: async (conversationId, objective, mode) => {
    const goal = await window.atlasChat.goals.set(conversationId, objective, mode);
    set((current) => ({
      goalsByConversation: { ...current.goalsByConversation, [conversationId]: goal },
    }));
    return goal;
  },

  pauseGoal: async (conversationId) => {
    const goal = await window.atlasChat.goals.pause(conversationId);
    if (goal) {
      set((current) => ({ goalsByConversation: { ...current.goalsByConversation, [conversationId]: goal } }));
    }
  },

  resumeGoal: async (conversationId) => {
    const goal = await window.atlasChat.goals.resume(conversationId);
    if (goal) {
      set((current) => ({ goalsByConversation: { ...current.goalsByConversation, [conversationId]: goal } }));
    }
  },

  clearGoal: async (conversationId) => {
    await window.atlasChat.goals.clear(conversationId);
    set((current) => {
      const { [conversationId]: _cleared, ...rest } = current.goalsByConversation;
      return { goalsByConversation: rest };
    });
  },

  bindGoalEvents: () => {
    if (goalEventsBound) return;
    goalEventsBound = true;
    window.atlasChat.goals.onGoalEvent((event) => {
      // A rejection that stops the loop without changing goal state (turn cap)
      // leaves no other trace — surface it here or the user sees silence.
      if (event.notice) {
        notify({ tone: 'info', title: '/goal', description: event.notice });
      }
      set((current) => {
        const next = { ...current.goalsByConversation };
        if (event.goal) {
          next[event.conversationId] = event.goal;
        } else if (event.conversationId in current.goalsByConversation) {
          delete next[event.conversationId];
        } else {
          return {};
        }
        return { goalsByConversation: next };
      });
    });
  },

  refreshProjects: async () => {
    set({ projects: await window.atlasChat.projects.list() });
  },

  attachProject: async ({ root, conversationId } = {}) => {
    const needsPicker = !root;
    // Picker is OS singleton — second opener while picker is up joins first.
    // Explicit `root` is not a picker, so it must not join.
    if (needsPicker && attachProjectInFlight) {
      const picked = await attachProjectInFlight;
      if (picked && conversationId) {
        await get().setConversationWorkspace(conversationId, { projectId: picked.id });
      }
      return picked;
    }

    const run = async (): Promise<WorkspaceProject | null> => {
      const project = await window.atlasChat.projects.create(root ? { root } : undefined);

      if (!project) {
        return null;
      }

      await get().refreshProjects();

      if (conversationId) {
        await get().setConversationWorkspace(conversationId, { projectId: project.id });
      }

      return project;
    };

    if (needsPicker) {
      attachProjectInFlight = run()
        .catch((error) => {
          notifyError('Could not attach the folder', error);
          return null;
        })
        .finally(() => {
          attachProjectInFlight = null;
        });
      return attachProjectInFlight;
    }

    // Non-picker path: no dedupe, each explicit root runs independently.
    try {
      return await run();
    } catch (error) {
      notifyError('Could not attach the folder', error);
      return null;
    }
  },

  renameProject: async (projectId, title) => {
    const next = title.trim();
    if (!next) {
      return;
    }

    // Optimistic: the sidebar row is the thing being renamed, and a round trip
    // before it repaints reads as the rename not having taken.
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, title: next } : project
      ),
    }));

    await window.atlasChat.projects.rename(projectId, next);
    await get().refreshProjects();
  },

  setProjectPinned: async (projectId, pinned) => {
    const previous = get().projects;

    // Optimistic, and stamped locally: the pinned section orders by this value,
    // so a row that waits for the round trip to acquire one lands in the wrong
    // place and then jumps.
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? { ...project, pinnedAt: pinned ? new Date().toISOString() : null }
          : project
      ),
    }));

    try {
      const updated = await window.atlasChat.projects.setPinned(projectId, pinned);
      set((state) => ({
        projects: state.projects.map((project) => (project.id === projectId ? updated : project)),
      }));
    } catch (error) {
      set({ projects: previous });
      notifyError(pinned ? 'Could not pin the project' : 'Could not unpin the project', error);
    }
  },

  setProjectAutoPull: async (projectId, autoPull) => {
    const previous = get().projects;

    // Optimistic like the pin toggle: the checkbox answers the click, and the
    // round trip reconciles. A failure rolls back with a toast.
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, autoPull } : project
      ),
    }));

    try {
      const updated = await window.atlasChat.projects.setAutoPull(projectId, autoPull);
      set((state) => ({
        projects: state.projects.map((project) => (project.id === projectId ? updated : project)),
      }));
    } catch (error) {
      set({ projects: previous });
      notifyError(
        autoPull ? 'Could not enable automatic pull' : 'Could not disable automatic pull',
        error
      );
    }
  },

  setConversationPinned: async (conversationId, pinned) => {
    const previous = get().conversations;

    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, pinnedAt: pinned ? new Date().toISOString() : null }
          : conversation
      ),
    }));

    try {
      const updated = await window.atlasChat.conversations.setPinned({ conversationId, pinned });
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId ? updated : conversation
        ),
      }));
    } catch (error) {
      set({ conversations: previous });
      notifyError(pinned ? 'Could not pin the chat' : 'Could not unpin the chat', error);
    }
  },

  setConversationArchived: async (conversationId, archived) => {
    const previousConversations = get().conversations;
    const previousSelectedId = get().selectedConversationId;
    const title = previousConversations.find((conversation) => conversation.id === conversationId)?.title;

    if (!archived) {
      // Restoring: the row is not in the live list to patch, so there is nothing
      // to do optimistically — the refresh below is the whole update.
      try {
        await window.atlasChat.conversations.setArchived({ conversationId, archived: false });
        // The Archived section is the one place the row *was* visible, so it is
        // dropped here rather than by a refetch: the section fetches lazily
        // precisely to avoid scanning the table, and re-scanning it on every
        // restore would give that back.
        set((state) => ({
          archivedConversations: state.archivedConversations.filter(
            (conversation) => conversation.id !== conversationId
          ),
        }));
        await get().refreshConversationList();
        await get().loadConversation(conversationId);
      } catch (error) {
        notifyError('Could not restore the chat', error);
      }
      return;
    }

    // Archiving only hides the row. The transcript, its drafts and its terminal
    // all stay in memory keyed by id, so a restore lands on a warm conversation
    // rather than a reload — which is the difference between archive and
    // delete, and the reason none of the per-conversation maps are cleared.
    set((state) => {
      const conversations = state.conversations.filter(
        (conversation) => conversation.id !== conversationId
      );

      return {
        conversations,
        selectedConversationId:
          state.selectedConversationId === conversationId
            ? conversations[0]?.id ?? null
            : state.selectedConversationId,
      };
    });

    try {
      const updated = await window.atlasChat.conversations.setArchived({
        conversationId,
        archived: true,
      });

      // Only patch a list that has actually been fetched. Seeding it with this
      // one row would leave a section that looks complete while hiding every
      // chat archived before this session — worse than the empty state, because
      // nothing about it says "not loaded yet".
      set((state) =>
        state.hasLoadedArchivedConversations
          ? { archivedConversations: mergeArchivedConversation(state.archivedConversations, updated) }
          : {}
      );
    } catch (error) {
      set({ conversations: previousConversations, selectedConversationId: previousSelectedId });
      notifyError('Could not archive the chat', error);
      return;
    }

    const conversations = await window.atlasChat.conversations.list();

    // Archiving the last chat would leave the app with nothing open, same as
    // deleting it does.
    if (conversations.length === 0) {
      const created = await window.atlasChat.conversations.create();
      await get().refreshConversationList();
      await get().loadConversation(created.id);
    } else {
      set({ conversations });

      const selectedId = get().selectedConversationId;
      if (selectedId && !get().conversationDetails[selectedId]) {
        await get().loadConversation(selectedId);
      }
    }

    // An archive you cannot reverse is a delete with a softer name; the undo
    // has to be reachable from where the archive happened.
    notify({
      tone: 'info',
      title: title ? `Archived “${title}”` : 'Chat archived',
      actionLabel: 'Undo',
      onAction: () => {
        void get().setConversationArchived(conversationId, false);
      },
    });
  },

  setConversationSettled: async (conversationId, settled) => {
    // Renderer pre-guard mirrors the main-process check so the failure is
    // instant. The main-process guard inside `setSettled` is authoritative —
    // a turn that starts between this check and the IPC call still fails
    // there and rolls back below.
    const draft = get().draftsByConversation[conversationId];
    const conversation = get().conversations.find((entry) => entry.id === conversationId);
    const running = draft ? draft.status === 'streaming' : conversation?.status === 'running';
    if (settled && running) {
      notifyError('Cannot settle a chat while its turn is still running', null);
      return;
    }

    const previous = get().conversations;
    const now = new Date().toISOString();

    // Settling is high-frequency and stays silent — no toast. The Settled
    // shelf header shows the new count, and un-settling is one hover away.
    set((state) => ({
      conversations: state.conversations.map((entry) =>
        entry.id === conversationId
          ? {
              ...entry,
              settledAt: settled ? (entry.settledAt ?? now) : null,
              unsettledAt: settled ? null : (entry.settledAt ? now : entry.unsettledAt),
            }
          : entry
      ),
    }));

    try {
      const updated = await window.atlasChat.conversations.setSettled({ conversationId, settled });
      set((state) => ({
        conversations: state.conversations.map((entry) =>
          entry.id === conversationId ? updated : entry
        ),
      }));
    } catch (error) {
      set({ conversations: previous });
      notifyError(settled ? 'Could not settle the chat' : 'Could not un-settle the chat', error);
    }
  },

  setConversationSnoozed: async (conversationId, snoozedUntil) => {
    // Client-side twin of the main-process invariants so the UI rejects
    // before a round trip: parseable future wake, and no blocked-on-you work
    // hidden away. Snooze stays allowed while a turn runs — it only affects
    // visibility, never the agent.
    if (snoozedUntil !== null) {
      const wakeMs = Date.parse(snoozedUntil);
      if (Number.isNaN(wakeMs) || wakeMs <= Date.now()) {
        notifyError('Snooze wake time must be in the future', null);
        return;
      }
      const details = get().conversationDetails[conversationId];
      const liveParts = get().draftsByConversation[conversationId]?.parts;
      const openParts = details?.messages.flatMap((message) => message.parts ?? []) ?? [];
      if (hasPendingApprovalInParts(liveParts ?? openParts)) {
        notifyError('Respond to the pending request before snoozing this chat', null);
        return;
      }
    }

    const previous = get().conversations;
    const now = new Date().toISOString();

    set((state) => ({
      conversations: state.conversations.map((entry) =>
        entry.id === conversationId
          ? {
              ...entry,
              snoozedUntil,
              snoozedAt: snoozedUntil === null ? null : (entry.snoozedUntil === snoozedUntil ? entry.snoozedAt : now),
            }
          : entry
      ),
    }));

    try {
      const updated = await window.atlasChat.conversations.setSnoozed({ conversationId, snoozedUntil });
      set((state) => ({
        conversations: state.conversations.map((entry) =>
          entry.id === conversationId ? updated : entry
        ),
      }));
      // The row vanishes into the (usually collapsed) Snoozed shelf, so the
      // outcome happens off-screen: confirm it with the wake time, plus Undo.
      if (snoozedUntil !== null) {
        const clock = formatSnoozeClockLabel(snoozedUntil);
        notify({
          tone: 'success',
          title: clock ? `Snoozed until ${clock}` : 'Chat snoozed',
          actionLabel: 'Undo',
          onAction: () => {
            void get().setConversationSnoozed(conversationId, null);
          },
        });
      }
    } catch (error) {
      set({ conversations: previous });
      notifyError(snoozedUntil === null ? 'Could not wake the chat' : 'Could not snooze the chat', error);
    }
  },

  detachProject: async (projectId) => {
    await window.atlasChat.projects.delete(projectId);
    set((state) => ({
      settings: state.settings?.chat.lastProjectId === projectId
        ? { ...state.settings, chat: { ...state.settings.chat, lastProjectId: null } }
        : state.settings
    }));
    await Promise.all([get().refreshProjects(), get().refreshConversationList()]);
  },

  setConversationWorkspace: async (conversationId, patch) => {
    const prevSnapshot = get().conversations.find((c) => c.id === conversationId) ?? null;

    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              workspaceMode: patch.mode ?? conversation.workspaceMode,
              executionTarget: patch.executionTarget ?? conversation.executionTarget,
              projectId: patch.projectId === undefined ? conversation.projectId : patch.projectId
            }
          : conversation
      )
    }));

    try {
      const workspace = await window.atlasChat.conversations.setWorkspace({ conversationId, ...patch });

      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                workspaceMode: workspace.mode,
                executionTarget: workspace.executionTarget,
                worktreeRoot: workspace.worktreeRoot,
                projectId: workspace.projectId
              }
            : conversation
        ),
        settings: state.settings
          ? {
              ...state.settings,
              chat: {
                ...state.settings.chat,
                workspaceMode: workspace.mode,
                executionTarget: workspace.executionTarget,
                lastProjectId: workspace.projectId
              }
            }
          : state.settings
      }));

      if (patch.projectId) {
        await get().refreshProjects();
      }
    } catch (error) {
      // Functional revert for the single row, then refresh for truth.
      if (prevSnapshot) {
        set((state) => ({
          conversations: state.conversations.map((c) => (c.id === conversationId ? prevSnapshot : c))
        }));
      }
      void get().refreshConversationList();
      notifyError('Could not update the workspace', error);
    }
  },

  removeConversationWorktree: async (conversationId: string) => {
    const previous = get().conversations;

    // Optimistic: deleting the chip's worktree row should not wait a round trip
    // to stop showing the worktree target, or the menu reads as laggy at the
    // exact moment the folder it pointed at is disappearing.
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, executionTarget: 'local', worktreeRoot: null }
          : conversation
      ),
    }));

    try {
      const workspace = await window.atlasChat.conversations.removeWorktree(conversationId);

      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                executionTarget: workspace.executionTarget,
                worktreeRoot: workspace.worktreeRoot,
                workspaceMode: workspace.mode,
                projectId: workspace.projectId,
              }
            : conversation
        ),
      }));
    } catch (error) {
      set({ conversations: previous });
      notifyError('Could not remove worktree', error);
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
    set({ activeView: 'settings', settingsSection: section, commandPaletteOpen: false, commandPaletteInitialQuery: null, modelPickerOpen: false }),
  closeSettings: () => set({ activeView: 'chat', modelPickerOpen: false }),
  openLanding: () => set({ activeView: 'landing' }),
  closeLanding: () => set({ activeView: 'chat' }),
  openSites: () => set({ activeView: 'sites', commandPaletteOpen: false, commandPaletteInitialQuery: null, modelPickerOpen: false }),
  openPlugins: () =>
    set({ activeView: 'plugins', commandPaletteOpen: false, commandPaletteInitialQuery: null, modelPickerOpen: false }),
  closePlugins: () => set({ activeView: 'chat' }),
  closeSites: () => set({ activeView: 'chat' }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setCommandPaletteOpen: (open) =>
    set(open ? { commandPaletteOpen: open } : { commandPaletteOpen: open, commandPaletteInitialQuery: null }),
  setCommandPaletteInitialQuery: (query) => set({ commandPaletteInitialQuery: query }),
  setModelPickerOpen: (open) => set({ modelPickerOpen: open }),
  setComposerFocused: (focused) => set({ composerFocused: focused }),
  requestComposerFocus: () =>
    set((state) => ({
      activeView: 'chat',
      commandPaletteOpen: false,
      commandPaletteInitialQuery: null,
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
    const seq = ++updatePreferencesSeq;
    const settings = await window.atlasChat.settings.updatePreferences(patch);
    if (seq !== updatePreferencesSeq) {
      return;
    }
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

  setSelectedModel: (conversationId, modelId, providerId) => {
    // Provider-qualified selection: (modelId, providerId) is the real key.
    // The caller ideally supplies both; fallback resolves the pair via the
    // catalog so a bare id still lands on a deterministic provider.
    const state = get();
    const model = providerId
      ? getModelById(state.models, modelId, providerId)
      : getModelById(state.models, modelId);
    const resolvedProviderId = model?.providerId ?? providerId ?? null;

    set((current) => ({
      selectedModelIdByConversation: { ...current.selectedModelIdByConversation, [conversationId]: modelId },
      selectedProviderIdByConversation: resolvedProviderId
        ? { ...current.selectedProviderIdByConversation, [conversationId]: resolvedProviderId }
        : current.selectedProviderIdByConversation,
      settings: current.settings
        ? { ...current.settings, chat: { ...current.settings.chat, lastModelId: modelId } }
        : current.settings
    }));

    // No toast: the per-conversation pin below is the one the user is actually
    // choosing, and it reports for itself. This write is the global fallback
    // default, so a failure costs the next cold start its remembered model —
    // worth a log line, not an interruption on every model switch.
    void window.atlasChat.settings
      .updatePreferences({ chat: { lastModelId: modelId } })
      .catch((error) => console.warn('[settings] could not persist last model', error));

    if (!model || !resolvedProviderId) {
      // No paired catalog row: still remember the bare id globally, but the
      // per-conversation pair has no provider to persist.
      if (resolvedProviderId) {
        void window.atlasChat.conversations
          .setDefaultModel({ conversationId, providerId: resolvedProviderId, modelId })
          .catch((error) => notifyError('Could not remember that model for this chat', error));
      }
      return;
    }

    void window.atlasChat.conversations
      .setDefaultModel({ conversationId, providerId: resolvedProviderId, modelId: model.id })
      .catch((error) => notifyError('Could not remember that model for this chat', error));
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

  addComposerCitation: (conversationId, citation) => {
    const key = crypto.randomUUID();
    set((state) => ({
      composerCitationsByConversation: {
        ...state.composerCitationsByConversation,
        [conversationId]: [
          ...(state.composerCitationsByConversation[conversationId] ?? EMPTY_COMPOSER_CITATIONS),
          { key, citation },
        ],
      },
    }));
    return key;
  },

  updateComposerCitation: (conversationId, key, citation) => {
    set((state) => {
      const previous = state.composerCitationsByConversation[conversationId] ?? EMPTY_COMPOSER_CITATIONS;
      if (!previous.some((entry) => entry.key === key)) {
        return {};
      }

      return {
        composerCitationsByConversation: {
          ...state.composerCitationsByConversation,
          [conversationId]: previous.map((entry) => (entry.key === key ? { key, citation } : entry)),
        },
      };
    });
  },

  removeComposerCitation: (conversationId, key) => {
    set((state) => {
      const previous = state.composerCitationsByConversation[conversationId] ?? EMPTY_COMPOSER_CITATIONS;
      const next = previous.filter((entry) => entry.key !== key);
      if (next.length === previous.length) {
        return {};
      }

      const { [conversationId]: _removed, ...rest } = state.composerCitationsByConversation;
      return {
        composerCitationsByConversation: next.length ? { ...rest, [conversationId]: next } : rest,
      };
    });
  },

  setComposerCitations: (conversationId, updater) => {
    set((state) => {
      const previous = state.composerCitationsByConversation[conversationId] ?? EMPTY_COMPOSER_CITATIONS;
      const next = updater(previous);
      if (next === previous) {
        return {};
      }

      const { [conversationId]: _removed, ...rest } = state.composerCitationsByConversation;
      return {
        composerCitationsByConversation: next.length ? { ...rest, [conversationId]: next } : rest,
      };
    });
  },

  clearComposerDraft: (conversationId, sentAttachmentIds, sentCitationKeys) => {
    set((state) => {
      const { [conversationId]: _text, ...restText } = state.composerDraftsByConversation;
      const { [conversationId]: staged, ...restFiles } = state.composerAttachmentsByConversation;
      const { [conversationId]: stagedCitations, ...restCitations } = state.composerCitationsByConversation;
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

      // Same snapshot rule as files: only the citations that went out retire.
      // A quote cited while the send was in flight stays staged.
      const sentKeys = sentCitationKeys ? new Set(sentCitationKeys) : null;
      const remainingCitations = (stagedCitations ?? []).filter(
        (entry) => !(sentKeys ? sentKeys.has(entry.key) : true)
      );

      return {
        composerAttachmentsByConversation: remaining.length
          ? { ...restFiles, [conversationId]: remaining }
          : restFiles,
        composerCitationsByConversation: remainingCitations.length
          ? { ...restCitations, [conversationId]: remainingCitations }
          : restCitations,
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
    set({ activeView: 'chat', commandPaletteOpen: false, commandPaletteInitialQuery: null, modelPickerOpen: false });
    await get().loadConversation(nextConversation.id);
  },

  selectConversationByIndex: async (index) => {
    const conversation = get().conversations[index];
    if (!conversation) {
      return;
    }
    set({ activeView: 'chat', commandPaletteOpen: false, commandPaletteInitialQuery: null, modelPickerOpen: false });
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

    const pinnedProviderId =
      state.selectedProviderIdByConversation[conversationId] ?? detail.conversation.defaultProviderId ?? state.settings?.defaultProviderId ?? null;
    let selectedModel = getModelById(state.models, modelId, pinnedProviderId);
    const providerId = selectedModel?.providerId ?? pinnedProviderId;
    if (!selectedModel && providerId === 'antigravity' && modelId) {
      selectedModel = {
        id: modelId,
        providerId: 'antigravity',
        label: antigravityModelLabel(modelId),
        contextWindow: 1_000_000,
        isFree: false,
        supportsVision: true,
        supportsDocumentInput: true,
        supportsTools: true,
        archived: false,
        lastSyncedAt: new Date().toISOString(),
        lastSeenFreeAt: null,
        reasoningEfforts: null,
        supportsTemperature: false
      };
    }
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

    // One rule for "can this model be sent to", shared with the picker's own
    // marker: a provider that signs itself in (OpenCode) has no Atlas key to
    // find, and demanding one refused its every turn before it left the
    // renderer.
    if (modelNeedsApiKey(selectedModel, state.settings?.providers)) {
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
        // Mentions resolve against citation-free text: a literal `@Sites`
        // inside a quoted citation is assistant speech, not a user opt-in.
        mentions: parseMentions(stripAssistantCitations(trimmed)),
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
      // Ring identity, not a fresh toast per attempt: hammering send while a
      // provider is down used to stack unbounded toast state (t3code #9592).
      notifyError('Could not send the message', error, { id: repeatingToastId('send-message') });
      throw error;
    }

    // The main process queues a message sent while the conversation's turn is
    // still running; it starts automatically when that turn closes. The draft
    // below flips to streaming either way — from the user's side "waiting for
    // its turn" and "streaming" are the same waiting state until tokens land.
    if (request.queued) {
      notify({
        tone: 'info',
        title: 'Message queued',
        description: 'It will be sent when the current reply finishes.',
      });
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
          // A queued follow-up is not streaming yet — no tokens exist and the
          // stop button must not offer to abort a turn that has not started.
          // The first event for this requestId promotes it (see the reducer).
          status: request.queued ? 'queued' : 'streaming',
          startedAt: now
        }
      },
      queuedByConversation:
        request.queued
          ? {
              ...current.queuedByConversation,
              [conversationId]: [
                ...(current.queuedByConversation[conversationId] ?? []),
                { requestId: request.requestId, preview: previewContent }
              ]
            }
          : current.queuedByConversation,
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

  /**
   * Cancels one queued follow-up before its turn ever starts. The main
   * process answers with the same `error` event an aborted live stream uses,
   * so the dock entry prunes itself through the central event path.
   */
  cancelQueuedFollowup: async (requestId) => {
    const state = get();
    const conversationId = resolveConversationIdForRequest(requestId, state);
    if (conversationId) {
      // Optimistic removal — waiting for the IPC round trip would leave a
      // dead row in the dock for the length of a round trip.
      set((current) => ({
        queuedByConversation: {
          ...current.queuedByConversation,
          [conversationId]: (current.queuedByConversation[conversationId] ?? []).filter(
            (entry) => entry.requestId !== requestId
          )
        }
      }));
    }
    await window.atlasChat.chat.abort(requestId);
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
    const previousSelectedProvider = state.selectedProviderIdByConversation[conversationId];
    const previousSequence = state.runtimeSequenceByConversation[conversationId];
    const previousLoadingOlder = state.isLoadingOlderByConversation[conversationId];
    const previousConversations = state.conversations;
    const previousArchivedConversations = state.archivedConversations;
    const previousSelectedId = state.selectedConversationId;
    const previousRequestMap = state.requestToConversation;

    set((current) => {
      const { [conversationId]: _deletedDetail, ...restDetails } = current.conversationDetails;
      const { [conversationId]: _deletedDraft, ...restDrafts } = current.draftsByConversation;
      const { [conversationId]: _deletedModel, ...restSelectedModels } = current.selectedModelIdByConversation;
      const { [conversationId]: _deletedProvider, ...restSelectedProviders } = current.selectedProviderIdByConversation;
      const { [conversationId]: _deletedComposerText, ...restComposerText } = current.composerDraftsByConversation;
      const { [conversationId]: deletedComposerFiles, ...restComposerFiles } = current.composerAttachmentsByConversation;
      const { [conversationId]: _deletedComposerCitations, ...restComposerCitations } =
        current.composerCitationsByConversation;
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
        // Delete is now reachable from the Archived section, and that section
        // reads its own array — filtering only `conversations` left the deleted
        // row on screen until the next fetch.
        archivedConversations: current.archivedConversations.filter(
          (conversation) => conversation.id !== conversationId
        ),
        // The side pane hangs off its parent; CASCADE deletes the row, so the
        // pane must not outlive it either. A deleted *side* id closes it too.
        sideChat:
          current.sideChat?.parentId === conversationId || current.sideChat?.sideId === conversationId
            ? null
            : current.sideChat,
        conversationDetails: restDetails,
        draftsByConversation: restDrafts,
        selectedModelIdByConversation: restSelectedModels,
        selectedProviderIdByConversation: restSelectedProviders,
        composerDraftsByConversation: restComposerText,
        composerAttachmentsByConversation: restComposerFiles,
        composerCitationsByConversation: restComposerCitations,
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
        selectedProviderIdByConversation: previousSelectedProvider
          ? { ...current.selectedProviderIdByConversation, [conversationId]: previousSelectedProvider }
          : current.selectedProviderIdByConversation,
        runtimeSequenceByConversation: previousSequence
          ? { ...current.runtimeSequenceByConversation, [conversationId]: previousSequence }
          : current.runtimeSequenceByConversation,
        isLoadingOlderByConversation: previousLoadingOlder
          ? { ...current.isLoadingOlderByConversation, [conversationId]: previousLoadingOlder }
          : current.isLoadingOlderByConversation,
        conversations: previousConversations,
        archivedConversations: previousArchivedConversations,
        // Keep current requestToConversation to avoid clobbering concurrent sendMessage inserts.
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

    // Any main-side event naming a queued follow-up retires it from the dock:
    // a runtime-sync means the turn was dispatched, streaming events mean its
    // tokens are landing, and error/done mean it finished or died. One check
    // here covers every path instead of one per branch below.
    const queuedList = state.queuedByConversation[conversationId];
    if (queuedList?.some((entry) => entry.requestId === event.requestId)) {
      set((current) => ({
        queuedByConversation: {
          ...current.queuedByConversation,
          [conversationId]: (current.queuedByConversation[conversationId] ?? []).filter(
            (entry) => entry.requestId !== event.requestId
          )
        }
      }));
    }

    if (event.type === 'runtime-sync') {
      const currentSequence = get().runtimeSequenceByConversation[conversationId] ?? 0;
      if (event.sequence <= currentSequence) {
        return;
      }
      try {
        const recovery = await window.atlasChat.chat.recoverEvents({
          conversationId,
          afterSequence: currentSequence,
        });
        if (recovery.events.length === 0) {
          try {
            const snapshot = await window.atlasChat.chat.getRuntimeState({ conversationId });
            if (snapshot) {
              set((current) => ({
                ...applyRuntimeSnapshotToStore(current, conversationId, snapshot),
                requestToConversation: { ...current.requestToConversation, [event.requestId]: conversationId },
              }));
              return;
            }
          } catch {
            // getRuntimeState failed
          }
          set((current) => {
            const draft = current.draftsByConversation[conversationId];
            if (!draft) return {};
            return {
              draftsByConversation: {
                ...current.draftsByConversation,
                [conversationId]: {
                  ...draft,
                  notice: {
                    code: 'reconnecting',
                    message: 'Reconnecting to stream...',
                    level: 'warning',
                  },
                },
              },
            };
          });
          return;
        }
        set((current) => applyRecoveredRuntimeEventsToStore(current, conversationId, recovery.events));
        return;
      } catch {
        set((current) => {
          const draft = current.draftsByConversation[conversationId];
          if (!draft) return {};
          return {
            draftsByConversation: {
              ...current.draftsByConversation,
              [conversationId]: {
                ...draft,
                notice: {
                  code: 'reconnecting',
                  message: 'Reconnecting to stream...',
                  level: 'warning',
                },
              },
            },
          };
        });
        return;
      }
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
      // A cancelled follow-up never created rows — its draft is still marked
      // `queued`, which is what distinguishes it from an aborted live turn
      // (whose partial output must be refetched). Dropping the draft and
      // returning avoids four IPC roundtrips for a no-op.
      const cancelTarget = state.draftsByConversation[conversationId];
      if (
        event.code === 'aborted' &&
        cancelTarget &&
        cancelTarget.requestId === event.requestId &&
        cancelTarget.status === 'queued'
      ) {
        set((s) => {
          const { [conversationId]: _dropped, ...restDrafts } = s.draftsByConversation;
          return { draftsByConversation: restDrafts };
        });
        return;
      }

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

        // The error names one request. A draft carrying a different request's
        // id is a queued follow-up still waiting to run — failing turn A must
        // not mark it failed, let alone clear it.
        if (draft && draft.requestId === event.requestId) {
          nextDrafts[conversationId] = {
            ...draft,
            status: event.code === 'aborted' ? 'aborted' : 'error',
            errorMessage: event.message,
            error: {
              code: event.code,
              message: event.message,
              retryable: event.retryable,
            },
          };
        } else if (!draft) {
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
      const draft = s.draftsByConversation[conversationId];
      // Same request-scoping as the error branch: a terminal event for turn A
      // must not drop the queued follow-up's placeholder draft. The follow-up
      // keeps its own draft until its own terminal event arrives.
      const { [conversationId]: _droptDraft, ...restDrafts } = s.draftsByConversation;
      const nextDrafts = draft && draft.requestId === event.requestId ? restDrafts : s.draftsByConversation;
      const { [event.requestId]: _omitted, ...restRequests } = s.requestToConversation;

      // The turn finished somewhere the user is not looking: it is unread.
      const isBackgroundTurn =
        conversationId !== s.selectedConversationId &&
        (!draft || draft.requestId === event.requestId);
      const unreadByConversation = isBackgroundTurn
        ? {
            ...s.unreadByConversation,
            [conversationId]: (s.unreadByConversation[conversationId] ?? 0) + 1,
          }
        : s.unreadByConversation;

      return {
        requestToConversation: restRequests,
        draftsByConversation: nextDrafts,
        unreadByConversation,
        conversationDetails: {
          ...s.conversationDetails,
          [conversationId]: mergeConversationPage(s.conversationDetails[conversationId], page)
        },
        conversations,
        conversationStats,
        diagnostics
      };
    });

    // A turn the user walked away from finishes silently otherwise — the
    // sidebar's spinner just stops, in a row they are not looking at.
    if (conversationId !== get().selectedConversationId) {
      const title =
        conversations.find((conversation) => conversation.id === conversationId)?.title ?? 'A task';
      notify({
        tone: 'info',
        title: 'Finished in the background',
        description: title,
        actionLabel: 'Open',
        onAction: () => {
          void get().loadConversation(conversationId);
        },
      });
    }
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

/** The conversation's queued follow-ups, or a stable empty list. */
export function selectQueuedFollowups(state: AppState, conversationId: string | null): QueuedFollowupEntry[] {
  if (!conversationId) {
    return EMPTY_QUEUED_FOLLOWUPS;
  }
  return state.queuedByConversation[conversationId] ?? EMPTY_QUEUED_FOLLOWUPS;
}

// Re-export helper for tests that need to drive the pure reducers directly.
export const _internal = { applyRuntimeSnapshotToStore, applyRecoveredRuntimeEventsToStore, applyStreamingEvent, applyMetaEvent, applyNoticeEvent };
