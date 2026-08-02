import type { MentionId } from './mentions';
import type {
  CreateSiteRequest,
  DeleteSiteFileRequest,
  ExportSiteRequest,
  ExportSiteResult,
  OpenSitePreviewRequest,
  PublishSiteRequest,
  ReadSiteFileRequest,
  RollbackSiteRequest,
  SiteDetail,
  SitePreviewTarget,
  SiteReviewChecklist,
  SiteSummary,
  WriteSiteFileRequest,
} from './sites';

/**
 * Every provider is user-configured, so an id is just the `custom:<slug>` the
 * app minted when the endpoint was added. Historical ids (`openrouter`, `glm`)
 * can still appear in old rows until the startup migration rewrites them.
 */
export type ProviderId = string;

export type * from './sites';
export type * from './mentions';
export type * from './customProviders';
export type * from './chatParameters';
export type * from './workspaceModes';

import type { ReasoningEffort, ToolPermissionMode } from './chatParameters';
import type { WorkspaceMode } from './workspaceModes';

/**
 * A folder the user has attached to Atlas. `root` is the only capability that
 * matters: it is the writable boundary in `code` mode and the shell's working
 * directory in both modes.
 */
export type WorkspaceProject = {
  id: string;
  title: string;
  root: string;
  /** False once the folder has been moved or deleted since it was attached. */
  exists: boolean;
  /** True when `root` is inside a git working tree, so diff surfaces are real. */
  isGitRepository: boolean;
  /** Checked-out branch, or null when detached or not a repository. */
  branch: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type CreateWorkspaceProjectRequest = {
  /** Absolute path. Omit to open the native folder picker instead. */
  root?: string;
  title?: string;
};

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'unknown';

export type ProjectTypeInfo = {
  type: ProjectType;
  packageManager?: string;
  framework?: string;
  entryFile?: string;
};

export type ProjectContextInfo = {
  project: WorkspaceProject | null;
  projectType: ProjectTypeInfo;
  envKeys: string[];
  detectedEnvKeys: string[];
  mode: WorkspaceMode;
};

export type EnvVarItem = {
  key: string;
  maskedValue: string;
};

export type GitFileStatus = {
  path: string;
  indexStatus: string;
  workingTreeStatus: string;
};

export type GitLogEntry = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
};

export type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: boolean;
};

export type GitStateSummary = {
  isRepo: boolean;
  branch: string | null;
  files: GitFileStatus[];
};

export type FileChangeSummary = {
  fileCount: number;
  added: number;
  removed: number;
  files: Array<{
    id: string;
    filePath: string;
    diffText: string;
    status: 'pending' | 'accepted' | 'reverted';
  }>;
};

