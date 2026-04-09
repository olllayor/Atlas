import { randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';

import type { AttachmentStore } from '../../attachments/AttachmentStore';
import type {
  ChatMessage,
  ChatMessagePart,
  ChatToolPart,
  ConversationDetail,
  ConversationPage,
  ConversationPageRequest,
  ConversationStats,
  ConversationSummary,
  MessageRole,
  MessageStatus,
  ProviderId,
  ToolExecutionRecord
} from '../../../shared/contracts';
import { decodeConversationPageCursor, encodeConversationPageCursor } from '../../../shared/conversationPaging';
import { buildFallbackMessageParts, getReasoningContentFromParts, getTextContentFromParts } from '../../../shared/messageParts';
import type { SqliteDatabase } from '../client';
import type { ToolExecutionsRepo } from './toolExecutionsRepo';

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  default_provider_id: ProviderId | null;
  default_model_id: string | null;
};

type ConversationSummaryRow = {
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

type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  reasoning: string | null;
  parts_json: string | null;
  response_messages_json: string | null;
  status: MessageStatus;
  provider_id: ProviderId | null;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  latency_ms: number | null;
  error_code: string | null;
  created_at: string;
};

type CreateMessageInput = {
  id?: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  reasoning?: string | null;
  parts?: ChatMessagePart[] | null;
  responseMessages?: ModelMessage[] | null;
  status: MessageStatus;
  providerId: ProviderId | null;
  modelId: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  createdAt?: string;
};

type UpdateMessageInput = {
  messageId: string;
  content?: string;
  reasoning?: string | null;
  parts?: ChatMessagePart[] | null;
  responseMessages?: ModelMessage[] | null;
  status?: MessageStatus;
  providerId?: ProviderId | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
};

function formatConversationTitle(timestamp: Date) {
  const formatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `Session · ${formatter.format(timestamp)}`;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapToolExecutionStateToPartState(record: ToolExecutionRecord): ChatToolPart['state'] {
  switch (record.state) {
    case 'queued':
      return 'input-streaming';
    case 'running':
      return 'input-available';
    case 'approval_requested':
      return 'approval-requested';
    case 'approved':
      return 'approval-responded';
    case 'denied':
      return 'output-denied';
    case 'partial':
      return 'output-partial';
    case 'completed':
      return 'output-available';
    case 'error':
      return 'output-error';
    default:
      return 'input-available';
  }
}

function buildToolPartFromRecord(record: ToolExecutionRecord): ChatToolPart {
  const outputPreview = record.finalOutputPreview ?? record.partialOutputPreview ?? undefined;

  return {
    id: record.id,
    type: 'tool',
    toolCallId: record.id,
    requestId: record.requestId,
    toolName: record.toolName,
    state: mapToolExecutionStateToPartState(record),
    rawInput: record.inputPreview ?? undefined,
    input: record.inputPreview ?? undefined,
    output: outputPreview,
    errorText: record.errorMessage ?? undefined,
    preliminary: record.state === 'partial',
    approval: record.requiresApproval
      ? {
          id: record.approvalId ?? record.id,
          approved:
            record.state === 'approved'
              ? true
              : record.state === 'denied'
                ? false
                : undefined,
          reason: record.approvalReason ?? undefined,
        }
      : undefined,
  };
}

function hydrateMessagePartsWithToolExecutions(message: ChatMessage, toolExecutions: ToolExecutionRecord[]) {
  if (toolExecutions.length === 0) {
    return message;
  }

  const nonToolParts = message.parts.filter((part) => part.type !== 'tool');
  const toolParts = toolExecutions.map(buildToolPartFromRecord);
  return {
    ...message,
    parts: [...nonToolParts, ...toolParts],
  };
}

function mapMessage(row: MessageRow): ChatMessage {
  const parts = parseJson<ChatMessagePart[]>(row.parts_json) ?? buildFallbackMessageParts({
          content: row.content,
          reasoning: row.reasoning,
          role: row.role
        });

  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning,
    parts,
    status: row.status,
    providerId: row.provider_id,
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    latencyMs: row.latency_ms,
    errorCode: row.error_code,
    createdAt: row.created_at
  };
}

