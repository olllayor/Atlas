import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from '../client';

/** Venue a command ran in. 'local' = host OS sandbox; 'cloud' = Cloudflare DO isolate. */
export type CommandVenue = 'local' | 'cloud';

export type TerminalHistoryRecord = {
  id: string;
  conversationId: string;
  command: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  venue: CommandVenue;
};

type TerminalHistoryRow = {
  id: string;
  conversation_id: string;
  command: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  venue: CommandVenue | null;
};

function mapRow(row: TerminalHistoryRow): TerminalHistoryRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    command: row.command,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    // Rows inserted before the venue column landed read back as local, which
    // matches what they actually were (cloud wasn't wired yet).
    venue: row.venue === 'cloud' ? 'cloud' : 'local'
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
    venue?: CommandVenue;
  }): TerminalHistoryRecord {
    const id = randomUUID();
    const startedAt = input.startedAt ?? new Date().toISOString();
    const venue = input.venue === 'cloud' ? 'cloud' : 'local';

    this.db
      .prepare(
        `INSERT INTO terminal_history (
          id, conversation_id, command, exit_code, started_at, finished_at, venue
        ) VALUES (
          @id, @conversationId, @command, @exitCode, @startedAt, @finishedAt, @venue
        )`
      )
      .run({
        id,
        conversationId: input.conversationId,
        command: input.command.trim(),
        exitCode: input.exitCode ?? null,
        startedAt,
        finishedAt: input.finishedAt ?? null,
        venue
      });

    return {
      id,
      conversationId: input.conversationId,
      command: input.command.trim(),
      exitCode: input.exitCode ?? null,
      startedAt,
      finishedAt: input.finishedAt ?? null,
      venue
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