export type TerminalHistoryEntry = {
  id: string;
  conversationId: string;
  command: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

/** What the runtime resolved for a conversation: its mode and its folder. */
export type ConversationWorkspace = {
  conversationId: string;
  mode: WorkspaceMode;
  projectId: string | null;
  /** Resolved from `projectId`; null when unset or the folder is gone. */
  project: WorkspaceProject | null;
  /** False when the mode needs a project and none is attached. */
  ready: boolean;
};

export type SetConversationWorkspaceRequest = {
  conversationId: string;
  mode?: WorkspaceMode;
  /** `null` detaches the project; omit to leave it unchanged. */
  projectId?: string | null;
};
import type {
  CreateCustomProviderRequest,
  CustomProvider,
  DiscoverCustomProviderModelsRequest,
  DiscoveredModel,
  ProviderPreset,
  SetCustomProviderModelsRequest,
  UpdateCustomProviderRequest
} from './customProviders';

export type {
  KeybindingCommand,
  KeybindingContext,
  KeybindingRule,
  KeybindingShortcut,
  KeybindingWhenIdentifier,
  KeybindingWhenNode,
  ResolvedKeybindingRule,
} from './keybindings';

export type CredentialStatus = 'missing' | 'valid' | 'invalid' | 'unknown';

export type MessageRole = 'system' | 'user' | 'assistant';

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'aborted';

export type ChatPartState = 'streaming' | 'done';

export type ChatToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-partial'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

export type ToolExecutionState =
  | 'queued'
  | 'running'
  | 'approval_requested'
  | 'approved'
  | 'denied'
  | 'partial'
  | 'completed'
  | 'error';

export type ChatTextPart = {
  id: string;
  type: 'text';
  text: string;
  state?: ChatPartState;
};

export type ChatReasoningPart = {
  id: string;
  type: 'reasoning';
  text: string;
  state?: ChatPartState;
};

export type ChatFilePart = {
  id: string;
  type: 'file';
  mediaType: string;
  url: string;
  filename?: string;
  sizeBytes?: number | null;
  storageKey?: string | null;
  previewWidth?: number | null;
  previewHeight?: number | null;
};

export type ChatToolApproval = {
  id: string;
  approved?: boolean;
  reason?: string;
};

export type ChatToolPart = {
  id: string;
  type: 'tool';
  toolCallId: string;
  requestId?: string;
  toolName: string;
  state: ChatToolState;
  rawInput?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  dynamic?: boolean;
  providerExecuted?: boolean;
  title?: string;
  preliminary?: boolean;
  approval?: ChatToolApproval;
  /**
   * Canonical category of the call. The main process already derives this
   * (`inferCanonicalToolType`) but it used to be dropped when runtime
   * envelopes were downgraded to legacy `StreamEvent`s, so the renderer
   * could not tell a shell command from a file edit. The transcript needs
   * it to pick a verb, an accent, and a body renderer.
   */
  toolType?: CanonicalToolType | null;
  /** ISO timestamp of the first event for this call. */
  startedAt?: string;
  /** ISO timestamp of the terminal event, once the call is final. */
  completedAt?: string;
};

export type ChatVisualPart = {
  id: string;
  type: 'visual';
  content: string;
  state: ChatPartState;
  title?: string;
};

export type ChatMessagePart = ChatTextPart | ChatReasoningPart | ChatFilePart | ChatToolPart | ChatVisualPart;

export type ToolExecutionRecord = {
  id: string;
  conversationId: string;
  messageId: string;
  requestId: string;
  toolName: string;
  inputPreview: string | null;
  state: ToolExecutionState;
  startedAt: string | null;
  finishedAt: string | null;
  partialOutputPreview: string | null;
  finalOutputPreview: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requiresApproval: boolean;
  approvalId: string | null;
  approvedAt: string | null;
  deniedAt: string | null;
  approvalReason: string | null;
};

export type ModelSummary = {
  id: string;
  providerId: ProviderId;
  label: string;
  contextWindow: number | null;
  isFree: boolean;
  /**
   * Input modality support, three-valued: `true` known to work, `false` known
   * to be rejected, `null` nobody has said.
   *
   * An OpenAI-compatible `/models` list describes nothing, so most endpoints
   * genuinely leave this unknown. Encoding that as `false` blocked images on
   * models that can see them, with no way for the user to tell why; encoding it
   * as `true` promised support the provider then refused. Unknown is allowed to
   * be attempted, and a rejection is recorded as `false` (see
   * `ChatEngine.rememberModalityRejection`).
   */
  supportsVision: boolean | null;
  supportsDocumentInput: boolean | null;
  /**
   * Tool-calling support, three-valued like the modalities above. A model that
   * cannot take tools answers a request carrying them with a 400, and that
   * refusal is recorded here rather than repeated every turn.
   */
  supportsTools: boolean | null;
  archived: boolean;
  lastSyncedAt: string;
  lastSeenFreeAt: string | null;
  /**
   * Largest completion the upstream model accepts. `null` means the provider
   * did not advertise one, in which case the adapter falls back to its own
   * conservative default instead of guessing high and getting a 400.
   */
  maxOutputTokens?: number | null;
  /**
   * Some models (notably reasoning models) reject `temperature` outright, so
   * the catalog records whether it is safe to send.
   */
  supportsTemperature?: boolean;
  supportsReasoning?: boolean;
  /**
   * Effort levels the model actually accepts, from the catalog. `null` means
   * unknown, in which case the UI offers its default ladder.
   */
  reasoningEfforts?: ReasoningEffort[] | null;
};

/**
 * Per-model runtime facts a provider adapter needs to build an accurate
 * request. Sourced from the model catalog rather than hardcoded per provider.
 */
export type ModelRuntimeHints = {
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  supportsTemperature?: boolean;
  supportsReasoning?: boolean;
  reasoningEfforts?: ReasoningEffort[] | null;
  supportsTools?: boolean | null;
};

/**
 * What the *next* request's prompt will occupy, measured against the model's
 * window.
 *
 * This has to come from the main process: the renderer knows the transcript,
 * but the prompt is not the transcript. `ContextManager` compresses older turns
 * out of it, the system prompt and tool schemas add a fixed floor the
 * transcript never shows, and both are invisible from the renderer. Measuring
 * in the renderer produced a number that tracked conversation length rather
 * than context pressure — the two diverge sharply on any long thread.
 */
export type ContextUsageSnapshot = {
  /** Model context window; null when the catalog does not know it. */
  maxTokens: number | null;
  /** Total prompt size: system + tools + summary + raw history + pending input. */
  promptTokens: number;
  /**
   * What this conversation has put in the window: summary + raw history +
   * pending input, without the fixed system/tool floor.
   *
   * This is what the ring reports. The floor is real and is still charged on
   * every request, but a brand-new chat showing a third of the window consumed
   * before a word is typed reads as a bug rather than as the cost of the tool
   * schemas — so the floor is broken out in the hover card instead, and the
   * percentage tracks the thing the reader can actually influence.
   */
  conversationTokens: number;
  systemTokens: number;
  /** Tool names, descriptions and schema allowance. Zero when tools are off. */
  toolTokens: number;
  /** Raw turns that will be sent verbatim. */
  historyTokens: number;
  /** The compressed-older-turns block inside the system prompt. */
  summaryTokens: number;
  /** Composer text and attachments not yet sent. */
  pendingTokens: number;
  /** Held back for the completion; the usable prompt budget is the remainder. */
  reservedOutputTokens: number;
  /** Older turns compressed into the summary rather than sent raw. */
  droppedTurnCount: number;
  keptTurnCount: number;
  /** True when the prompt exceeds the usable budget and may be rejected. */
  overflow: boolean;
  /**
   * Provider accounting for the most recent completed turn, for cost display.
   *
   * Not comparable to `promptTokens`: for a turn that called tools, the SDK sums
   * `inputTokens` across every step, so it measures total billed input for the
   * turn rather than the size of any single prompt. Using it to calibrate the
   * figures above would scale tool-heavy conversations badly wrong.
   */
  lastTurn: {
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
  } | null;
};

export type GetContextUsageRequest = {
  conversationId: string;
  modelId: string;
  enableTools?: boolean;
  toolPermissionMode?: ToolPermissionMode;
  mentions?: MentionId[];
  /** Unsent composer text, so the ring responds as the user types. */
  pendingText?: string;
  /** Unsent attachments, measured by kind rather than by byte size. */
  pendingAttachments?: Array<{
    mediaType?: string | null;
    previewWidth?: number | null;
    previewHeight?: number | null;
  }>;
};

export type ListModelsOptions = {
  freeOnly?: boolean;
  includeArchived?: boolean;
  allowStale?: boolean;
  /**
   * Restrict to models whose provider is still configured and enabled. The
   * cache outlives providers — a removed or disabled endpoint leaves rows
   * behind that must not be offered as selectable models.
   */
  configuredOnly?: boolean;
};

export type ProviderCredentialSummary = {
  providerId: ProviderId;
  hasSecret: boolean;
  status: CredentialStatus;
  validatedAt: string | null;
};

export type ThemeMode = 'light' | 'dark' | 'system';
export type DesignTheme = 'codex' | 'default' | 'xai' | 'cursor';

export const DESIGN_THEMES: readonly DesignTheme[] = ['codex', 'default', 'xai', 'cursor'];

export function isDesignTheme(value: unknown): value is DesignTheme {
  return typeof value === 'string' && (DESIGN_THEMES as readonly string[]).includes(value);
}
export type FontFamilyOverride = string | null;
export type BorderRadiusMode = 'theme-default' | 'none';

/** Hex color override; null falls back to the design theme's own value. */
export type ThemeColorOverride = string | null;

export type ReduceMotionMode = 'system' | 'on' | 'off';

export const REDUCE_MOTION_MODES: readonly ReduceMotionMode[] = ['system', 'on', 'off'];

export function isReduceMotionMode(value: unknown): value is ReduceMotionMode {
  return typeof value === 'string' && (REDUCE_MOTION_MODES as readonly string[]).includes(value);
}

export const CONTRAST_MIN = 0;
export const CONTRAST_MAX = 100;
/** Neutral midpoint: derived tokens render exactly as the theme authored them. */
export const CONTRAST_DEFAULT = 50;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

export function normalizeThemeColor(value: unknown): ThemeColorOverride {
  if (!isHexColor(value)) {
    return null;
  }

  const trimmed = (value as string).trim().toLowerCase();
  if (trimmed.length === 4) {
    // Expand #abc to #aabbcc so downstream color math has one shape to handle.
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }

  return trimmed;
}

export const UI_FONT_SIZE_MIN = 13;
export const UI_FONT_SIZE_MAX = 18;
export const UI_FONT_SIZE_DEFAULT = 15;

export const CODE_FONT_SIZE_MIN = 11;
export const CODE_FONT_SIZE_MAX = 16;
export const CODE_FONT_SIZE_DEFAULT = 13;

export const DEFAULT_BORDER_RADIUS: BorderRadiusMode = 'theme-default';

export type SettingsSection = 'general' | 'providers' | 'appearance' | 'keyboard' | 'usage' | 'privacy';

export type SettingsAppearanceSummary = {
  themeMode: ThemeMode;
  designTheme: DesignTheme;
  uiFontSize: number;
  codeFontSize: number;
  uiFontFamily: FontFamilyOverride;
  codeFontFamily: FontFamilyOverride;
  borderRadius: BorderRadiusMode;
  accentColor: ThemeColorOverride;
  backgroundColor: ThemeColorOverride;
  foregroundColor: ThemeColorOverride;
  /** 0–100; 50 renders the theme exactly as authored. */
  contrast: number;
  translucentSidebar: boolean;
  reduceMotion: ReduceMotionMode;
  pointerCursors: boolean;
};

export const DEFAULT_SETTINGS_APPEARANCE: SettingsAppearanceSummary = {
  themeMode: 'dark',
  designTheme: 'codex',
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  uiFontFamily: null,
  codeFontFamily: null,
  borderRadius: DEFAULT_BORDER_RADIUS,
  accentColor: null,
  backgroundColor: null,
  foregroundColor: null,
  contrast: CONTRAST_DEFAULT,
  translucentSidebar: false,
  reduceMotion: 'system',
  pointerCursors: false,
};

export type SettingsKeyboardSummary = {
  keybindings: import('./keybindings').KeybindingRule[];
};

/** Per-turn chat parameters the composer exposes, persisted across launches. */
export type SettingsChatSummary = {
  reasoningEffort: ReasoningEffort;
  toolPermissionMode: ToolPermissionMode;
  /** Mode new conversations start in. Per-conversation mode overrides it. */
  workspaceMode: WorkspaceMode;
  /** Project new conversations attach to, so a coding session survives restart. */
  lastProjectId: string | null;
  /** Last model the user selected; null when it is no longer in the catalog. */
  lastModelId: string | null;
};

export type SettingsSummary = {
  providers: ProviderCredentialSummary[];
  /** User-configured endpoints, so the UI can label and group them. */
  customProviders: CustomProvider[];
  defaultProviderId: ProviderId | null;
  appearance: SettingsAppearanceSummary;
  keyboard: SettingsKeyboardSummary;
  chat: SettingsChatSummary;
  showFreeOnlyByDefault: boolean;
  modelCatalogLastSyncedAt: string | null;
  modelCatalogStale: boolean;
  modelCatalogCount: number;
};

export type ConversationStatus = 'idle' | 'running' | 'completed' | 'failed' | 'queued';

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string | null;
  lastUserMessagePreview: string | null;
  lastAssistantMessagePreview: string | null;
  lastMessageAt: string | null;
  defaultProviderId: ProviderId | null;
  defaultModelId: string | null;
  workspaceMode: WorkspaceMode;
  projectId: string | null;
  status?: ConversationStatus;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  reasoning: string | null;
  parts: ChatMessagePart[];
  status: MessageStatus;
  providerId: ProviderId | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: string;
};

