import type { ToolExecutionRecord, ToolExecutionState } from '../../../shared/contracts';
import type { SqliteDatabase } from '../client';

type ToolExecutionRow = {
  id: string;
  conversation_id: string;
  message_id: string;
  request_id: string;
  tool_name: string;
  input_preview: string | null;
  input_json: string | null;
  state: ToolExecutionState;
  started_at: string | null;
  finished_at: string | null;
  partial_output_preview: string | null;
  final_output_preview: string | null;
  output_json: string | null;
  error_code: string | null;
  error_message: string | null;
  requires_approval: number;
  approval_id: string | null;
  approved_at: string | null;
  denied_at: string | null;
  approval_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SaveToolExecutionInput = {
  id: string;
  conversationId: string;
  messageId: string;
  requestId: string;
  toolName: string;
  state: ToolExecutionState;
  inputPreview?: string | null;
  inputJson?: unknown;
  startedAt?: string | null;
  finishedAt?: string | null;
  partialOutputPreview?: string | null;
  finalOutputPreview?: string | null;
  outputJson?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  requiresApproval?: boolean;
  approvalId?: string | null;
  approvedAt?: string | null;
  deniedAt?: string | null;
  approvalReason?: string | null;
};

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

function mapRow(row: ToolExecutionRow): ToolExecutionRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    requestId: row.request_id,
    toolName: row.tool_name,
    inputPreview: row.input_preview,
    state: row.state,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    partialOutputPreview: row.partial_output_preview,
    finalOutputPreview: row.final_output_preview,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    requiresApproval: Boolean(row.requires_approval),
    approvalId: row.approval_id,
    approvedAt: row.approved_at,
    deniedAt: row.denied_at,
    approvalReason: row.approval_reason,
  };
}

export class ToolExecutionsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string) {
    const row = this.db
      .prepare<{ id: string }, ToolExecutionRow>(
        `
          SELECT
            id,
            conversation_id,
            message_id,
            request_id,
            tool_name,
            input_preview,
            input_json,
            state,
            started_at,
            finished_at,
            partial_output_preview,
            final_output_preview,
            output_json,
            error_code,
            error_message,
            requires_approval,
            approval_id,
            approved_at,
            denied_at,
            approval_reason,
            created_at,
            updated_at
          FROM tool_executions
          WHERE id = @id
        `,
      )
      .get({ id });

