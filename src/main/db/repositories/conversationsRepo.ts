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
  MessageSearchHit,
  MessageStatus,
  ProviderId,
  SearchMessagesRequest,
  ToolExecutionRecord,
  WorkLogEntry
} from '../../../shared/contracts';
import { isInlinableTextMediaType } from '../../../shared/attachments';
import {
  DEFAULT_WORKSPACE_MODE,
  DEFAULT_EXECUTION_TARGET,
  isWorkspaceMode,
  isExecutionTarget,
  type WorkspaceMode,
  type ExecutionTarget,
} from '../../../shared/workspaceModes';
import { decodeConversationPageCursor, encodeConversationPageCursor } from '../../../shared/conversationPaging';
import { buildFallbackMessageParts, getReasoningContentFromParts, getTextContentFromParts } from '../../../shared/messageParts';
import { workLogEntryToChatToolPart } from '../../../shared/runtimeActivity';
import type { ToolPermissionMode } from '../../../shared/chatParameters';
import { DEFAULT_TOOL_PERMISSION_MODE, isToolPermissionMode } from '../../../shared/chatParameters';
import type { SqliteDatabase } from '../client';
import type { ForkConversationInput } from './conversationFork';
import { forkConversation } from './conversationFork';
import { MessageSearchRepo } from './messageSearchRepo';
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
  execution_target: string | null;
  worktree_root: string | null;
  project_id: string | null;
  tool_permission_mode: string | null;
  pinned_at: string | null;
  archived_at: string | null;
  side_of_conversation_id?: string | null;
  origin?: string | null;
  subagent_mode?: string | null;
  subagent_label?: string | null;
  delegation_depth?: number | null;
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
  executionTarget: string | null;
  worktreeRoot: string | null;
  projectId: string | null;
  toolPermissionMode: string | null;
  status: import('../../../shared/contracts').ConversationStatus | null;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pinnedAt: string | null;
  archivedAt: string | null;
  forkOfConversationId: string | null;
  forkPointSequence: number | null;
  sideOfConversationId: string | null;
  /** NULL for a conversation that never changed a file — the LEFT JOIN missed. */
  changedFileCount: number | null;
  changedLinesAdded: number | null;
  changedLinesRemoved: number | null;
};

/**
 * The summary projection, shared by the sidebar listing and by the
 * single-row lookups that write paths return.
 *
 * It is one string rather than two so a column added to the list can never be
 * missing from the row a mutation hands back — the previous single-row path was
 * `list().find(...)`, which silently returned undefined for any conversation the
 * listing filtered out.
 */
const SUMMARY_SELECT = `
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
    c.execution_target AS executionTarget,
    c.worktree_root AS worktreeRoot,
    c.project_id AS projectId,
    c.tool_permission_mode AS toolPermissionMode,
    c.status AS status,
    c.last_error AS lastError,
    c.started_at AS startedAt,
    c.completed_at AS completedAt,
    c.pinned_at AS pinnedAt,
    c.archived_at AS archivedAt,
    c.fork_of_conversation_id AS forkOfConversationId,
    c.fork_point_sequence AS forkPointSequence,
    c.side_of_conversation_id AS sideOfConversationId,
    changes.fileCount AS changedFileCount,
    changes.linesAdded AS changedLinesAdded,
    changes.linesRemoved AS changedLinesRemoved
  FROM conversations c
  -- One grouped pass over file_changes instead of a query per row: the sidebar
  -- draws every conversation at once, and a per-conversation stats call would
  -- turn one listing into N+1 round trips. idx_file_changes_conversation
  -- already leads on conversation_id, so the grouping has its index and no new
  -- one is warranted; the line counts are stored, not parsed, so the aggregate
  -- never touches diff_text.
  LEFT JOIN (
    SELECT
      conversation_id,
      -- Distinct paths: several edits to one file are one changed file, which
      -- is what "12 files" is understood to mean.
      COUNT(DISTINCT file_path) AS fileCount,
      SUM(lines_added) AS linesAdded,
      SUM(lines_removed) AS linesRemoved
    FROM file_changes
    -- A reverted change left nothing behind, so it is not part of what this
    -- session did.
    WHERE status <> 'reverted'
    GROUP BY conversation_id
  ) changes ON changes.conversation_id = c.id
`;