function buildModelMessageContent(
  parts: ChatMessagePart[],
  attachmentStore: Pick<AttachmentStore, 'readAttachmentData'>,
) {
  const content: Array<
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'file';
        data: Uint8Array | string;
        filename: string | undefined;
        mediaType: string;
      }
  > = [];

  for (const part of parts) {
    if (part.type === 'text') {
      content.push({
        type: 'text',
        text: part.text,
      });
      continue;
    }

    if (part.type !== 'file') {
      continue;
    }

    const storedData = part.storageKey ? attachmentStore.readAttachmentData(part.storageKey) : null;
    const data = storedData ?? (part.url.startsWith('data:') ? part.url : null);

    if (!data) {
      continue;
    }

    content.push({
      type: 'file',
      data,
      filename: part.filename,
      mediaType: part.mediaType,
    });
  }

  if (content.length === 0) {
    const text = getTextContentFromParts(parts);
    return text;
  }

  return content;
}

function mapConversationSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessagePreview: row.lastMessagePreview,
    lastUserMessagePreview: row.lastUserMessagePreview,
    lastAssistantMessagePreview: row.lastAssistantMessagePreview,
    lastMessageAt: row.lastMessageAt,
    defaultProviderId: row.defaultProviderId,
    defaultModelId: row.defaultModelId
  };
}

const NOOP_ATTACHMENT_STORE: Pick<
  AttachmentStore,
  'deleteConversationAttachments' | 'readAttachmentData'
> = {
  deleteConversationAttachments: () => undefined,
  readAttachmentData: () => null,
};

const NOOP_TOOL_EXECUTIONS_REPO: Pick<ToolExecutionsRepo, 'listByMessageIds'> = {
  listByMessageIds: () => [],
};

