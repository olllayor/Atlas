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
  /** Cursor shape version; rows with any other version are ignored. */
  schemaVersion: number;
  /** Which transport owns the session: SDK and ACP ids share opencode storage. */
  transport: 'sdk' | 'acp';
  updatedAt: string;
};

type CursorRow = {
  conversation_id: string;
  session_id: string;
  directory: string;
  schema_version: number | null;
  transport: string | null;
  updated_at: string;
};

/** Current cursor shape. Bump when the stored meaning changes. */
export const OPENCODE_SESSION_CURSOR_VERSION = 2;

export class OpenCodeSessionsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(conversationId: string): OpenCodeSessionCursor | null {
    const row = this.db
      .prepare<{ conversationId: string }, CursorRow>(
        `
          SELECT conversation_id, session_id, directory, schema_version, transport, updated_at
          FROM opencode_sessions
          WHERE conversation_id = @conversationId
        `
      )
      .get({ conversationId });

    if (!row) {
      return null;
    }
    // Missing version means a pre-versioning row: treat as current shape so
    // existing chats keep resuming. Any other version is a future shape we do
    // not understand — ignore rather than graft history onto the wrong chat.
    // Version 1 rows predate transport tagging and always lose: both runtimes
    // share opencode's session storage, so a foreign id would resolve.
    const schemaVersion = row.schema_version ?? OPENCODE_SESSION_CURSOR_VERSION;
    if (schemaVersion !== OPENCODE_SESSION_CURSOR_VERSION) {
      return null;
    }
    const transport = row.transport === 'acp' ? 'acp' : 'sdk';
    return {
      conversationId: row.conversation_id,
      sessionId: row.session_id,
      directory: row.directory,
      schemaVersion,
      transport,
      updatedAt: row.updated_at
    };
  }

  /** Records (or moves) the cursor. One session per conversation by design. */
  set(input: { conversationId: string; sessionId: string; directory: string; transport: 'sdk' | 'acp' }): void {
    this.db
      .prepare(
        `
          INSERT INTO opencode_sessions (conversation_id, session_id, directory, schema_version, transport, updated_at)
          VALUES (@conversationId, @sessionId, @directory, @schemaVersion, @transport, @now)
          ON CONFLICT (conversation_id) DO UPDATE SET
            session_id = excluded.session_id,
            directory = excluded.directory,
            schema_version = excluded.schema_version,
            transport = excluded.transport,
            updated_at = excluded.updated_at
        `
      )
      .run({ ...input, schemaVersion: OPENCODE_SESSION_CURSOR_VERSION, now: new Date().toISOString() });
  }

  clear(conversationId: string): void {
    this.db
      .prepare('DELETE FROM opencode_sessions WHERE conversation_id = @conversationId')
      .run({ conversationId });
  }
}
