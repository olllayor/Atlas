import { randomUUID } from 'node:crypto';

import type {
  ApprovalDecision,
  ApprovalRequestRecord,
  RecoverEventsResponse,
  RuntimeCheckpointSummary,
  RuntimeEventEnvelope,
  RuntimeProviderSession,
  WorkLogEntry,
} from '../../../shared/contracts';
import { deriveWorkLogEntry, getWorkLogEntryId } from '../../../shared/runtimeActivity';
import type { SqliteDatabase } from '../client';

type RuntimeEventRow = {
  event_id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
  sequence: number;
  occurred_at: string;
  activity_type: RuntimeEventEnvelope['activityType'];
  tone: RuntimeEventEnvelope['tone'];
  tool_type: RuntimeEventEnvelope['toolType'];
  message_id: string | null;
  tool_call_id: string | null;
  approval_id: string | null;
  provider_id: RuntimeEventEnvelope['provider'];
  provider_event_type: string | null;
  payload_json: string;
};

type WorkLogRow = {
  id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
  message_id: string | null;
  activity_type: WorkLogEntry['activityType'];
  tone: WorkLogEntry['tone'];
  tool_type: WorkLogEntry['toolType'];
  tool_call_id: string | null;
  approval_id: string | null;
  title: string;
  summary: string | null;
  status: WorkLogEntry['status'];
  sequence: number;
  is_final: number;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalRow = {
  id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
  message_id: string | null;
  tool_call_id: string;
  tool_name: string | null;
  tool_type: ApprovalRequestRecord['toolType'];
  reason: string | null;
  status: ApprovalRequestRecord['status'];
  decision: ApprovalDecision | null;
  session_scope_key: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderSessionRow = {
  id: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
  provider_id: RuntimeProviderSession['providerId'];
  model_id: string;
  status: RuntimeProviderSession['status'];
  last_sequence: number;
  created_at: string;
  updated_at: string;
};

type CheckpointRow = {
  id: string;
  conversation_id: string;
  turn_id: string;
  sequence: number;
  message_sequence: number;
  activity_sequence: number;
  pending_approvals_json: string;
  file_change_summary: string | null;
  created_at: string;
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

function mapEvent(row: RuntimeEventRow): RuntimeEventEnvelope {
  return {
    eventId: row.event_id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    requestId: row.request_id,
    sequence: row.sequence,
    occurredAt: row.occurred_at,
    activityType: row.activity_type,
    tone: row.tone,
    toolType: row.tool_type,
    messageId: row.message_id,
    toolCallId: row.tool_call_id,
    approvalId: row.approval_id,
    provider: row.provider_id,
    providerEventType: row.provider_event_type,
    payload: parseJson<Record<string, unknown>>(row.payload_json) ?? {},
  };
}

function mapWorkLog(row: WorkLogRow): WorkLogEntry {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    requestId: row.request_id,
    messageId: row.message_id,
    activityType: row.activity_type,
    tone: row.tone,
    toolType: row.tool_type,
    toolCallId: row.tool_call_id,
    approvalId: row.approval_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    sequence: row.sequence,
    isFinal: Boolean(row.is_final),
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApproval(row: ApprovalRow): ApprovalRequestRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    requestId: row.request_id,
    messageId: row.message_id,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    toolType: row.tool_type,
    reason: row.reason,
    status: row.status,
    decision: row.decision,
    sessionScopeKey: row.session_scope_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProviderSession(row: ProviderSessionRow): RuntimeProviderSession {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    requestId: row.request_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    lastSequence: row.last_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCheckpoint(row: CheckpointRow): RuntimeCheckpointSummary {
  const pendingApprovals = parseJson<unknown[]>(row.pending_approvals_json) ?? [];
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    sequence: row.sequence,
    pendingApprovalCount: pendingApprovals.length,
    fileChangeSummary: row.file_change_summary,
    createdAt: row.created_at,
  };
}

export type CreateTurnInput = {
  id: string;
  conversationId: string;
  requestId: string;
  assistantMessageId: string;
  providerId: RuntimeProviderSession['providerId'];
  modelId: string;
  startedSequence?: number;
};

export type StartProviderSessionInput = {
  id?: string;
  conversationId: string;
  turnId: string;
  requestId: string;
  providerId: RuntimeProviderSession['providerId'];
  modelId: string;
};

export type RecordRuntimeEventInput = Omit<RuntimeEventEnvelope, 'sequence' | 'occurredAt'> & {
  occurredAt?: string;
};

export class RuntimeStateRepo {
  constructor(private readonly db: SqliteDatabase) {}

  getLastSequence(conversationId: string) {
    const row = this.db
      .prepare<{ conversationId: string }, { sequence: number | null }>(
        'SELECT MAX(sequence) AS sequence FROM conversation_events WHERE conversation_id = @conversationId',
      )
      .get({ conversationId });

    return row?.sequence ?? 0;
  }

  createTurn(input: CreateTurnInput) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO conversation_turns (
            id,
            conversation_id,
            request_id,
            assistant_message_id,
            provider_id,
            model_id,
            status,
            started_sequence,
            completed_sequence,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @conversationId,
            @requestId,
            @assistantMessageId,
            @providerId,
            @modelId,
            'running',
            @startedSequence,
            NULL,
            @createdAt,
            @updatedAt
          )
        `,
      )
      .run({
        ...input,
        startedSequence: input.startedSequence ?? 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  completeTurn(turnId: string, completedSequence: number, status: 'completed' | 'awaiting_approval' | 'aborted' | 'interrupted') {
    this.db
      .prepare(
        `
          UPDATE conversation_turns
          SET status = @status,
              completed_sequence = @completedSequence,
              updated_at = @updatedAt
          WHERE id = @turnId
        `,
      )
      .run({
        turnId,
        status,
        completedSequence,
        updatedAt: new Date().toISOString(),
      });
  }

  startProviderSession(input: StartProviderSessionInput) {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `
          INSERT INTO provider_sessions (
            id,
            conversation_id,
            turn_id,
            request_id,
            provider_id,
            model_id,
            status,
            last_sequence,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @conversationId,
            @turnId,
            @requestId,
            @providerId,
            @modelId,
            'active',
            0,
            @createdAt,
            @updatedAt
          )
          ON CONFLICT(request_id) DO UPDATE SET
            status = 'active',
            updated_at = excluded.updated_at
        `,
      )
      .run({
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
      });

    return id;
  }

  updateProviderSession(requestId: string, patch: { status?: RuntimeProviderSession['status']; lastSequence?: number }) {
    this.db
      .prepare(
        `
          UPDATE provider_sessions
          SET status = COALESCE(@status, status),
              last_sequence = COALESCE(@lastSequence, last_sequence),
              updated_at = @updatedAt
          WHERE request_id = @requestId
        `,
      )
      .run({
        requestId,
        status: patch.status ?? null,
        lastSequence: patch.lastSequence ?? null,
        updatedAt: new Date().toISOString(),
      });
  }

  getProviderSessionByRequest(requestId: string) {
    const row = this.db
      .prepare<{ requestId: string }, ProviderSessionRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            request_id,
            provider_id,
            model_id,
            status,
            last_sequence,
            created_at,
            updated_at
          FROM provider_sessions
          WHERE request_id = @requestId
          LIMIT 1
        `,
      )
      .get({ requestId });

    return row ? mapProviderSession(row) : null;
  }

  getLatestProviderSession(conversationId: string) {
    const row = this.db
      .prepare<{ conversationId: string }, ProviderSessionRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            request_id,
            provider_id,
            model_id,
            status,
            last_sequence,
            created_at,
            updated_at
          FROM provider_sessions
          WHERE conversation_id = @conversationId
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      )
      .get({ conversationId });

    return row ? mapProviderSession(row) : null;
  }

  recordEvent(input: RecordRuntimeEventInput) {
    const transaction = this.db.transaction((nextInput: RecordRuntimeEventInput) => {
      const now = nextInput.occurredAt ?? new Date().toISOString();
      const nextSequence = this.getLastSequence(nextInput.conversationId) + 1;
      const envelope: RuntimeEventEnvelope = {
        ...nextInput,
        occurredAt: now,
        sequence: nextSequence,
      };

      this.db
        .prepare(
          `
            INSERT INTO conversation_events (
              event_id,
              conversation_id,
              turn_id,
              request_id,
              sequence,
              occurred_at,
              activity_type,
              tone,
              tool_type,
              message_id,
              tool_call_id,
              approval_id,
              provider_id,
              provider_event_type,
              payload_json
            )
            VALUES (
              @eventId,
              @conversationId,
              @turnId,
              @requestId,
              @sequence,
              @occurredAt,
              @activityType,
              @tone,
              @toolType,
              @messageId,
              @toolCallId,
              @approvalId,
              @provider,
              @providerEventType,
              @payloadJson
            )
          `,
        )
        .run({
          eventId: envelope.eventId,
          conversationId: envelope.conversationId,
          turnId: envelope.turnId,
          requestId: envelope.requestId,
          sequence: envelope.sequence,
          occurredAt: envelope.occurredAt,
          activityType: envelope.activityType,
          tone: envelope.tone,
          toolType: envelope.toolType ?? null,
          messageId: envelope.messageId ?? null,
          toolCallId: envelope.toolCallId ?? null,
          approvalId: envelope.approvalId ?? null,
          provider: envelope.provider,
          providerEventType: envelope.providerEventType ?? null,
          payloadJson: JSON.stringify(envelope.payload ?? {}),
        });

      this.projectEvent(envelope);
      this.updateProviderSession(envelope.requestId, { lastSequence: envelope.sequence });
      return envelope;
    });

    return transaction(input);
  }

  private projectEvent(event: RuntimeEventEnvelope) {
    const workLogId = getWorkLogEntryId(event);
    const existingActivity = this.getActivityById(workLogId);
    const nextActivity = deriveWorkLogEntry(existingActivity, event);

    if (nextActivity) {
      this.db
        .prepare(
          `
            INSERT INTO conversation_activities (
              id,
              conversation_id,
              turn_id,
              request_id,
              message_id,
              activity_type,
              tone,
              tool_type,
              tool_call_id,
              approval_id,
              title,
              summary,
              status,
              sequence,
              is_final,
              payload_json,
              created_at,
              updated_at
            )
            VALUES (
              @id,
              @conversationId,
              @turnId,
              @requestId,
              @messageId,
              @activityType,
              @tone,
              @toolType,
              @toolCallId,
              @approvalId,
              @title,
              @summary,
              @status,
              @sequence,
              @isFinal,
              @payloadJson,
              @createdAt,
              @updatedAt
            )
            ON CONFLICT(id) DO UPDATE SET
              message_id = excluded.message_id,
              activity_type = excluded.activity_type,
              tone = excluded.tone,
              tool_type = excluded.tool_type,
              tool_call_id = excluded.tool_call_id,
              approval_id = excluded.approval_id,
              title = excluded.title,
              summary = excluded.summary,
              status = excluded.status,
              sequence = excluded.sequence,
              is_final = excluded.is_final,
              payload_json = excluded.payload_json,
              updated_at = excluded.updated_at
          `,
        )
        .run({
          id: nextActivity.id,
          conversationId: nextActivity.conversationId,
          turnId: nextActivity.turnId,
          requestId: nextActivity.requestId,
          messageId: nextActivity.messageId,
          activityType: nextActivity.activityType,
          tone: nextActivity.tone,
          toolType: nextActivity.toolType,
          toolCallId: nextActivity.toolCallId,
          approvalId: nextActivity.approvalId,
          title: nextActivity.title,
          summary: nextActivity.summary,
          status: nextActivity.status,
          sequence: nextActivity.sequence,
          isFinal: nextActivity.isFinal ? 1 : 0,
          payloadJson: nextActivity.payload ? JSON.stringify(nextActivity.payload) : null,
          createdAt: nextActivity.createdAt,
          updatedAt: nextActivity.updatedAt,
        });
    }

    if (event.activityType === 'approval.requested') {
      this.upsertApproval({
        id: event.approvalId ?? randomUUID(),
        conversationId: event.conversationId,
        turnId: event.turnId,
        requestId: event.requestId,
        messageId: event.messageId ?? null,
        toolCallId: event.toolCallId ?? event.eventId,
        toolName: typeof event.payload.toolName === 'string' ? event.payload.toolName : null,
        toolType: event.toolType ?? null,
        reason: typeof event.payload.reason === 'string' ? event.payload.reason : null,
        status: 'pending',
        decision: null,
        sessionScopeKey: null,
      });
    }

    if (event.activityType === 'approval.resolved' && event.approvalId) {
      this.resolveApproval(
        event.approvalId,
        (event.payload.decision as ApprovalDecision | null) ?? 'cancel',
        typeof event.payload.sessionScopeKey === 'string' ? event.payload.sessionScopeKey : null,
      );
    }
  }

  private upsertApproval(input: Omit<ApprovalRequestRecord, 'createdAt' | 'updatedAt'>) {
    const existing = this.getApprovalById(input.id);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO approval_requests (
            id,
            conversation_id,
            turn_id,
            request_id,
            message_id,
            tool_call_id,
            tool_name,
            tool_type,
            reason,
            status,
            decision,
            session_scope_key,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @conversationId,
            @turnId,
            @requestId,
            @messageId,
            @toolCallId,
            @toolName,
            @toolType,
            @reason,
            @status,
            @decision,
            @sessionScopeKey,
            @createdAt,
            @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            decision = excluded.decision,
            session_scope_key = excluded.session_scope_key,
            reason = excluded.reason,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision, sessionScopeKey: string | null) {
    this.db
      .prepare(
        `
          UPDATE approval_requests
          SET status = 'resolved',
              decision = @decision,
              session_scope_key = @sessionScopeKey,
              updated_at = @updatedAt
          WHERE id = @approvalId
        `,
      )
      .run({
        approvalId,
        decision,
        sessionScopeKey,
        updatedAt: new Date().toISOString(),
      });
  }

  markPendingApprovalsStaleForRequest(requestId: string) {
    this.db
      .prepare(
        `
          UPDATE approval_requests
          SET status = 'stale',
              updated_at = @updatedAt
          WHERE request_id = @requestId
            AND status = 'pending'
        `,
      )
      .run({
        requestId,
        updatedAt: new Date().toISOString(),
      });
  }

  getApprovalById(approvalId: string) {
    const row = this.db
      .prepare<{ approvalId: string }, ApprovalRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            request_id,
            message_id,
            tool_call_id,
            tool_name,
            tool_type,
            reason,
            status,
            decision,
            session_scope_key,
            created_at,
            updated_at
          FROM approval_requests
          WHERE id = @approvalId
          LIMIT 1
        `,
      )
      .get({ approvalId });

    return row ? mapApproval(row) : null;
  }

  listPendingApprovals(conversationId: string) {
    return this.db
      .prepare<{ conversationId: string }, ApprovalRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            request_id,
            message_id,
            tool_call_id,
            tool_name,
            tool_type,
            reason,
            status,
            decision,
            session_scope_key,
            created_at,
            updated_at
          FROM approval_requests
          WHERE conversation_id = @conversationId
            AND status = 'pending'
          ORDER BY created_at ASC
        `,
      )
      .all({ conversationId })
      .map(mapApproval);
  }

  getActivityById(id: string) {
    const row = this.db
      .prepare<{ id: string }, WorkLogRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            request_id,
            message_id,
            activity_type,
            tone,
            tool_type,
            tool_call_id,
            approval_id,
            title,
            summary,
            status,
            sequence,
            is_final,
            payload_json,
            created_at,
            updated_at
          FROM conversation_activities
          WHERE id = @id
          LIMIT 1
        `,
      )
      .get({ id });

    return row ? mapWorkLog(row) : null;
  }

  listActivitiesByConversation(conversationId: string) {
    return this.db
      .prepare<{ conversationId: string }, WorkLogRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            request_id,
            message_id,
            activity_type,
            tone,
            tool_type,
            tool_call_id,
            approval_id,
            title,
            summary,
            status,
            sequence,
            is_final,
            payload_json,
            created_at,
            updated_at
          FROM conversation_activities
          WHERE conversation_id = @conversationId
          ORDER BY sequence ASC
        `,
      )
      .all({ conversationId })
      .map(mapWorkLog);
  }

  listActivitiesByMessageIds(messageIds: string[]) {
    if (messageIds.length === 0) {
      return [];
    }

    const placeholders = messageIds.map(() => '?').join(', ');
    return this.db
      .prepare<unknown[], WorkLogRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            request_id,
            message_id,
            activity_type,
            tone,
            tool_type,
            tool_call_id,
            approval_id,
            title,
            summary,
            status,
            sequence,
            is_final,
            payload_json,
            created_at,
            updated_at
          FROM conversation_activities
          WHERE message_id IN (${placeholders})
          ORDER BY sequence ASC
        `,
      )
      .all(...messageIds)
      .map(mapWorkLog);
  }

  listEventsAfter(conversationId: string, afterSequence: number): RecoverEventsResponse {
    const rows = this.db
      .prepare<{ conversationId: string; afterSequence: number }, RuntimeEventRow>(
        `
          SELECT
            event_id,
            conversation_id,
            turn_id,
            request_id,
            sequence,
            occurred_at,
            activity_type,
            tone,
            tool_type,
            message_id,
            tool_call_id,
            approval_id,
            provider_id,
            provider_event_type,
            payload_json
          FROM conversation_events
          WHERE conversation_id = @conversationId
            AND sequence > @afterSequence
          ORDER BY sequence ASC
        `,
      )
      .all({ conversationId, afterSequence });

    return {
      conversationId,
      events: rows.map(mapEvent),
      lastSequence: rows.at(-1)?.sequence ?? this.getLastSequence(conversationId),
    };
  }

  getLatestCheckpoint(conversationId: string) {
    const row = this.db
      .prepare<{ conversationId: string }, CheckpointRow>(
        `
          SELECT
            id,
            conversation_id,
            turn_id,
            sequence,
            message_sequence,
            activity_sequence,
            pending_approvals_json,
            file_change_summary,
            created_at
          FROM conversation_checkpoints
          WHERE conversation_id = @conversationId
          ORDER BY sequence DESC
          LIMIT 1
        `,
      )
      .get({ conversationId });

    return row ? mapCheckpoint(row) : null;
  }

  createCheckpoint(input: {
    conversationId: string;
    turnId: string;
    sequence: number;
    pendingApprovals: ApprovalRequestRecord[];
    fileChangeSummary?: string | null;
  }) {
    const id = randomUUID();
    this.db
      .prepare(
        `
          INSERT INTO conversation_checkpoints (
            id,
            conversation_id,
            turn_id,
            sequence,
            message_sequence,
            activity_sequence,
            pending_approvals_json,
            file_change_summary,
            created_at
          )
          VALUES (
            @id,
            @conversationId,
            @turnId,
            @sequence,
            @messageSequence,
            @activitySequence,
            @pendingApprovalsJson,
            @fileChangeSummary,
            @createdAt
          )
        `,
      )
      .run({
        id,
        conversationId: input.conversationId,
        turnId: input.turnId,
        sequence: input.sequence,
        messageSequence: input.sequence,
        activitySequence: input.sequence,
        pendingApprovalsJson: JSON.stringify(input.pendingApprovals),
        fileChangeSummary: input.fileChangeSummary ?? null,
        createdAt: new Date().toISOString(),
      });

    return id;
  }

  reconcileInterruptedSessions() {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare<[], { request_id: string; assistant_message_id: string }>(
        `
          SELECT ps.request_id, ct.assistant_message_id
          FROM provider_sessions ps
          JOIN conversation_turns ct ON ct.id = ps.turn_id
          WHERE ps.status = 'active'
        `,
      )
      .all();

    this.db
      .prepare(
        `
          UPDATE provider_sessions
          SET status = 'interrupted',
              updated_at = @updatedAt
          WHERE status = 'active'
        `,
      )
      .run({ updatedAt: now });

    this.db
      .prepare(
        `
          UPDATE conversation_turns
          SET status = 'interrupted',
              updated_at = @updatedAt
          WHERE status = 'running'
        `,
      )
      .run({ updatedAt: now });

    this.db
      .prepare(
        `
          UPDATE approval_requests
          SET status = 'stale',
              updated_at = @updatedAt
          WHERE status = 'pending'
        `,
      )
      .run({ updatedAt: now });

    return rows.map((row) => ({ requestId: row.request_id, assistantMessageId: row.assistant_message_id }));
  }
}
