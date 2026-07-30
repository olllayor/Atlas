import { randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';

import type { AttachmentStore } from '../../attachments/AttachmentStore';
import { buildAttachmentUrl } from '../../attachments/AttachmentStore';
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
  ToolExecutionRecord,
  WorkLogEntry,
  WorkspaceMode
} from '../../../shared/contracts';
import { isInlinableTextMediaType } from '../../../shared/attachments';
import { DEFAULT_WORKSPACE_MODE, isWorkspaceMode } from '../../../shared/workspaceModes';
import { decodeConversationPageCursor, encodeConversationPageCursor } from '../../../shared/conversationPaging';
import { buildFallbackMessageParts, getReasoningContentFromParts, getTextContentFromParts } from '../../../shared/messageParts';
import { workLogEntryToChatToolPart } from '../../../shared/runtimeActivity';
import type { SqliteDatabase } from '../client';
import type { RuntimeStateRepo } from './runtimeStateRepo';
import type { ToolExecutionsRepo } from './toolExecutionsRepo';

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  default_provider_id: ProviderId | null;
  default_model_id: string | null;
  workspace_mode: string | null;
  project_id: string | null;
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
  workspaceMode: string | null;
  projectId: string | null;
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

  const toolParts = toolExecutions.map(buildToolPartFromRecord);
  return mergeToolParts(message, toolParts);
}