export class ConversationsRepo {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly attachmentStore: Pick<
      AttachmentStore,
      'deleteConversationAttachments' | 'readAttachmentData'
    > = NOOP_ATTACHMENT_STORE,
    private readonly toolExecutionsRepo: Pick<ToolExecutionsRepo, 'listByMessageIds'> = NOOP_TOOL_EXECUTIONS_REPO,
  ) {}

  list() {
    const rows = this.db
      .prepare<[], ConversationSummaryRow>(
        `
          SELECT
            c.id AS id,
            c.title AS title,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            (
              SELECT substr(m.content, 1, 160)
              FROM messages m
              WHERE m.conversation_id = c.id
                AND NOT (
                  m.role = 'assistant'
                  AND m.status = 'streaming'
                  AND trim(m.content) = ''
                )
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS lastMessagePreview,
            (
              SELECT substr(m.content, 1, 160)
              FROM messages m
              WHERE m.conversation_id = c.id
                AND m.role = 'user'
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT 1
            ) AS lastUserMessagePreview,
            (
              SELECT substr(m.content, 1, 160)
              FROM messages m
              WHERE m.conversation_id = c.id
                AND m.role = 'assistant'
                AND NOT (m.status = 'streaming' AND trim(m.content) = '')
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT 1
            ) AS lastAssistantMessagePreview,
            (
              SELECT m.created_at
              FROM messages m
              WHERE m.conversation_id = c.id
                AND NOT (
                  m.role = 'assistant'
                  AND m.status = 'streaming'
                  AND trim(m.content) = ''
                )
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS lastMessageAt,
            c.default_provider_id AS defaultProviderId,
            c.default_model_id AS defaultModelId
          FROM conversations c
          ORDER BY c.updated_at DESC
        `
      )
      .all();

    return rows.map(mapConversationSummary);
  }

  create() {
    const now = new Date();
    const createdAt = now.toISOString();
    const id = randomUUID();
    const title = formatConversationTitle(now);

    this.db
      .prepare(
        `
          INSERT INTO conversations (
            id,
            title,
            created_at,
            updated_at,
            default_provider_id,
            default_model_id
          )
          VALUES (
            @id,
            @title,
            @createdAt,
            @updatedAt,
            NULL,
            NULL
          )
        `
      )
      .run({
        id,
        title,
        createdAt,
        updatedAt: createdAt
      });

    return this.list().find((conversation: ConversationSummary) => conversation.id === id)!;
  }

  delete(conversationId: string) {
    this.db
      .prepare(
        `
          DELETE FROM conversations
          WHERE id = @conversationId
        `
      )
      .run({ conversationId });

    this.attachmentStore.deleteConversationAttachments(conversationId);
  }

  get(conversationId: string): ConversationDetail {
    const conversation = this.db
      .prepare<{ conversationId: string }, ConversationRow>(
        `
          SELECT
            id,
            title,
            created_at,
            updated_at,
            default_provider_id,
            default_model_id
          FROM conversations
          WHERE id = @conversationId
        `
      )
      .get({ conversationId });

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const messages = this.db
      .prepare<{ conversationId: string }, MessageRow>(
        `
          SELECT
            id,
            conversation_id,
            role,
            content,
            reasoning,
            parts_json,
            response_messages_json,
            status,
            provider_id,
            model_id,
            input_tokens,
            output_tokens,
            reasoning_tokens,
            latency_ms,
            error_code,
            created_at
          FROM messages
          WHERE conversation_id = @conversationId
          ORDER BY created_at ASC
        `
      )
      .all({ conversationId })
      .map((row: MessageRow) => mapMessage(row));

    const hydratedMessages = this.hydrateMessagesWithToolExecutions(messages);

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        defaultProviderId: conversation.default_provider_id,
        defaultModelId: conversation.default_model_id
      },
      messages: hydratedMessages
    };
  }

  getPage(conversationId: string, request: ConversationPageRequest = {}): ConversationPage {
    const conversation = this.db
      .prepare<{ conversationId: string }, ConversationRow>(
        `
          SELECT
            id,
            title,
            created_at,
            updated_at,
            default_provider_id,
            default_model_id
          FROM conversations
          WHERE id = @conversationId
        `
      )
      .get({ conversationId });

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const limit = Math.max(1, Math.min(Math.floor(request.limit ?? 100), 250));
    const cursor = request.cursor ? decodeConversationPageCursor(request.cursor) : null;
    const rows =
      cursor == null
        ? this.db
            .prepare<{ conversationId: string; limit: number }, MessageRow>(
              `
                SELECT
                  id,
                  conversation_id,
                  role,
                  content,
                  reasoning,
                  parts_json,
                  response_messages_json,
                  status,
                  provider_id,
                  model_id,
                  input_tokens,
                  output_tokens,
                  reasoning_tokens,
                  latency_ms,
                  error_code,
                  created_at
                FROM messages
                WHERE conversation_id = @conversationId
                ORDER BY created_at DESC, id DESC
                LIMIT @limit
              `
            )
            .all({ conversationId, limit: limit + 1 })
        : this.db
            .prepare<{ conversationId: string; limit: number; cursorCreatedAt: string; cursorId: string }, MessageRow>(
              `
                SELECT
                  id,
                  conversation_id,
                  role,
                  content,
                  reasoning,
                  parts_json,
                  response_messages_json,
                  status,
                  provider_id,
                  model_id,
                  input_tokens,
                  output_tokens,
                  reasoning_tokens,
                  latency_ms,
                  error_code,
                  created_at
                FROM messages
                WHERE conversation_id = @conversationId
                  AND (
                    created_at < @cursorCreatedAt
                    OR (created_at = @cursorCreatedAt AND id < @cursorId)
                  )
                ORDER BY created_at DESC, id DESC
                LIMIT @limit
              `
            )
            .all({
              conversationId,
              limit: limit + 1,
              cursorCreatedAt: cursor.createdAt,
              cursorId: cursor.id
            });

    const hasOlder = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    const messages = this.hydrateMessagesWithToolExecutions(pageRows.map(mapMessage));
    const oldestMessage = messages[0];

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        defaultProviderId: conversation.default_provider_id,
        defaultModelId: conversation.default_model_id
      },
      messages,
      hasOlder,
      nextCursor: hasOlder && oldestMessage
        ? encodeConversationPageCursor({
            createdAt: oldestMessage.createdAt,
            id: oldestMessage.id
          })
        : null,
      limit
    };
  }

  getStats(): ConversationStats {
    const counts = this.db
      .prepare<[], { storedConversationCount: number; storedMessageCount: number }>(
        `
          SELECT
            (SELECT COUNT(*) FROM conversations) AS storedConversationCount,
            (SELECT COUNT(*) FROM messages) AS storedMessageCount
        `
      )
      .get();
    const pageCount = this.db.prepare<[], { page_count: number }>('PRAGMA page_count').get()?.page_count ?? 0;
    const pageSize = this.db.prepare<[], { page_size: number }>('PRAGMA page_size').get()?.page_size ?? 0;

    return {
      storedConversationCount: counts?.storedConversationCount ?? 0,
      storedMessageCount: counts?.storedMessageCount ?? 0,
      databaseSizeBytes: pageCount * pageSize
    };
  }

  private hydrateMessagesWithToolExecutions(messages: ChatMessage[]) {
    const messageIds = messages.map((message) => message.id);
    const toolExecutions = this.toolExecutionsRepo.listByMessageIds(messageIds);
    if (toolExecutions.length === 0) {
      return messages;
    }

    const byMessageId = new Map<string, ToolExecutionRecord[]>();
    for (const execution of toolExecutions) {
      const bucket = byMessageId.get(execution.messageId);
      if (bucket) {
        bucket.push(execution);
      } else {
        byMessageId.set(execution.messageId, [execution]);
      }
    }

    return messages.map((message) =>
      hydrateMessagePartsWithToolExecutions(message, byMessageId.get(message.id) ?? [])
    );
  }

  getModelHistory(conversationId: string) {
    const rows = this.db
      .prepare<
        { conversationId: string },
        Pick<MessageRow, 'role' | 'content' | 'parts_json' | 'response_messages_json'>
      >(
        `
          SELECT
            role,
            content,
            parts_json,
            response_messages_json
          FROM messages
          WHERE conversation_id = @conversationId
            AND status = 'complete'
          ORDER BY created_at ASC
        `
      )
      .all({ conversationId });

    const history: ModelMessage[] = [];

    for (const row of rows) {
      const responseMessages = parseJson<ModelMessage[]>(row.response_messages_json);
      const parts = parseJson<ChatMessagePart[]>(row.parts_json);

      if (row.role === 'assistant' && responseMessages?.length) {
        history.push(...responseMessages);
        continue;
      }

      if (row.role === 'user' && parts?.length) {
        history.push({
          role: row.role,
          content: buildModelMessageContent(parts, this.attachmentStore),
        });
        continue;
      }

      history.push({
        role: row.role,
        content: row.content
      });
    }

    return history;
  }

  setDefaults(conversationId: string, providerId: ProviderId, modelId: string) {
    this.db
      .prepare(
        `
          UPDATE conversations
          SET default_provider_id = @providerId,
              default_model_id = @modelId,
              updated_at = @updatedAt
          WHERE id = @conversationId
        `
      )
      .run({
        conversationId,
        providerId,
        modelId,
        updatedAt: new Date().toISOString()
      });
  }

  updateMessage(input: UpdateMessageInput) {
    const row = this.db
      .prepare<{ messageId: string }, { conversation_id: string }>(
        'SELECT conversation_id FROM messages WHERE id = @messageId'
      )
      .get({ messageId: input.messageId });

    if (!row) {
      throw new Error(`Message not found: ${input.messageId}`);
    }

    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE messages
          SET content = COALESCE(@content, content),
              reasoning = COALESCE(@reasoning, reasoning),
              parts_json = CASE WHEN @partsJsonPresent = 1 THEN @partsJson ELSE parts_json END,
              response_messages_json = CASE WHEN @responseMessagesJsonPresent = 1 THEN @responseMessagesJson ELSE response_messages_json END,
              status = COALESCE(@status, status),
              provider_id = COALESCE(@providerId, provider_id),
              model_id = COALESCE(@modelId, model_id),
              input_tokens = COALESCE(@inputTokens, input_tokens),
              output_tokens = COALESCE(@outputTokens, output_tokens),
              reasoning_tokens = COALESCE(@reasoningTokens, reasoning_tokens),
              latency_ms = COALESCE(@latencyMs, latency_ms),
              error_code = CASE WHEN @errorCodePresent = 1 THEN @errorCode ELSE error_code END
          WHERE id = @messageId
        `
      )
      .run({
        messageId: input.messageId,
        content: input.content ?? null,
        reasoning: input.reasoning ?? null,
        partsJsonPresent: input.parts !== undefined ? 1 : 0,
        partsJson: input.parts != null ? JSON.stringify(input.parts) : null,
        responseMessagesJsonPresent: input.responseMessages !== undefined ? 1 : 0,
        responseMessagesJson: input.responseMessages != null ? JSON.stringify(input.responseMessages) : null,
        status: input.status ?? null,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        reasoningTokens: input.reasoningTokens ?? null,
        latencyMs: input.latencyMs ?? null,
        errorCodePresent: input.errorCode !== undefined ? 1 : 0,
        errorCode: input.errorCode ?? null,
      });

    this.db
      .prepare(
        `
          UPDATE conversations
          SET updated_at = @updatedAt
          WHERE id = @conversationId
        `
      )
      .run({
        conversationId: row.conversation_id,
        updatedAt,
      });
  }

  markMessagesError(messageIds: string[], errorCode: string) {
    if (messageIds.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const placeholders = messageIds.map(() => '?').join(', ');

    this.db
      .prepare<unknown[]>(
        `
          UPDATE messages
          SET status = 'error',
              error_code = ?,
              content = CASE WHEN trim(content) = '' THEN 'Tool execution was interrupted.' ELSE content END
          WHERE id IN (${placeholders})
        `
      )
      .run(errorCode, ...messageIds);

    this.db
      .prepare<unknown[]>(
        `
          UPDATE conversations
          SET updated_at = ?
          WHERE id IN (
            SELECT DISTINCT conversation_id
            FROM messages
            WHERE id IN (${placeholders})
          )
        `
      )
      .run(now, ...messageIds);
  }

  addMessage(input: CreateMessageInput) {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();

    const transaction = this.db.transaction((messageId: string, timestamp: string) => {
      this.db
        .prepare(
          `
            INSERT INTO messages (
              id,
              conversation_id,
              role,
              content,
              reasoning,
              parts_json,
              response_messages_json,
              status,
              provider_id,
              model_id,
              input_tokens,
              output_tokens,
              reasoning_tokens,
              latency_ms,
              error_code,
              created_at
            )
            VALUES (
              @id,
              @conversationId,
              @role,
              @content,
              @reasoning,
              @partsJson,
              @responseMessagesJson,
              @status,
              @providerId,
              @modelId,
              @inputTokens,
              @outputTokens,
              @reasoningTokens,
              @latencyMs,
              @errorCode,
              @createdAt
            )
          `
        )
        .run({
          id: messageId,
          conversationId: input.conversationId,
          role: input.role,
          content: input.parts ? getTextContentFromParts(input.parts) || input.content : input.content,
          reasoning: input.parts ? getReasoningContentFromParts(input.parts) ?? input.reasoning ?? null : input.reasoning ?? null,
          partsJson: input.parts ? JSON.stringify(input.parts) : null,
          responseMessagesJson: input.responseMessages ? JSON.stringify(input.responseMessages) : null,
          status: input.status,
          providerId: input.providerId,
          modelId: input.modelId,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
          reasoningTokens: input.reasoningTokens ?? null,
          latencyMs: input.latencyMs ?? null,
          errorCode: input.errorCode ?? null,
          createdAt: timestamp
        });

      this.db
        .prepare(
          `
            UPDATE conversations
            SET updated_at = @updatedAt
            WHERE id = @conversationId
          `
        )
        .run({
          conversationId: input.conversationId,
          updatedAt: timestamp
        });
    });

    transaction(id, createdAt);
    return id;
  }
}