export type ConversationDetail = {
  conversation: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    defaultProviderId: ProviderId | null;
    defaultModelId: string | null;
    workspaceMode: WorkspaceMode;
    projectId: string | null;
  };
  messages: ChatMessage[];
};

export type CreateConversationRequest = {
  /**
   * Which project the new chat belongs to.
   *
   * Present — including an explicit `null` — the caller is stating where the
   * user is right now, and it wins. Absent, the last project the user worked
   * in is inherited. The renderer always states it, because "the project I am
   * looking at" and "the last project I explicitly picked" drift apart the
   * moment you open a chat from a different folder.
   */
  projectId?: string | null;
};

export type ConversationPageRequest = {
  cursor?: string | null;
  limit?: number;
};

export type ConversationPage = ConversationDetail & {
  hasOlder: boolean;
  nextCursor: string | null;
  limit: number;
};

export type ConversationStats = {
  storedConversationCount: number;
  storedMessageCount: number;
  databaseSizeBytes: number;
};

export type ChatInputTextPart = {
  type: 'text';
  text: string;
};

export type ChatInputFilePart = {
  type: 'file';
  mediaType: string;
  url: string;
  filename?: string;
  sizeBytes?: number | null;
};

export type ChatInputPart = ChatInputTextPart | ChatInputFilePart;

