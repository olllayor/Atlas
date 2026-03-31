export type ProviderId = 'openrouter' | 'openai' | 'gemini';

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

export type ChatMessagePart = ChatTextPart | ChatReasoningPart | ChatToolPart;

export type ModelSummary = {
  id: string;
  providerId: ProviderId;
  label: string;
  contextWindow: number | null;
  isFree: boolean;
  supportsVision: boolean;
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

export type SettingsSummary = {
  providers: ProviderCredentialSummary[];
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

export type ChatInputMessage = {
  role: MessageRole;
  content: string;
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
  | StreamMetaEvent
  | StreamErrorEvent
  | StreamDoneEvent;

export type SettingsUpdateRequest = {
  showFreeOnlyByDefault?: boolean;
};

export type RendererApi = {
  settings: {
    getSummary: () => Promise<SettingsSummary>;
    saveOpenRouterKey: (secret: string) => Promise<SettingsSummary>;
    validateOpenRouterKey: () => Promise<SettingsSummary>;
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
  };
  chat: {
    start: (request: ChatStartRequest) => Promise<ChatStartResponse>;
    abort: (requestId: string) => Promise<void>;
    subscribe: (listener: (event: StreamEvent) => void) => () => void;
  };
};
