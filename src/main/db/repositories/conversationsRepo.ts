import { randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';

import type {
  ChatMessage,
  ChatMessagePart,
  ConversationDetail,
  ConversationSummary,
  MessageRole,
  MessageStatus,
  ProviderId
} from '../../../shared/contracts';
import { buildFallbackMessageParts, getReasoningContentFromParts, getTextContentFromParts } from '../../../shared/messageParts';
import type { SqliteDatabase } from '../client';

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

  return JSON.parse(value) as T;
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

export class ConversationsRepo {
  constructor(private readonly db: SqliteDatabase) {}

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
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS lastMessagePreview,
            (
              SELECT m.created_at
              FROM messages m
              WHERE m.conversation_id = c.id
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

    return rows.map<ConversationSummary>((row: ConversationSummaryRow) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageAt: row.lastMessageAt,
      defaultProviderId: row.defaultProviderId,
      defaultModelId: row.defaultModelId
    }));
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

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        defaultProviderId: conversation.default_provider_id,
        defaultModelId: conversation.default_model_id
      },
      messages
    };
  }

  getModelHistory(conversationId: string) {
    const rows = this.db
      .prepare<{ conversationId: string }, Pick<MessageRow, 'role' | 'content' | 'response_messages_json'>>(
        `
          SELECT
            role,
            content,
            response_messages_json
          FROM messages
          WHERE conversation_id = @conversationId
          ORDER BY created_at ASC
        `
      )
      .all({ conversationId });

    const history: ModelMessage[] = [];

    for (const row of rows) {
      const responseMessages = parseJson<ModelMessage[]>(row.response_messages_json);

      if (row.role === 'assistant' && responseMessages?.length) {
        history.push(...responseMessages);
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