    return row ? mapRow(row) : null;
  }

  getPendingApproval(requestId: string, approvalId: string) {
    const row = this.db
      .prepare<{ requestId: string; approvalId: string }, ToolExecutionRow>(
        `
          SELECT
            id,
            conversation_id,
            message_id,
            request_id,
            tool_name,
            input_preview,
            input_json,
            state,
            started_at,
            finished_at,
            partial_output_preview,
            final_output_preview,
            output_json,
            error_code,
            error_message,
            requires_approval,
            approval_id,
            approved_at,
            denied_at,
            approval_reason,
            created_at,
            updated_at
          FROM tool_executions
          WHERE request_id = @requestId
            AND approval_id = @approvalId
          LIMIT 1
        `,
      )
      .get({ requestId, approvalId });

    return row ? mapRow(row) : null;
  }

  listByMessageIds(messageIds: string[]) {
    if (messageIds.length === 0) {
      return [];
    }

    const placeholders = messageIds.map(() => '?').join(', ');
    const statement = this.db.prepare<unknown[], ToolExecutionRow>(
      `
        SELECT
          id,
          conversation_id,
          message_id,
          request_id,
          tool_name,
          input_preview,
          input_json,
          state,
          started_at,
          finished_at,
          partial_output_preview,
          final_output_preview,
          output_json,
          error_code,
          error_message,
          requires_approval,
          approval_id,
          approved_at,
          denied_at,
          approval_reason,
          created_at,
          updated_at
        FROM tool_executions
        WHERE message_id IN (${placeholders})
        ORDER BY COALESCE(started_at, created_at) ASC, id ASC
      `,
    );

    return statement.all(...messageIds).map(mapRow);
  }

  save(input: SaveToolExecutionInput) {
    const existing = this.db
      .prepare<{ id: string }, ToolExecutionRow>(
        `
          SELECT
            id,
            conversation_id,
            message_id,
            request_id,
            tool_name,
            input_preview,
            input_json,
            state,
            started_at,
            finished_at,
            partial_output_preview,
            final_output_preview,
            output_json,
            error_code,
            error_message,
            requires_approval,
            approval_id,
            approved_at,
            denied_at,
            approval_reason,
            created_at,
            updated_at
          FROM tool_executions
          WHERE id = @id
        `,
      )
      .get({ id: input.id });

    const now = new Date().toISOString();

    const row = {
      id: input.id,
      conversationId: existing?.conversation_id ?? input.conversationId,
      messageId: existing?.message_id ?? input.messageId,
      requestId: existing?.request_id ?? input.requestId,
      toolName: existing?.tool_name ?? input.toolName,
      inputPreview: input.inputPreview ?? existing?.input_preview ?? null,
      inputJson: input.inputJson !== undefined
        ? JSON.stringify(input.inputJson)
        : (existing?.input_json ?? null),
      state: input.state,
      startedAt: input.startedAt ?? existing?.started_at ?? null,
      finishedAt: input.finishedAt ?? existing?.finished_at ?? null,
      partialOutputPreview: input.partialOutputPreview ?? existing?.partial_output_preview ?? null,
      finalOutputPreview: input.finalOutputPreview ?? existing?.final_output_preview ?? null,
      outputJson: input.outputJson !== undefined
        ? JSON.stringify(input.outputJson)
        : (existing?.output_json ?? null),
      errorCode: input.errorCode ?? existing?.error_code ?? null,
      errorMessage: input.errorMessage ?? existing?.error_message ?? null,
      requiresApproval:
        input.requiresApproval != null ? (input.requiresApproval ? 1 : 0) : (existing?.requires_approval ?? 0),
      approvalId: input.approvalId ?? existing?.approval_id ?? null,
      approvedAt: input.approvedAt ?? existing?.approved_at ?? null,
      deniedAt: input.deniedAt ?? existing?.denied_at ?? null,
      approvalReason: input.approvalReason ?? existing?.approval_reason ?? null,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `
          INSERT INTO tool_executions (
            id,
            conversation_id,
            message_id,
            request_id,
            tool_name,
            input_preview,
            input_json,
            state,
            started_at,
            finished_at,
            partial_output_preview,
            final_output_preview,
            output_json,
            error_code,
            error_message,
            requires_approval,
            approval_id,
            approved_at,
            denied_at,
            approval_reason,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @conversationId,
            @messageId,
            @requestId,
            @toolName,
            @inputPreview,
            @inputJson,
            @state,
            @startedAt,
            @finishedAt,
            @partialOutputPreview,
            @finalOutputPreview,
            @outputJson,
            @errorCode,
            @errorMessage,
            @requiresApproval,
            @approvalId,
            @approvedAt,
            @deniedAt,
            @approvalReason,
            @createdAt,
            @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            conversation_id = excluded.conversation_id,
            message_id = excluded.message_id,
            request_id = excluded.request_id,
            tool_name = excluded.tool_name,
            input_preview = excluded.input_preview,
            input_json = excluded.input_json,
            state = excluded.state,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            partial_output_preview = excluded.partial_output_preview,
            final_output_preview = excluded.final_output_preview,
            output_json = excluded.output_json,
            error_code = excluded.error_code,
            error_message = excluded.error_message,
            requires_approval = excluded.requires_approval,
            approval_id = excluded.approval_id,
            approved_at = excluded.approved_at,
            denied_at = excluded.denied_at,
            approval_reason = excluded.approval_reason,
            updated_at = excluded.updated_at
        `,
      )
      .run(row);
  }

  markRequestExecutionsErrored(requestId: string, errorCode: string, errorMessage: string) {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE tool_executions
          SET state = 'error',
              error_code = @errorCode,
              error_message = @errorMessage,
              finished_at = COALESCE(finished_at, @finishedAt),
              updated_at = @updatedAt
          WHERE request_id = @requestId
            AND state IN ('queued', 'running', 'approval_requested', 'approved', 'partial')
        `,
      )
      .run({
        requestId,
        errorCode,
        errorMessage,
        finishedAt: now,
        updatedAt: now,
      });
  }

  reconcileActiveExecutions() {
    const now = new Date().toISOString();
    const messageRows = this.db
      .prepare<[], { message_id: string }>(
        `
          SELECT DISTINCT message_id
          FROM tool_executions
          WHERE state IN ('queued', 'running', 'approval_requested', 'approved', 'partial')
        `,
      )
      .all();

    this.db
      .prepare(
        `
          UPDATE tool_executions
          SET state = 'error',
              error_code = 'interrupted',
              error_message = 'Tool execution was interrupted because the app restarted.',
              finished_at = COALESCE(finished_at, @finishedAt),
              updated_at = @updatedAt
          WHERE state IN ('queued', 'running', 'approval_requested', 'approved', 'partial')
        `,
      )
      .run({ finishedAt: now, updatedAt: now });

    return messageRows.map((row) => row.message_id);
  }

  getJsonPayloadsById(id: string) {
    const row = this.db
      .prepare<{ id: string }, Pick<ToolExecutionRow, 'input_json' | 'output_json'>>(
        'SELECT input_json, output_json FROM tool_executions WHERE id = @id',
      )
      .get({ id });

    return {
      input: parseJson<unknown>(row?.input_json ?? null),
      output: parseJson<unknown>(row?.output_json ?? null),
    };
  }
}
