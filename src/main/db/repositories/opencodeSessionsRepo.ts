import type { SqliteDatabase } from '../client';

/**
 * Which opencode session backs a conversation, and where it was created.
 *
 * opencode keys its own transcript by session id and scopes it to a directory,
 * so both halves are the cursor: resuming with a session created against
 * another project would graft that project's history onto this chat
 * (deep-integration plan T5, mirroring t3code's `parseOpenCodeResume` +
 * `isSameOpenCodeDirectory` pair).
 */
export type OpenCodeSessionCursor = {
  conversationId: string;
  sessionId: string;
  directory: string;
  updatedAt: string;
};

type CursorRow = {
  conversation_id: string;
  session_id: string;
  directory: string;
  updated_at: string;
};

export class OpenCodeSessionsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(conversationId: string): OpenCodeSessionCursor | null {
    const row = this.db
      .prepare<{ conversationId: string }, CursorRow>(
        `
          SELECT conversation_id, session_id, directory, updated_at
          FROM opencode_sessions
          WHERE conversation_id = @conversationId
        `
      )
      .get({ conversationId });

    return row
      ? {
          conversationId: row.conversation_id,
          sessionId: row.session_id,
          directory: row.directory,
          updatedAt: row.updated_at
        }
      : null;
  }

  /** Records (or moves) the cursor. One session per conversation by design. */
  set(input: { conversationId: string; sessionId: string; directory: string }): void {
    this.db
      .prepare(
        `
          INSERT INTO opencode_sessions (conversation_id, session_id, directory, updated_at)
          VALUES (@conversationId, @sessionId, @directory, @now)
          ON CONFLICT (conversation_id) DO UPDATE SET
            session_id = excluded.session_id,
            directory = excluded.directory,
            updated_at = excluded.updated_at
        `
      )
      .run({ ...input, now: new Date().toISOString() });
  }

  clear(conversationId: string): void {
    this.db
      .prepare('DELETE FROM opencode_sessions WHERE conversation_id = @conversationId')
      .run({ conversationId });
  }
}
