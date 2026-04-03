export type ProviderId = 'openrouter' | 'glm' | 'openai' | 'gemini';

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
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

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
};

export type ChatVisualPart = {
  id: string;
  type: 'visual';
  content: string;
  state: ChatPartState;
  title?: string;
};

export type ChatMessagePart = ChatTextPart | ChatReasoningPart | ChatFilePart | ChatToolPart | ChatVisualPart;

export type ModelSummary = {
  id: string;
  providerId: ProviderId;
  label: string;
  contextWindow: number | null;
  isFree: boolean;
  supportsVision: boolean;
  supportsDocumentInput: boolean;
  supportsTools: boolean;
  archived: boolean;
  lastSyncedAt: string;
  lastSeenFreeAt: string | null;
};

export type ListModelsOptions = {
  freeOnly?: boolean;
  includeArchived?: boolean;
  allowStale?: boolean;
};

export type ProviderCredentialSummary = {
  providerId: ProviderId;
  hasSecret: boolean;
  status: CredentialStatus;
  validatedAt: string | null;
};

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontFamilyOverride = string | null;

export const UI_FONT_SIZE_MIN = 13;
export const UI_FONT_SIZE_MAX = 18;
export const UI_FONT_SIZE_DEFAULT = 15;

export const CODE_FONT_SIZE_MIN = 11;
export const CODE_FONT_SIZE_MAX = 16;
export const CODE_FONT_SIZE_DEFAULT = 13;

export type SettingsSection = 'general' | 'appearance' | 'keyboard' | 'usage';

export type SettingsAppearanceSummary = {
  themeMode: ThemeMode;
  uiFontSize: number;
  codeFontSize: number;
  uiFontFamily: FontFamilyOverride;
  codeFontFamily: FontFamilyOverride;
};

export const DEFAULT_SETTINGS_APPEARANCE: SettingsAppearanceSummary = {
  themeMode: 'dark',
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  uiFontFamily: null,
  codeFontFamily: null
};

export type SettingsKeyboardSummary = {
  keybindings: import('./keybindings').KeybindingRule[];
};

export type SettingsSummary = {
  providers: ProviderCredentialSummary[];
  defaultProviderId: ProviderId | null;
  appearance: SettingsAppearanceSummary;
  keyboard: SettingsKeyboardSummary;
  showFreeOnlyByDefault: boolean;
  modelCatalogLastSyncedAt: string | null;
  modelCatalogStale: boolean;
  modelCatalogCount: number;
};

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
  };
  messages: ChatMessage[];
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
  temperature?: number;
  maxOutputTokens?: number;
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

export type StreamToolInputStartEvent = {
  type: 'tool-input-start';
  requestId: string;
  toolCallId: string;
  toolName: string;
  dynamic?: boolean;
  providerExecuted?: boolean;
  title?: string;
};

export type StreamToolInputDeltaEvent = {
  type: 'tool-input-delta';
  requestId: string;
  toolCallId: string;
  delta: string;
};

export type StreamToolInputAvailableEvent = {
  type: 'tool-input-available';
  requestId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  dynamic?: boolean;
  providerExecuted?: boolean;
  title?: string;
};

export type StreamToolOutputAvailableEvent = {
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

export type StreamToolOutputErrorEvent = {
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

export type StreamToolOutputDeniedEvent = {
  type: 'tool-output-denied';
  requestId: string;
  toolCallId: string;
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

export type StreamEvent =
  | StreamChunkEvent
  | StreamReasoningEvent
  | StreamToolInputStartEvent
  | StreamToolInputDeltaEvent
  | StreamToolInputAvailableEvent
  | StreamToolOutputAvailableEvent
  | StreamToolOutputErrorEvent
  | StreamToolOutputDeniedEvent
  | StreamVisualStartEvent
  | StreamVisualCompleteEvent
  | StreamMetaEvent
  | StreamErrorEvent
  | StreamDoneEvent;

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
};

export type SettingsUpdateRequest = {
  showFreeOnlyByDefault?: boolean;
  appearance?: {
    themeMode?: ThemeMode;
    uiFontSize?: number;
    codeFontSize?: number;
    uiFontFamily?: FontFamilyOverride;
    codeFontFamily?: FontFamilyOverride;
  };
  keyboard?: {
    keybindings?: import('./keybindings').KeybindingRule[];
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
  };
  conversations: {
    list: () => Promise<ConversationSummary[]>;
    create: () => Promise<ConversationSummary>;
    get: (conversationId: string) => Promise<ConversationDetail>;
    getPage: (conversationId: string, request?: ConversationPageRequest) => Promise<ConversationPage>;
    getStats: () => Promise<ConversationStats>;
    delete: (conversationId: string) => Promise<void>;
  };
  chat: {
    start: (request: ChatStartRequest) => Promise<ChatStartResponse>;
    abort: (requestId: string) => Promise<void>;
    openVisualWindow: (request: OpenVisualWindowRequest) => Promise<void>;
    subscribe: (listener: (event: StreamEvent) => void) => () => void;
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
};
