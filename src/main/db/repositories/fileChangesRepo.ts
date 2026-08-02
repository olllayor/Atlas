import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from '../client';
import type { FileChangeStatus, FileChangeRecord } from '../../../shared/contracts';

export type { FileChangeStatus, FileChangeRecord };

type FileChangeRow = {
  id: string;
  conversation_id: string;
  file_path: string;
  before_content: string | null;
  after_content: string | null;
  diff_text: string;
  status: FileChangeStatus;
  tool_call_id: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: FileChangeRow): FileChangeRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    filePath: row.file_path,
    beforeContent: row.before_content,
    afterContent: row.after_content,
    diffText: row.diff_text,
    status: row.status,
    toolCallId: row.tool_call_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class FileChangesRepo {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    conversationId: string;
    filePath: string;
    beforeContent?: string | null;
    afterContent?: string | null;
    diffText: string;
    toolCallId?: string | null;
  }): FileChangeRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO file_changes (
          id, conversation_id, file_path, before_content, after_content, diff_text, status, tool_call_id, created_at, updated_at
        ) VALUES (
          @id, @conversationId, @filePath, @beforeContent, @afterContent, @diffText, 'pending', @toolCallId, @now, @now
        )`
      )
      .run({
        id,
        conversationId: input.conversationId,
        filePath: input.filePath,
        beforeContent: input.beforeContent ?? null,
        afterContent: input.afterContent ?? null,
        diffText: input.diffText,
        toolCallId: input.toolCallId ?? null,
        now
      });

    return this.get(id)!;
  }

  get(id: string): FileChangeRecord | null {
    const row = this.db
      .prepare<{ id: string }, FileChangeRow>('SELECT * FROM file_changes WHERE id = @id')
      .get({ id });

    return row ? mapRow(row) : null;
  }

  listForConversation(conversationId: string): FileChangeRecord[] {
    const rows = this.db
      .prepare<{ conversationId: string }, FileChangeRow>(
        'SELECT * FROM file_changes WHERE conversation_id = @conversationId ORDER BY created_at ASC'
      )
      .all({ conversationId });

    return rows.map(mapRow);
  }

  updateStatus(id: string, status: FileChangeStatus): FileChangeRecord {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE file_changes SET status = @status, updated_at = @now WHERE id = @id')
      .run({ id, status, now });

    return this.get(id)!;
  }

  deleteForConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM file_changes WHERE conversation_id = @conversationId').run({ conversationId });
  }
}
