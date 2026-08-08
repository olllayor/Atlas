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
  lines_added: number;
  lines_removed: number;
  created_at: string;
  updated_at: string;
};

export type DiffLineCounts = {
  linesAdded: number;
  linesRemoved: number;
};

/**
 * Added/removed line counts for a unified diff.
 *
 * `+++`/`---` are the file headers, not content: counting them would add one
 * phantom insertion and one phantom deletion to every single change, so a chat
 * that touched twelve files would read `+12 −12` before anything was edited.
 * Everything else that starts with `+`/`-` is a real line, including the `--`
 * of a deleted line that happens to begin with a dash.
 *
 * Counted once at write time and stored, because the sidebar asks for these
 * numbers for every conversation at once and re-parsing every stored diff on
 * each listing would put megabytes of text through this function per keystroke.
 */
export function countDiffLines(diffText: string): DiffLineCounts {
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }

    if (line.startsWith('+')) {
      linesAdded += 1;
    } else if (line.startsWith('-')) {
      linesRemoved += 1;
    }
  }

  return { linesAdded, linesRemoved };
}

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
    linesAdded: row.lines_added,
    linesRemoved: row.lines_removed,
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
    const { linesAdded, linesRemoved } = countDiffLines(input.diffText);

    this.db
      .prepare(
        `INSERT INTO file_changes (
          id, conversation_id, file_path, before_content, after_content, diff_text, status, tool_call_id,
          lines_added, lines_removed, created_at, updated_at
        ) VALUES (
          @id, @conversationId, @filePath, @beforeContent, @afterContent, @diffText, 'pending', @toolCallId,
          @linesAdded, @linesRemoved, @now, @now
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
        linesAdded,
        linesRemoved,
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
