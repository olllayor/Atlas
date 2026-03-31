export type ProviderId = 'openrouter' | 'openai' | 'gemini' | 'anthropic';

export type CredentialStatus = 'missing' | 'valid' | 'invalid' | 'unknown';

export type MessageRole = 'system' | 'user' | 'assistant';

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'aborted';

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
  status: MessageStatus;
  providerId: ProviderId | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
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
  temperature?: number;
  maxOutputTokens?: number;
};

export type ChatStartResponse = {
  requestId: string;
};

export type StreamChunkEvent = {
  type: 'chunk';
  requestId: string;
  delta: string;
};

export type StreamMetaEvent = {
  type: 'meta';
  requestId: string;
  inputTokens?: number;
  outputTokens?: number;
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
    saveOpenAiKey: (secret: string) => Promise<SettingsSummary>;
    validateOpenAiKey: () => Promise<SettingsSummary>;
    saveGeminiKey: (secret: string) => Promise<SettingsSummary>;
    validateGeminiKey: () => Promise<SettingsSummary>;
    saveAnthropicKey: (secret: string) => Promise<SettingsSummary>;
    validateAnthropicKey: () => Promise<SettingsSummary>;
    updatePreferences: (patch: SettingsUpdateRequest) => Promise<SettingsSummary>;
  };
  models: {
    list: (options?: ListModelsOptions) => Promise<ModelSummary[]>;
    refresh: () => Promise<ModelSummary[]>;
    refreshProvider: (providerId: ProviderId) => Promise<ModelSummary[]>;
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
