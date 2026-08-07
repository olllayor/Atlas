import type { PluginAuditRecord } from '../../../shared/pluginAudit';
import type { SqliteDatabase } from '../client';

/**
 * Durable storage for `plugin_audit_records`.
 *
 * The whole reason this exists rather than `McpAuditLog` keeping its array: an
 * in-memory audit trail answers nothing about a conversation from before the
 * app was last restarted, which is most of what an audit is opened to answer.
 * The redaction and size-capping that make a record safe to store already
 * happened in `buildAuditRecord` — this class writes what it is given and
 * never re-derives it, so there is exactly one place a secret could leak into
 * storage, and it is not here.
 *
 * `append` is `INSERT OR IGNORE` on `idempotency_key`. A resumed turn that
 * re-announces the same plugin mention, or a caller that retries a write after
 * a transient failure, lands the same logical event once rather than growing
 * the trail with duplicates that would otherwise read as two things having
 * happened.
 */

type PluginAuditRow = {
  id: string;
  idempotency_key: string;
  request_id: string;
  conversation_id: string;
  type: string;
  occurred_at: string;
  server_json: string | null;
  plugin_name: string | null;
  plugin_version: string | null;
  tool_name: string | null;
  outcome: string;
  approval_id: string | null;
  tool_call_id: string | null;
  detail: string | null;
  payload_json: string | null;
  truncation_json: string | null;
};

export class PluginAuditRepo {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Persists one record, unless its idempotency key has already been written.
   *
   * Returns whether the row was newly inserted, so a caller can tell a fresh
   * event from a suppressed duplicate — useful for logging, never for
   * anything that changes behaviour, since this class has no behaviour to
   * change.
   */
  append(record: PluginAuditRecord, idempotencyKey: string): boolean {
    const result = this.db
      .prepare(
        `
          INSERT OR IGNORE INTO plugin_audit_records (
            id, idempotency_key, request_id, conversation_id, type, occurred_at,
            server_json, plugin_name, plugin_version, tool_name, outcome,
            approval_id, tool_call_id, detail, payload_json, truncation_json
          )
          VALUES (
            @id, @idempotencyKey, @requestId, @conversationId, @type, @occurredAt,
            @serverJson, @pluginName, @pluginVersion, @toolName, @outcome,
            @approvalId, @toolCallId, @detail, @payloadJson, @truncationJson
          )
        `
      )
      .run({
        id: record.id,
        idempotencyKey,
        requestId: record.requestId,
        conversationId: record.conversationId,
        type: record.type,
        occurredAt: record.at,
        serverJson: record.server ? JSON.stringify(record.server) : null,
        pluginName: record.plugin?.name ?? null,
        pluginVersion: record.plugin?.version ?? null,
        toolName: record.tool,
        outcome: record.outcome,
        approvalId: record.approvalId,
        toolCallId: record.toolCallId,
        detail: record.detail,
        // `payload` is `undefined` for a record with nothing to show
        // (`plugin_invocation` carries no call arguments); stored as SQL NULL
        // rather than the string `"undefined"`.
        payloadJson: record.payload === undefined ? null : JSON.stringify(record.payload),
        truncationJson: record.truncation ? JSON.stringify(record.truncation) : null
      });

    return result.changes > 0;
  }

  forRequest(requestId: string): PluginAuditRecord[] {
    return this.db
      .prepare<{ requestId: string }, PluginAuditRow>(
        `
          SELECT * FROM plugin_audit_records
          WHERE request_id = @requestId
          ORDER BY occurred_at ASC, rowid ASC
        `
      )
      .all({ requestId })
      .map(toRecord);
  }

  forConversation(conversationId: string): PluginAuditRecord[] {
    return this.db
      .prepare<{ conversationId: string }, PluginAuditRow>(
        `
          SELECT * FROM plugin_audit_records
          WHERE conversation_id = @conversationId
          ORDER BY occurred_at ASC, rowid ASC
        `
      )
      .all({ conversationId })
      .map(toRecord);
  }
}

function toRecord(row: PluginAuditRow): PluginAuditRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    conversationId: row.conversation_id,
    type: row.type as PluginAuditRecord['type'],
    at: row.occurred_at,
    server: row.server_json ? JSON.parse(row.server_json) : null,
    plugin: row.plugin_name ? { name: row.plugin_name, version: row.plugin_version } : null,
    tool: row.tool_name,
    outcome: row.outcome as PluginAuditRecord['outcome'],
    approvalId: row.approval_id,
    toolCallId: row.tool_call_id,
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
    truncation: row.truncation_json ? JSON.parse(row.truncation_json) : null,
    detail: row.detail
  };
}