export type ChatInputMessage = {
  role: MessageRole;
  content: string;
  parts?: ChatInputPart[];
};

export type ChatStartRequest = {
  conversationId: string;
  providerId: ProviderId;
  modelId: string;
  messages: ChatInputMessage[];
  enableTools?: boolean;
  /** Capabilities the user explicitly opted into via composer mentions (`@Sites`). */
  mentions?: MentionId[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Thinking budget for this turn. Ignored by models without a thinking mode. */
  reasoningEffort?: ReasoningEffort;
  /** What the assistant may do with tools in this turn. */
  toolPermissionMode?: ToolPermissionMode;
};

export type ChatStartResponse = {
  requestId: string;
};

export type VisualThemeTokens = {
  colorScheme: 'light' | 'dark';
  background: string;
  panel: string;
  text: string;
  mutedText: string;
  border: string;
  accent: string;
  errorBackground: string;
  errorBorder: string;
  errorText: string;
};

export type OpenVisualWindowRequest = {
  visualId: string;
  content: string;
  title?: string;
  theme: VisualThemeTokens;
};

export type SavedVisual = {
  id: string;
  title: string;
  content: string;
  visualType: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveVisualRequest = {
  title: string;
  content: string;
  visualType: string;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
};

export type StreamChunkEvent = {
  type: 'chunk';
  requestId: string;
  id: string;
  delta: string;
};

export type StreamReasoningEvent = {
  type: 'reasoning';
  requestId: string;
  id: string;
  delta: string;
};

/**
 * Fields every tool-related stream event may carry.
 *
 * These originate on `RuntimeEventEnvelope` and used to be dropped when
 * envelopes were downgraded to legacy stream events. Both are optional so
 * older persisted events and provider-native streams stay valid.
 */
export type StreamToolMetadata = {
  toolType?: CanonicalToolType | null;
  /** ISO timestamp of the originating runtime event. */
  occurredAt?: string;
};

export type StreamToolInputStartEvent = StreamToolMetadata & {
  type: 'tool-input-start';
  requestId: string;
  toolCallId: string;
  toolName: string;
  dynamic?: boolean;
  providerExecuted?: boolean;
  title?: string;
};

export type StreamToolInputDeltaEvent = StreamToolMetadata & {
  type: 'tool-input-delta';
  requestId: string;
  toolCallId: string;
  delta: string;
};

export type StreamToolInputAvailableEvent = StreamToolMetadata & {
  type: 'tool-input-available';
  requestId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  dynamic?: boolean;
  providerExecuted?: boolean;
  title?: string;
};

export type StreamToolOutputAvailableEvent = StreamToolMetadata & {
  type: 'tool-output-available';
  requestId: string;
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output: unknown;
  dynamic?: boolean;
  providerExecuted?: boolean;
  preliminary?: boolean;
  title?: string;
};

export type StreamToolOutputErrorEvent = StreamToolMetadata & {
  type: 'tool-output-error';
  requestId: string;
  toolCallId: string;
  toolName: string;
  input?: unknown;
  errorText: string;
  dynamic?: boolean;
  providerExecuted?: boolean;
  title?: string;
};

export type StreamToolOutputDeniedEvent = StreamToolMetadata & {
  type: 'tool-output-denied';
  requestId: string;
  toolCallId: string;
  toolName?: string;
  reason?: string;
};

export type StreamToolApprovalRequestedEvent = StreamToolMetadata & {
  type: 'tool-approval-requested';
  requestId: string;
  approvalId: string;
  toolCallId: string;
  toolName?: string;
  reason?: string;
};

export type StreamToolApprovalRespondedEvent = StreamToolMetadata & {
  type: 'tool-approval-responded';
  requestId: string;
  approvalId: string;
  toolCallId: string;
  approved: boolean;
  reason?: string;
};

export type StreamMetaEvent = {
  type: 'meta';
  requestId: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
};

export type StreamErrorEvent = {
  type: 'error';
  requestId: string;
  code: string;
  message: string;
  retryable: boolean;
};

/**
 * The turn is still alive but something happened worth saying out loud.
 *
 * There was no such event, and its absence was a real bug: a turn that timed
 * out and retried three times emitted nothing at all between `turn.started` and
 * the eventual failure, so seven minutes of retrying looked exactly like seven
 * minutes of thinking. Notices are transient status, not transcript content —
 * they are not persisted as runtime activity and the next chunk clears them.
 */
export type StreamNoticeEvent = {
  type: 'notice';
  requestId: string;
  /** Machine-readable reason, e.g. `retrying`, `compacting`. */
  code: string;
  /** One sentence, already written for a reader. */
  message: string;
  level: 'info' | 'warning';
};

export type StreamVisualStartEvent = {
  type: 'visual-start';
  requestId: string;
  visualId: string;
  title?: string;
};

export type StreamVisualCompleteEvent = {
  type: 'visual-complete';
  requestId: string;
  visualId: string;
  content: string;
  title?: string;
};

export type StreamDoneEvent = {
  type: 'done';
  requestId: string;
  messageId: string;
};

export type RuntimeSyncEvent = {
  type: 'runtime-sync';
  conversationId: string;
  requestId: string;
  eventId: string;
  sequence: number;
};

/**
 * The main process finished naming a session (an async LLM call that lands
 * after the turn's `done` event), so the sidebar can update in place.
 */
export type StreamConversationTitleEvent = {
  type: 'conversation-title';
  conversationId: string;
  title: string;
};

export type StreamEvent =
  | StreamChunkEvent
  | StreamReasoningEvent
  | StreamToolInputStartEvent
  | StreamToolInputDeltaEvent
  | StreamToolInputAvailableEvent
  | StreamToolOutputAvailableEvent
  | StreamToolOutputErrorEvent
  | StreamToolOutputDeniedEvent
  | StreamToolApprovalRequestedEvent
  | StreamToolApprovalRespondedEvent
  | StreamVisualStartEvent
  | StreamVisualCompleteEvent
  | StreamMetaEvent
  | StreamErrorEvent
  | StreamNoticeEvent
  | StreamDoneEvent
  | RuntimeSyncEvent
  | StreamConversationTitleEvent;

export type ActivityType =
  | 'message.delta'
  | 'message.completed'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'runtime.warning'
  | 'runtime.error'
  | 'turn.started'
  | 'turn.completed';

export type ActivityTone = 'tool' | 'approval' | 'info' | 'error';

export type CanonicalToolType =
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'dynamic_tool_call'
  | 'web_search'
  | 'image_view';

export type ApprovalDecision = 'accept' | 'accept_for_session' | 'decline' | 'cancel';

export type RuntimeEventEnvelope = {
  eventId: string;
  conversationId: string;
  turnId: string;
  requestId: string;
  sequence: number;
  occurredAt: string;
  activityType: ActivityType;
  tone: ActivityTone;
  toolType?: CanonicalToolType | null;
  messageId?: string | null;
  toolCallId?: string | null;
  approvalId?: string | null;
  provider: ProviderId | 'system';
  providerEventType?: string | null;
  payload: Record<string, unknown>;
};

export type WorkLogEntryStatus =
  | 'running'
  | 'pending_approval'
  | 'completed'
  | 'error'
  | 'denied'
  | 'stale'
  | 'resolved';

export type WorkLogEntry = {
  id: string;
  conversationId: string;
  turnId: string;
  requestId: string;
  messageId: string | null;
  activityType: ActivityType;
  tone: ActivityTone;
  toolType: CanonicalToolType | null;
  toolCallId: string | null;
  approvalId: string | null;
  title: string;
  summary: string | null;
  status: WorkLogEntryStatus;
  sequence: number;
  isFinal: boolean;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRequestStatus = 'pending' | 'resolved' | 'stale';

export type ApprovalRequestRecord = {
  id: string;
  conversationId: string;
  turnId: string;
  requestId: string;
  messageId: string | null;
  toolCallId: string;
  toolName: string | null;
  toolType: CanonicalToolType | null;
  reason: string | null;
  status: ApprovalRequestStatus;
  decision: ApprovalDecision | null;
  sessionScopeKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeCheckpointSummary = {
  id: string;
  conversationId: string;
  turnId: string;
  sequence: number;
  pendingApprovalCount: number;
  fileChangeSummary: string | null;
  createdAt: string;
};

export type RuntimeProviderSession = {
  id: string;
  conversationId: string;
  turnId: string;
  requestId: string;
  providerId: ProviderId;
  modelId: string;
  status: 'active' | 'completed' | 'aborted' | 'interrupted';
  lastSequence: number;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeStateSnapshot = {
  conversationId: string;
  conversation: ConversationDetail['conversation'] | null;
  lastSequence: number;
  checkpointSequence: number;
  messages: ChatMessage[];
  activities: WorkLogEntry[];
  pendingApprovals: ApprovalRequestRecord[];
  providerSession: RuntimeProviderSession | null;
  latestCheckpoint: RuntimeCheckpointSummary | null;
};

export type RuntimeStateRequest = {
  conversationId: string;
};

export type RecoverEventsRequest = {
  conversationId: string;
  afterSequence: number;
};

export type RecoverEventsResponse = {
  conversationId: string;
  events: RuntimeEventEnvelope[];
  lastSequence: number;
};

export type ToolApprovalResponseRequest = {
  requestId: string;
  approvalId: string;
  decision: ApprovalDecision;
  reason?: string;
};

export type UsageMetricState = 'available' | 'loading' | 'unavailable' | 'not_connected';

export type UsageProviderSummary = {
  providerId: ProviderId;
  label: string;
  state: UsageMetricState;
  primary: string;
  secondary: string;
  meterLabel?: string;
  meterValue?: number | null;
};

export type UsageSummary = {
  local: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    estimatedCostUsd: number | null;
    storedConversationCount: number;
    storedMessageCount: number;
    databaseSizeBytes: number;
    loadedConversationCount: number;
    loadedMessageCount: number;
    rendererHeapBytes: number | null;
    mainProcessRssBytes: number | null;
  };
  providers: UsageProviderSummary[];
};

export type DiagnosticsSnapshot = {
  collectedAt: string;
  build: {
    appVersion: string;
    electronVersion: string | null;
    chromeVersion: string | null;
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  mainProcess: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  databaseSizeBytes: number;
  /**
   * Where the main-process log is being written, so a bug report can include
   * it. Null when the log could not be opened at all.
   */
  logFilePath: string | null;
};

export type SettingsUpdateRequest = {
  showFreeOnlyByDefault?: boolean;
  appearance?: {
    themeMode?: ThemeMode;
    designTheme?: DesignTheme;
    uiFontSize?: number;
    codeFontSize?: number;
    uiFontFamily?: FontFamilyOverride;
    codeFontFamily?: FontFamilyOverride;
    borderRadius?: BorderRadiusMode;
    accentColor?: ThemeColorOverride;
    backgroundColor?: ThemeColorOverride;
    foregroundColor?: ThemeColorOverride;
    contrast?: number;
    translucentSidebar?: boolean;
    reduceMotion?: ReduceMotionMode;
    pointerCursors?: boolean;
  };
  keyboard?: {
    keybindings?: import('./keybindings').KeybindingRule[];
  };
  chat?: {
    reasoningEffort?: ReasoningEffort;
    toolPermissionMode?: ToolPermissionMode;
    /** Mode new conversations start in. */
    workspaceMode?: WorkspaceMode;
    /** Project new conversations attach to; `null` clears it. */
    lastProjectId?: string | null;
    lastModelId?: string;
  };
};

export type AppUpdateProgress = {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
};

export type AppUpdateSnapshot =
  | {
      status: 'idle';
    }
  | {
      status: 'checking';
    }
  | {
      status: 'available';
      currentVersion: string;
      latestVersion: string;
      releaseUrl: string;
      releaseNotes: string | null;
      checkedAt: string;
    }
  | {
      status: 'not-available';
      currentVersion: string;
      checkedAt: string;
    }
  | {
      status: 'error';
      message: string;
      checkedAt: string;
    }
  | {
      status: 'downloading';
      currentVersion: string;
      latestVersion: string;
      releaseNotes: string | null;
      checkedAt: string;
      progress: AppUpdateProgress | null;
    }
  | {
      status: 'downloaded';
      currentVersion: string;
      latestVersion: string;
      releaseNotes: string | null;
      checkedAt: string;
    };

export type RendererApi = {
  settings: {
    getSummary: () => Promise<SettingsSummary>;
    saveProviderKey: (providerId: ProviderId, secret: string) => Promise<SettingsSummary>;
    validateProviderKey: (providerId: ProviderId, secret?: string) => Promise<SettingsSummary>;
    updatePreferences: (patch: SettingsUpdateRequest) => Promise<SettingsSummary>;
  };
  models: {
    list: (options?: ListModelsOptions) => Promise<ModelSummary[]>;
    refresh: () => Promise<ModelSummary[]>;
    /**
     * Fires when the main process changes the model catalog on its own (e.g.
     * the startup backfill of reasoning levels), so an already-loaded renderer
     * can re-fetch instead of showing the pre-change snapshot.
     */
    subscribe: (listener: () => void) => () => void;
  };
  providers: {
    list: () => Promise<CustomProvider[]>;
    create: (request: CreateCustomProviderRequest) => Promise<CustomProvider>;
    update: (request: UpdateCustomProviderRequest) => Promise<CustomProvider>;
    delete: (providerId: ProviderId) => Promise<void>;
    setModels: (request: SetCustomProviderModelsRequest) => Promise<CustomProvider>;
    discoverModels: (request: DiscoverCustomProviderModelsRequest) => Promise<DiscoveredModel[]>;
    testConnection: (request: DiscoverCustomProviderModelsRequest) => Promise<void>;
    listPresets: () => Promise<ProviderPreset[]>;
  };
  conversations: {
    list: () => Promise<ConversationSummary[]>;
    create: (request?: CreateConversationRequest) => Promise<ConversationSummary>;
    get: (conversationId: string) => Promise<ConversationDetail>;
    getPage: (conversationId: string, request?: ConversationPageRequest) => Promise<ConversationPage>;
    getStats: () => Promise<ConversationStats>;
    delete: (conversationId: string) => Promise<void>;
    rename: (conversationId: string, title: string) => Promise<ConversationSummary>;
    getWorkspace: (conversationId: string) => Promise<ConversationWorkspace>;
    setWorkspace: (request: SetConversationWorkspaceRequest) => Promise<ConversationWorkspace>;
  };
  projects: {
    list: () => Promise<WorkspaceProject[]>;
    /** Resolves to null when the native folder picker was cancelled. */
    create: (request?: CreateWorkspaceProjectRequest) => Promise<WorkspaceProject | null>;
    rename: (projectId: string, title: string) => Promise<WorkspaceProject>;
    delete: (projectId: string) => Promise<void>;
    reveal: (projectId: string) => Promise<void>;
  };
  chat: {
    start: (request: ChatStartRequest) => Promise<ChatStartResponse>;
    abort: (requestId: string) => Promise<void>;
    respondToolApproval: (request: ToolApprovalResponseRequest) => Promise<void>;
    getRuntimeState: (request: RuntimeStateRequest) => Promise<RuntimeStateSnapshot>;
    getContextUsage: (request: GetContextUsageRequest) => Promise<ContextUsageSnapshot>;
    recoverEvents: (request: RecoverEventsRequest) => Promise<RecoverEventsResponse>;
    openVisualWindow: (request: OpenVisualWindowRequest) => Promise<void>;
    subscribe: (listener: (event: StreamEvent) => void) => () => void;
  };
  visuals: {
    save: (request: SaveVisualRequest) => Promise<SavedVisual>;
    list: (limit?: number) => Promise<SavedVisual[]>;
    get: (id: string) => Promise<SavedVisual | null>;
    search: (query: string, limit?: number) => Promise<SavedVisual[]>;
    delete: (id: string) => Promise<boolean>;
  };
  sites: {
    list: (includeDeleted?: boolean) => Promise<SiteSummary[]>;
    get: (siteId: string) => Promise<SiteDetail>;
    create: (request: CreateSiteRequest) => Promise<SiteDetail>;
    rename: (siteId: string, title: string) => Promise<SiteDetail>;
    delete: (siteId: string) => Promise<void>;
    restore: (siteId: string) => Promise<SiteDetail>;
    purge: (siteId: string) => Promise<void>;
    readFile: (request: ReadSiteFileRequest) => Promise<string>;
    writeFile: (request: WriteSiteFileRequest) => Promise<SiteDetail>;
    deleteFile: (request: DeleteSiteFileRequest) => Promise<SiteDetail>;
    build: (siteId: string) => Promise<SiteDetail>;
    review: (siteId: string) => Promise<SiteReviewChecklist>;
    publish: (request: PublishSiteRequest) => Promise<SiteDetail>;
    unpublish: (siteId: string) => Promise<SiteDetail>;
    rollback: (request: RollbackSiteRequest) => Promise<SiteDetail>;
    resetDraft: (request: RollbackSiteRequest) => Promise<SiteDetail>;
    previewTarget: (request: OpenSitePreviewRequest) => Promise<SitePreviewTarget>;
    openPreviewWindow: (request: OpenSitePreviewRequest) => Promise<SitePreviewTarget>;
    export: (request: ExportSiteRequest) => Promise<ExportSiteResult>;
    openInBrowser: (siteId: string, versionId?: string | null) => Promise<string>;
  };
  diagnostics: {
    getSnapshot: () => Promise<DiagnosticsSnapshot>;
  };
  updates: {
    getState: () => Promise<AppUpdateSnapshot>;
    check: () => Promise<AppUpdateSnapshot>;
    performPrimaryAction: () => Promise<void>;
    subscribe: (listener: (snapshot: AppUpdateSnapshot) => void) => () => void;
  };
  posthog: {
    getAnonymousId: () => Promise<string>;
    captureEvent: (event: string, properties?: Record<string, unknown>) => void;
    isTelemetryEnabled: () => Promise<boolean>;
    setTelemetryEnabled: (enabled: boolean) => Promise<boolean>;
  };
};