export type ListConversationsOptions = {
  /**
   * Include archived chats. Absent or false is the sidebar's view; the archived
   * view opts in explicitly, so nothing that filters archived rows out has to
   * remember to.
   */
  includeArchived?: boolean;
  /**
   * Include side conversations. Absent or false everywhere the user browses
   * their chats: a side conversation belongs to the thread it hangs off, not to
   * history, and the whole point of it is that a tangent leaves no trace in the
   * list. Only a caller that has a specific parent in hand opts in.
   */
  includeSide?: boolean;
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
    executionTarget: normalizeExecutionTarget(row.executionTarget),
    worktreeRoot: row.worktreeRoot,
    projectId: row.projectId,
    toolPermissionMode: isToolPermissionMode(row.toolPermissionMode) ? row.toolPermissionMode : DEFAULT_TOOL_PERMISSION_MODE,
    status: row.status || 'idle',
    lastError: row.lastError,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    // Zeros, never null: the hover card reads these unconditionally, so the
    // absence of changes is a value here rather than a case to handle.
    changeStats: {
      fileCount: row.changedFileCount ?? 0,
      linesAdded: row.changedLinesAdded ?? 0,
      linesRemoved: row.changedLinesRemoved ?? 0
    },
    pinnedAt: row.pinnedAt,
    archivedAt: row.archivedAt,
    forkOfConversationId: row.forkOfConversationId,
    forkPointSequence: row.forkPointSequence,
    sideOfConversationId: row.sideOfConversationId
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

function normalizeExecutionTarget(value: unknown): ExecutionTarget {
  return isExecutionTarget(value) ? value : DEFAULT_EXECUTION_TARGET;
}

const NOOP_ATTACHMENT_STORE: Pick<
  AttachmentStore,
  'deleteConversationAttachments' | 'readAttachmentData' | 'copyAttachment'
> = {
  deleteConversationAttachments: () => undefined,
  readAttachmentData: () => null,
  // A repo with no attachment store forks the rows and leaves the file parts
  // pointing where they already pointed, which is the same nothing they
  // resolved to before.
  copyAttachment: () => null,
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
      'deleteConversationAttachments' | 'readAttachmentData' | 'copyAttachment'
    > = NOOP_ATTACHMENT_STORE,
    private readonly toolExecutionsRepo: Pick<ToolExecutionsRepo, 'listByMessageIds'> = NOOP_TOOL_EXECUTIONS_REPO,
    private readonly runtimeStateRepo: Pick<RuntimeStateRepo, 'listActivitiesByMessageIds'> = NOOP_RUNTIME_STATE_REPO,
  ) {}

  private messageSearchRepo: MessageSearchRepo | null = null;

  /**
   * The sidebar listing. Archived chats are excluded unless asked for: archive
   * is the reversible alternative to delete, so the rows still exist and every
   * surface that shows "your chats" must agree they are out of sight.
   *
   * Ordering stays `updated_at DESC` — the pinned split is a rendering
   * decision, and doing it here would make the one ordering the renderer's
   * relative timestamps agree with depend on pin state.
   */
  list(options: ListConversationsOptions = {}) {
    const conditions: string[] = [];

    if (!options.includeArchived) {
      conditions.push('c.archived_at IS NULL');
    }

    if (!options.includeSide) {
      conditions.push('c.side_of_conversation_id IS NULL');
    }

    const rows = this.db
      .prepare<[], ConversationSummaryRow>(
        `
          ${SUMMARY_SELECT}
          ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY c.updated_at DESC
        `
      )
      .all();

    return rows.map(mapConversationSummary);
  }

  /**
   * The side conversations hanging off one chat, newest first.
   *
   * The only way to reach them: they are absent from `list()` by construction,
   * so without a parent in hand there is nothing to ask.
   */
  listSideConversations(parentConversationId: string) {
    const rows = this.db
      .prepare<{ parentConversationId: string }, ConversationSummaryRow>(
        `
          ${SUMMARY_SELECT}
          WHERE c.side_of_conversation_id = @parentConversationId
          ORDER BY c.updated_at DESC
        `
      )
      .all({ parentConversationId });

    return rows.map(mapConversationSummary);
  }

  /**
   * Seed a new conversation with this one's history up to a message.
   *
   * The parent is read-only throughout. `kind: 'side'` produces the ephemeral
   * variant — same copy, but hidden from every listing and deleted with its
   * parent. See `conversationFork.ts` for what each table does and why.
   */
  fork(input: ForkConversationInput): ConversationSummary {
    const result = forkConversation(this.db, this.attachmentStore, input);
    return this.getSummary(result.conversationId)!;
  }

  /**
   * Search message bodies, not titles.
   *
   * Archived chats stay out of the results unless asked for, exactly as in
   * `list()` — a hit that opens a chat the user has archived would undo the
   * archiving from the one surface that is supposed to respect it.
   *
   * The index lives behind `MessageSearchRepo`, built lazily so a conversations
   * repo that never searches never touches it.
   */
  searchMessages(request: SearchMessagesRequest): MessageSearchHit[] {
    this.messageSearchRepo ??= new MessageSearchRepo(this.db);
    return this.messageSearchRepo.search(request);
  }

  /** One row in the same shape as `list`, archived or not. */
  getSummary(conversationId: string): ConversationSummary | null {
    const row = this.db
      .prepare<{ conversationId: string }, ConversationSummaryRow>(
        `
          ${SUMMARY_SELECT}
          WHERE c.id = @conversationId
        `
      )
      .get({ conversationId });

    return row ? mapConversationSummary(row) : null;
  }

  /**
   * `defaults` carry the user's working mode onto the new conversation the way
   * Codex-style clients do: mode and project follow you, so starting a second
   * thread on the same repo needs no setup. The caller supplies them because
   * the preference lives in settings, not here.
   */
  create(defaults: { workspaceMode?: WorkspaceMode; executionTarget?: ExecutionTarget; projectId?: string | null; toolPermissionMode?: ToolPermissionMode } = {}) {
    const now = new Date();
    const createdAt = now.toISOString();
    const id = randomUUID();
    const title = formatConversationTitle(now);
    const toolPermissionMode = defaults.toolPermissionMode ?? DEFAULT_TOOL_PERMISSION_MODE;

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
            execution_target,
            project_id,
            tool_permission_mode
          )
          VALUES (
            @id,
            @title,
            @createdAt,
            @updatedAt,
            NULL,
            NULL,
            @workspaceMode,
            @executionTarget,
            @projectId,
            @toolPermissionMode
          )
        `
      )
      .run({
        id,
        title,
        createdAt,
        updatedAt: createdAt,
        workspaceMode: defaults.workspaceMode ?? DEFAULT_WORKSPACE_MODE,
        executionTarget: defaults.executionTarget ?? DEFAULT_EXECUTION_TARGET,
        projectId: defaults.projectId ?? null,
        toolPermissionMode
      });

    return this.getSummary(id)!;
  }

  /**
   * S1: create a durable subagent child conversation.
   * The row is a normal conversation with provenance marker so
   * `list()` filters it via `side_of_conversation_id IS NOT NULL` but
   * `listSubagentChildren` can surface it for the catalog.
   */
  createSubagentConversation(input: {
    parentConversationId: string;
    title: string;
    delegationDepth: number;
    agentId: string;
    mode: 'one-shot' | 'continuable';
    parentTurnId?: string;
  }): string {
    const now = new Date().toISOString();
    const id = randomUUID();
    const title = (input.title || 'Subagent').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Subagent';

    this.db
      .prepare(
        `
          INSERT INTO conversations (
            id,
            title,
            created_at,
            updated_at,
            workspace_mode,
            execution_target,
            tool_permission_mode,
            origin,
            subagent_mode,
            subagent_label,
            delegation_depth,
            side_of_conversation_id
          )
          VALUES (
            @id,
            @title,
            @createdAt,
            @updatedAt,
            'work',
            'local',
            'ask',
            'subagent',
            @mode,
            @label,
            @depth,
            @parentId
          )
        `
      )
      .run({
        id,
        title,
        createdAt: now,
        updatedAt: now,
        mode: input.mode,
        label: title,
        depth: input.delegationDepth,
        parentId: input.parentConversationId,
      });

    return id;
  }

  /**
   * List direct subagent children of a parent conversation.
   * Used by the subagent catalog (S1+). Excludes archived? No — children
   * are hidden from main list anyway, so archiving parent is what matters.
   */
  listSubagentChildren(parentConversationId: string): Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    mode: 'one-shot' | 'continuable' | null;
    label: string | null;
    depth: number;
    parentId: string | null;
  }> {
    return this.db
      .prepare<{ parentConversationId: string }, {
        id: string;
        title: string;
        created_at: string;
        updated_at: string;
        subagent_mode: string | null;
        subagent_label: string | null;
        delegation_depth: number | null;
        side_of_conversation_id: string | null;
      }>(
        `
          SELECT id, title, created_at, updated_at, subagent_mode, subagent_label, delegation_depth, side_of_conversation_id
          FROM conversations
          WHERE origin = 'subagent' AND side_of_conversation_id = @parentConversationId
          ORDER BY created_at ASC
        `
      )
      .all({ parentConversationId })
      .map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        mode: (row.subagent_mode as 'one-shot' | 'continuable' | null) ?? null,
        label: row.subagent_label,
        depth: row.delegation_depth ?? 0,
        parentId: row.side_of_conversation_id,
      }));
  }

  /**
   * Has-children batched check for S4 optimization. Returns map parentId -> count.
   */
  countSubagentChildrenByParent(parentIds: string[]): Map<string, number> {
    if (parentIds.length === 0) return new Map();
    const placeholders = parentIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare<unknown[], { parentId: string; count: number }>(
        `SELECT side_of_conversation_id as parentId, COUNT(*) as count FROM conversations WHERE origin='subagent' AND side_of_conversation_id IN (${placeholders}) GROUP BY side_of_conversation_id`
      )
      .all(...parentIds) as Array<{ parentId: string; count: number }>;
    return new Map(rows.map((r) => [r.parentId, r.count]));
  }

  getSubagentMeta(childId: string): { parentId: string | null; mode: string | null; origin: string | null; depth: number | null; label: string | null } | null {
    const row = this.db
      .prepare<{ childId: string }, { side_of_conversation_id: string | null; subagent_mode: string | null; origin: string | null; delegation_depth: number | null; subagent_label: string | null }>(
        `SELECT side_of_conversation_id, subagent_mode, origin, delegation_depth, subagent_label FROM conversations WHERE id = @childId`
      )
      .get({ childId });
    if (!row) return null;
    return { parentId: row.side_of_conversation_id, mode: row.subagent_mode, origin: row.origin, depth: row.delegation_depth, label: row.subagent_label };
  }

  /**
   * Settled turn duration per conversation: sum of persisted assistant-turn
   * latencies. Batched for the catalog (same shape as
   * `countSubagentChildrenByParent`), so N children cost one query.
   */
  sumAssistantLatencyByConversation(conversationIds: string[]): Map<string, number> {
    if (conversationIds.length === 0) return new Map();
    const placeholders = conversationIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare<unknown[], { conversation_id: string; total: number | null }>(
        `SELECT conversation_id, SUM(latency_ms) as total FROM messages WHERE role='assistant' AND latency_ms IS NOT NULL AND conversation_id IN (${placeholders}) GROUP BY conversation_id`
      )
      .all(...conversationIds) as Array<{ conversation_id: string; total: number | null }>;
    return new Map(rows.map((r) => [r.conversation_id, r.total ?? 0]));
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

    return this.getSummary(conversationId)!;
  }

  /**
   * Pin or unpin. Like `rename`, this leaves `updated_at` alone: `updated_at`
   * is what the sidebar shows as "2 hours ago" and orders by, and a pin that
   * teleported the row to the top of history would be reporting activity that
   * never happened.
   *
   * Pinning an already-pinned conversation keeps the original timestamp, so a
   * redundant toggle cannot reshuffle the pinned section.
   */
  setPinned(conversationId: string, pinned: boolean): ConversationSummary {
    const result = this.db
      .prepare(
        `
          UPDATE conversations
          SET pinned_at = CASE WHEN @pinned = 1 THEN COALESCE(pinned_at, @now) ELSE NULL END
          WHERE id = @conversationId
        `
      )
      .run({ conversationId, pinned: pinned ? 1 : 0, now: new Date().toISOString() });

    if (result.changes === 0) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    return this.getSummary(conversationId)!;
  }

  /**
   * Archive or restore. Archiving hides the chat from `list()` without
   * destroying anything — messages, attachments and file changes are untouched,
   * which is the whole reason archive exists instead of delete.
   *
   * `updated_at` is left alone for the same reason as `setPinned`: a restored
   * chat must come back where it was, not at the top.
   */
  setArchived(conversationId: string, archived: boolean): ConversationSummary {
    const result = this.db
      .prepare(
        `
          UPDATE conversations
          SET archived_at = CASE WHEN @archived = 1 THEN COALESCE(archived_at, @now) ELSE NULL END
          WHERE id = @conversationId
        `
      )
      .run({ conversationId, archived: archived ? 1 : 0, now: new Date().toISOString() });

    if (result.changes === 0) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    return this.getSummary(conversationId)!;
  }

  /** The mode, execution target, worktree, and project a turn should run under. Never taken from the renderer. */
  getWorkspace(conversationId: string): {
    mode: WorkspaceMode;
    executionTarget: ExecutionTarget;
    projectId: string | null;
    worktreeRoot: string | null;
  } {
    const row = this.db
      .prepare<{ conversationId: string }, { workspace_mode: string | null; execution_target: string | null; project_id: string | null; worktree_root: string | null }>(
        `
          SELECT workspace_mode, execution_target, project_id, worktree_root
          FROM conversations
          WHERE id = @conversationId
        `
      )
      .get({ conversationId });

    return {
      mode: normalizeWorkspaceMode(row?.workspace_mode),
      executionTarget: normalizeExecutionTarget(row?.execution_target),
      projectId: row?.project_id ?? null,
      worktreeRoot: row?.worktree_root ?? null
    };
  }

  /**
   * Set any part of the workspace. Like `rename`, this does not bump
   * `updated_at`: switching mode is not conversation activity and must not
   * reorder the sidebar.
   */
  setWorkspace(
    conversationId: string,
    patch: { mode?: WorkspaceMode; executionTarget?: ExecutionTarget; projectId?: string | null; worktreeRoot?: string | null }
  ): { mode: WorkspaceMode; executionTarget: ExecutionTarget; projectId: string | null; worktreeRoot: string | null } {
    const current = this.getWorkspace(conversationId);
    const mode = patch.mode ?? current.mode;
    const executionTarget = patch.executionTarget ?? current.executionTarget;
    const projectId = patch.projectId === undefined ? current.projectId : patch.projectId;
    const worktreeRoot = patch.worktreeRoot === undefined ? current.worktreeRoot : patch.worktreeRoot;

    const result = this.db
      .prepare(
        `
          UPDATE conversations
          SET workspace_mode = @mode, execution_target = @executionTarget, project_id = @projectId, worktree_root = @worktreeRoot
          WHERE id = @conversationId
        `
      )
      .run({ conversationId, mode, executionTarget, projectId, worktreeRoot });

    if (result.changes === 0) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    return { mode, executionTarget, projectId, worktreeRoot };
  }

  /**
   * Reset workspace fields for all conversations referencing a project being detached.
   */
  resetWorkspaceForProject(projectId: string): Array<{ conversationId: string; worktreeRoot: string | null }> {
    const rows = this.db
      .prepare<{ projectId: string }, { id: string; worktree_root: string | null }>(
        'SELECT id, worktree_root FROM conversations WHERE project_id = @projectId'
      )
      .all({ projectId });

    if (rows.length > 0) {
      this.db
        .prepare(
          `
            UPDATE conversations
            SET project_id = NULL, worktree_root = NULL, execution_target = 'local'
            WHERE project_id = @projectId
          `
        )
        .run({ projectId });
    }

    return rows.map((r) => ({ conversationId: r.id, worktreeRoot: r.worktree_root }));
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
            project_id,
            pinned_at,
            archived_at,
            side_of_conversation_id,
            origin,
            subagent_mode,
            subagent_label,
            delegation_depth
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
        projectId: conversation.project_id,
        pinnedAt: conversation.pinned_at,
        archivedAt: conversation.archived_at,
        sideOfConversationId: (conversation as any).side_of_conversation_id ?? null,
        origin: (conversation as any).origin ?? null,
        subagentMode: (conversation as any).subagent_mode ?? null,
        subagentLabel: (conversation as any).subagent_label ?? null,
        delegationDepth: (conversation as any).delegation_depth ?? null
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
            project_id,
            pinned_at,
            archived_at
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
        projectId: conversation.project_id,
        pinnedAt: conversation.pinned_at,
        archivedAt: conversation.archived_at
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

  /**
   * Whether the conversation's most recent assistant turn rendered a visual.
   *
   * Read by the visual gate so a follow-up like "make it wider" stays attached
   * to the diagram it is about. Only the last assistant message counts: a chart
   * from twenty turns ago says nothing about the current question.
   */
  hasRecentVisual(conversationId: string): boolean {
    const row = this.db
      .prepare<{ conversationId: string }, Pick<MessageRow, 'parts_json'>>(
        `
          SELECT parts_json
          FROM messages
          WHERE conversation_id = @conversationId
            AND role = 'assistant'
            AND status = 'complete'
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get({ conversationId });

    if (!row?.parts_json) {
      return false;
    }

    const parts = parseJson<ChatMessagePart[]>(row.parts_json);
    return Array.isArray(parts) && parts.some((part) => part?.type === 'visual');
  }

  getModelHistory(conversationId: string) {
    const rows = this.db
      .prepare<
        { conversationId: string },
        Pick<MessageRow, 'role' | 'content' | 'parts_json' | 'response_messages_json' | 'status' | 'error_code'>
      >(
        `
          SELECT
            role,
            content,
            parts_json,
            response_messages_json,
            status,
            error_code
          FROM messages
          WHERE conversation_id = @conversationId
            AND (
              status = 'complete'
              OR (
                role = 'assistant'
                AND status = 'error'
                AND error_code IN ('aborted', 'interrupted')
              )
            )
          ORDER BY created_at ASC
        `
      )
      .all({ conversationId });

    const history: ModelMessage[] = [];

    for (const row of rows) {
      const responseMessages = parseJson<ModelMessage[]>(row.response_messages_json);
      const parts = parseJson<ChatMessagePart[]>(row.parts_json);
      const isInterruptedPartial =
        row.role === 'assistant' && row.status === 'error';

      if (isInterruptedPartial) {
        // A turn that stopped mid-stream still said things worth remembering:
        // dropping the delivered prefix made the model restate work it had
        // already done. Rebuild from parts only — response_messages_json is
        // deliberately ignored, because an interrupted turn can hold tool
        // calls with no results, and replaying those would hand the provider
        // a request it must reject.
        const text = (parts ?? [])
          .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
          .map((part) => part.text)
          .join('\n\n')
          .trim();

        if (text) {
          history.push({ role: 'assistant', content: text });
        }
        continue;
      }

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

  updateStatus(
    id: string,
    input: {
      status: import('../../../shared/contracts').ConversationStatus;
      lastError?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    }
  ) {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE conversations
         SET status = @status,
             last_error = @lastError,
             started_at = COALESCE(@startedAt, started_at),
             completed_at = COALESCE(@completedAt, completed_at),
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        status: input.status,
        lastError: input.lastError ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        updatedAt
      });
  }

  getToolPermissionMode(conversationId: string): ToolPermissionMode {
    const row = this.db
      .prepare<{ conversationId: string }, { tool_permission_mode: string | null }>(
        `SELECT tool_permission_mode FROM conversations WHERE id = @conversationId`
      )
      .get({ conversationId });

    return isToolPermissionMode(row?.tool_permission_mode)
      ? row.tool_permission_mode
      : DEFAULT_TOOL_PERMISSION_MODE;
  }

  setToolPermissionMode(conversationId: string, mode: ToolPermissionMode): ToolPermissionMode {
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET tool_permission_mode = @mode, updated_at = @updatedAt
         WHERE id = @conversationId`
      )
      .run({ conversationId, mode, updatedAt: new Date().toISOString() });

    if (result.changes === 0) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    return mode;
  }

  /**
   * Whether this conversation opted into the Sites toolset. Sticky on purpose:
   * once the tools are in the catalog they stay there, so the tool list does
   * not churn between turns and the provider's prompt cache survives.
   */
  getSiteOptIn(conversationId: string): boolean {
    const row = this.db
      .prepare<{ conversationId: string }, { sites_opt_in: number | null }>(
        `SELECT sites_opt_in FROM conversations WHERE id = @conversationId`
      )
      .get({ conversationId });

    return Boolean(row?.sites_opt_in);
  }

  setSiteOptIn(conversationId: string, optedIn: boolean): void {
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET sites_opt_in = @optedIn, updated_at = @updatedAt
         WHERE id = @conversationId`
      )
      .run({ conversationId, optedIn: optedIn ? 1 : 0, updatedAt: new Date().toISOString() });

    if (result.changes === 0) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }
  }
}
