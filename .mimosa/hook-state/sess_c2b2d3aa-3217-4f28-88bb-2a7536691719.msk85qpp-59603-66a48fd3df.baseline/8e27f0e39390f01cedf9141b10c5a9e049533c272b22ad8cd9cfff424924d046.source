import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from '../client';

export type TerminalHistoryRecord = {
  id: string;
  conversationId: string;
  command: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

type TerminalHistoryRow = {
  id: string;
  conversation_id: string;
  command: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
};

function mapRow(row: TerminalHistoryRow): TerminalHistoryRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    command: row.command,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

export class TerminalHistoryRepo {
  constructor(private readonly db: SqliteDatabase) {}

  add(input: {
    conversationId: string;
    command: string;
    exitCode?: number | null;
    startedAt?: string;
    finishedAt?: string | null;
  }): TerminalHistoryRecord {
    const id = randomUUID();
    const startedAt = input.startedAt ?? new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO terminal_history (
          id, conversation_id, command, exit_code, started_at, finished_at
        ) VALUES (
          @id, @conversationId, @command, @exitCode, @startedAt, @finishedAt
        )`
      )
      .run({
        id,
        conversationId: input.conversationId,
        command: input.command.trim(),
        exitCode: input.exitCode ?? null,
        startedAt,
        finishedAt: input.finishedAt ?? null
      });

    return {
      id,
      conversationId: input.conversationId,
      command: input.command.trim(),
      exitCode: input.exitCode ?? null,
      startedAt,
      finishedAt: input.finishedAt ?? null
    };
  }

  listForConversation(conversationId: string, limit = 50): TerminalHistoryRecord[] {
    const rows = this.db
      .prepare<{ conversationId: string; limit: number }, TerminalHistoryRow>(
        `SELECT * FROM terminal_history
         WHERE conversation_id = @conversationId
         ORDER BY started_at DESC
         LIMIT @limit`
      )
      .all({ conversationId, limit });

    return rows.map(mapRow).reverse();
  }

  deleteForConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM terminal_history WHERE conversation_id = @conversationId').run({ conversationId });
  }
}