function hydrateMessagePartsWithActivities(message: ChatMessage, activities: WorkLogEntry[]) {
  if (activities.length === 0) {
    return message;
  }

  const latestByToolIdentity = new Map<string, WorkLogEntry>();
  for (const activity of activities) {
    const toolIdentity = activity.toolCallId ?? activity.approvalId;
    if (!toolIdentity) {
      continue;
    }

    const current = latestByToolIdentity.get(toolIdentity);
    if (!current || current.sequence <= activity.sequence) {
      latestByToolIdentity.set(toolIdentity, activity);
    }
  }

  const toolParts = [...latestByToolIdentity.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .map(workLogEntryToChatToolPart);

  return mergeToolParts(message, toolParts);
}

function mergeToolParts(message: ChatMessage, toolParts: ChatToolPart[]) {
  if (toolParts.length === 0) {
    return message;
  }

  const replacementsByToolCallId = new Map<string, ChatToolPart>();
  const replacementsByApprovalId = new Map<string, ChatToolPart>();
  const usedReplacementIds = new Set<string>();

  for (const part of toolParts) {
    replacementsByToolCallId.set(part.toolCallId, part);
    if (part.approval?.id) {
      replacementsByApprovalId.set(part.approval.id, part);
    }
  }

  let changed = false;
  const mergedParts = message.parts.map((part) => {
    if (part.type !== 'tool') {
      return part;
    }

    const replacement =
      replacementsByToolCallId.get(part.toolCallId) ??
      (part.approval?.id ? replacementsByApprovalId.get(part.approval.id) : undefined);

    if (!replacement) {
      return part;
    }

    usedReplacementIds.add(replacement.id);
    changed = true;
    const mergedApprovalId = replacement.approval?.id ?? part.approval?.id;

    return {
      ...part,
      ...replacement,
      approval: mergedApprovalId
        ? {
            id: mergedApprovalId,
            approved: replacement.approval?.approved ?? part.approval?.approved,
            reason: replacement.approval?.reason ?? part.approval?.reason,
          }
        : undefined,
    };
  });

  const unseenToolParts = toolParts.filter((part) => !usedReplacementIds.has(part.id));
  if (!changed && unseenToolParts.length === 0) {
    return message;
  }

  return {
    ...message,
    parts: unseenToolParts.length > 0 ? [...mergedParts, ...unseenToolParts] : mergedParts,
  };
}

/**
 * Point stored file parts at the attachment scheme.
 *
 * The `url` written at persist time is not authoritative — rows written before
 * the scheme existed hold a `file://` path the renderer's CSP blocks, which is
 * why stored images used to render as a bare filename. The storage key is the
 * durable identity, so the URL is derived from it on the way out and old rows
 * heal without a migration.
 */
function withRendererAttachmentUrls(parts: ChatMessagePart[]): ChatMessagePart[] {
  let changed = false;

  const next = parts.map((part) => {
    if (part.type !== 'file' || !part.storageKey) {
      return part;
    }

    const url = buildAttachmentUrl(part.storageKey);
    if (url === part.url) {
      return part;
    }

    changed = true;
    return { ...part, url };
  });

  return changed ? next : parts;
}

function mapMessage(row: MessageRow): ChatMessage {
  const parts = withRendererAttachmentUrls(
    parseJson<ChatMessagePart[]>(row.parts_json) ?? buildFallbackMessageParts({
          content: row.content,
          reasoning: row.reasoning,
          role: row.role
        })
  );

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

/**
 * Ceiling on inlined attachment text.
 *
 * An attachment may be 15 MB (`MAX_ATTACHMENT_SIZE_BYTES`); pasting that into
 * the prompt would blow past any context window and be billed for the
 * privilege. The cut is marked in the text so the model is told the file
 * continues rather than being handed a document that appears to end mid-line.
 */
const MAX_INLINED_TEXT_CHARS = 120_000;

/** UTF-8 from either stored bytes or the `data:` URL an unsaved part carries. */
function decodeTextAttachment(data: Uint8Array | string): string | null {
  try {
    if (typeof data !== 'string') {
      return new TextDecoder().decode(data);
    }

    if (!data.startsWith('data:')) {
      return null;
    }

    const comma = data.indexOf(',');
    if (comma === -1) {
      return null;
    }

    const meta = data.slice(0, comma);
    const payload = data.slice(comma + 1);

    return meta.includes(';base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function formatInlinedTextAttachment(
  filename: string | undefined,
  mediaType: string,
  text: string,
) {
  const name = filename ?? 'attachment';
  const truncated = text.length > MAX_INLINED_TEXT_CHARS;
  const body = truncated ? text.slice(0, MAX_INLINED_TEXT_CHARS) : text;
  // A fence keeps the file's own newlines and markdown from being read as part
  // of the surrounding message.
  const fence = '```';

  return [
    `Attached file: ${name} (${mediaType})`,
    fence,
    body,
    fence,
    truncated ? `[truncated after ${MAX_INLINED_TEXT_CHARS} characters]` : null,
  ]
    .filter((line): line is string => line != null)
    .join('\n');
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

    // A text file is prompt text, not a modality. Sending it as a file part
    // asked for document support the model may not have, and several endpoints
    // reject a `text/markdown` file part outright — while the same bytes as
    // text are accepted by every model there is.
    if (isInlinableTextMediaType(part.mediaType, part.filename)) {
      const text = decodeTextAttachment(data);
      if (text != null) {
        content.push({
          type: 'text',
          text: formatInlinedTextAttachment(part.filename, part.mediaType, text),
        });
        continue;
      }
      // Undecodable bytes fall through and travel as a file, which at least
      // preserves what was attached instead of dropping it silently.
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
    defaultModelId: row.defaultModelId,
    workspaceMode: normalizeWorkspaceMode(row.workspaceMode),
    projectId: row.projectId
  };
}

/**
 * A row written before the mode column existed — or by a future build with a
 * mode this one does not know — reads back as `work`, the mode that grants the
 * least.
 */
function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  return isWorkspaceMode(value) ? value : DEFAULT_WORKSPACE_MODE;
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

const NOOP_RUNTIME_STATE_REPO: Pick<RuntimeStateRepo, 'listActivitiesByMessageIds'> = {
  listActivitiesByMessageIds: () => [],
};

export class ConversationsRepo {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly attachmentStore: Pick<
      AttachmentStore,
      'deleteConversationAttachments' | 'readAttachmentData'
    > = NOOP_ATTACHMENT_STORE,
    private readonly toolExecutionsRepo: Pick<ToolExecutionsRepo, 'listByMessageIds'> = NOOP_TOOL_EXECUTIONS_REPO,
    private readonly runtimeStateRepo: Pick<RuntimeStateRepo, 'listActivitiesByMessageIds'> = NOOP_RUNTIME_STATE_REPO,
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
            c.default_model_id AS defaultModelId,
            c.workspace_mode AS workspaceMode,
            c.project_id AS projectId
          FROM conversations c
          ORDER BY c.updated_at DESC
        `
      )
      .all();

    return rows.map(mapConversationSummary);
  }

  /**
   * `defaults` carry the user's working mode onto the new conversation the way
   * Codex-style clients do: mode and project follow you, so starting a second
   * thread on the same repo needs no setup. The caller supplies them because
   * the preference lives in settings, not here.
   */
  create(defaults: { workspaceMode?: WorkspaceMode; projectId?: string | null } = {}) {
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
            default_model_id,
            workspace_mode,
            project_id
          )
          VALUES (
            @id,
            @title,
            @createdAt,
            @updatedAt,
            NULL,
            NULL,
            @workspaceMode,
            @projectId
          )
        `
      )
      .run({
        id,
        title,
        createdAt,
        updatedAt: createdAt,
        workspaceMode: normalizeWorkspaceMode(defaults.workspaceMode),
        projectId: defaults.projectId ?? null
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

  /**
   * Rename a conversation. Mirrors `sitesRepo.renameSite`, minus the
   * `updated_at` bump: the sidebar is ordered by `updated_at DESC`, so
   * bumping it would teleport the row you just renamed to the top of the
   * list — a rename is not activity.
   */
  rename(conversationId: string, title: string, options: { auto?: boolean } = {}): ConversationSummary {
    const normalized = title.replace(/\s+/g, ' ').trim().slice(0, 200);

    if (!normalized) {
      throw new Error('Conversation title cannot be empty.');
    }

    const result = this.db
      .prepare(
        `
          UPDATE conversations
          SET title = @title, title_auto = @titleAuto
          WHERE id = @conversationId
        `
      )
      .run({ conversationId, title: normalized, titleAuto: options.auto ? 1 : 0 });

    if (result.changes === 0) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    return this.list().find((conversation: ConversationSummary) => conversation.id === conversationId)!;
  }

  /** The mode and project a turn should run under. Never taken from the renderer. */
  getWorkspace(conversationId: string): { mode: WorkspaceMode; projectId: string | null } {
    const row = this.db
      .prepare<{ conversationId: string }, { workspace_mode: string | null; project_id: string | null }>(
        `
          SELECT workspace_mode, project_id
          FROM conversations
          WHERE id = @conversationId
        `
      )
      .get({ conversationId });

    return {
      mode: normalizeWorkspaceMode(row?.workspace_mode),
      projectId: row?.project_id ?? null
    };
  }

  /**
   * Set either half of the workspace. Like `rename`, this does not bump
   * `updated_at`: switching mode is not conversation activity and must not
   * reorder the sidebar.
   */
  setWorkspace(
    conversationId: string,
    patch: { mode?: WorkspaceMode; projectId?: string | null }
  ): { mode: WorkspaceMode; projectId: string | null } {
    const current = this.getWorkspace(conversationId);
    const mode = patch.mode ?? current.mode;
    const projectId = patch.projectId === undefined ? current.projectId : patch.projectId;

    const result = this.db
      .prepare(
        `
          UPDATE conversations
          SET workspace_mode = @mode, project_id = @projectId
          WHERE id = @conversationId
        `
      )
      .run({ conversationId, mode, projectId });

    if (result.changes === 0) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    return { mode, projectId };
  }

  /**
   * Title plus its provenance. Automatic naming needs both: it may replace a
   * placeholder or an earlier auto-name, but never a title the user typed.
   */
  getTitleState(conversationId: string): { title: string; auto: boolean } | null {
    const row = this.db
      .prepare<{ conversationId: string }, { title: string; titleAuto: number }>(
        `
          SELECT title AS title, title_auto AS titleAuto
          FROM conversations
          WHERE id = @conversationId
        `
      )
      .get({ conversationId });

    return row ? { title: row.title, auto: Boolean(row.titleAuto) } : null;
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
            default_model_id,
            workspace_mode,
            project_id
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
        defaultModelId: conversation.default_model_id,
        workspaceMode: normalizeWorkspaceMode(conversation.workspace_mode),
        projectId: conversation.project_id
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
            default_model_id,
            workspace_mode,
            project_id
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
        defaultModelId: conversation.default_model_id,
        workspaceMode: normalizeWorkspaceMode(conversation.workspace_mode),
        projectId: conversation.project_id
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
    const activities = this.runtimeStateRepo.listActivitiesByMessageIds(messageIds);
    if (activities.length > 0) {
      const byMessageId = new Map<string, WorkLogEntry[]>();
      for (const activity of activities) {
        if (!activity.messageId) {
          continue;
        }

        const bucket = byMessageId.get(activity.messageId);
        if (bucket) {
          bucket.push(activity);
        } else {
          byMessageId.set(activity.messageId, [activity]);
        }
      }

      return messages.map((message) =>
        hydrateMessagePartsWithActivities(message, byMessageId.get(message.id) ?? [])
      );
    }

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

  /**
   * Rewrites every stored reference to a provider id. Used when the built-in
   * providers were converted into user-configured ones, so old conversations
   * still resolve to a live provider instead of erroring on send.
   */
  remapProviderId(from: ProviderId, to: ProviderId) {
    const tables = [
      { table: 'conversations', column: 'default_provider_id' },
      { table: 'messages', column: 'provider_id' },
      { table: 'conversation_events', column: 'provider_id' },
      { table: 'conversation_turns', column: 'provider_id' },
      { table: 'provider_sessions', column: 'provider_id' },
    ];

    for (const { table, column } of tables) {
      try {
        this.db
          .prepare(`UPDATE ${table} SET ${column} = @to WHERE ${column} = @from`)
          .run({ from, to });
      } catch {
        // A table from a newer or older schema revision; the remap is
        // best-effort and must not block startup.
      }
    }
  }

  /**
   * Provider-reported token usage for the newest turn that reported any.
   *
   * This is the only ground truth the app has about how a given model counts
   * tokens, so the context estimator calibrates against it rather than trusting
   * a character heuristic indefinitely.
   */
  getLatestUsage(conversationId: string) {
    const row = this.db
      .prepare<
        { conversationId: string },
        { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null }
      >(
        `
          SELECT
            input_tokens AS inputTokens,
            output_tokens AS outputTokens,
            reasoning_tokens AS reasoningTokens
          FROM messages
          WHERE conversation_id = @conversationId
            AND role = 'assistant'
            AND input_tokens IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get({ conversationId });

    if (!row) {
      return null;
    }

    return {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
    };
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
