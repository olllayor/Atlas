import type { SqliteDatabase } from '../client';

/**
 * Which ACP session backs a conversation for a given local agent, and the
 * directory it was created against.
 *
 * Both halves matter for the same reason opencode's cursor tracks them
 * (`OpenCodeSessionsRepo`): an agent scopes its transcript to a working
 * directory, so resuming a session created elsewhere would graft another
 * project's history onto this chat. A directory move forks instead.
 */
export type LocalAgentSessionCursor = {
  conversationId: string;
  agentId: string;
  sessionId: string;
  directory: string;
  updatedAt: string;
};

type CursorRow = {
  conversation_id: string;
  agent_id: string;
  session_id: string;
  directory: string;
  updated_at: string;
};

export class LocalAgentSessionsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(agentId: string, conversationId: string): LocalAgentSessionCursor | null {
    const row = this.db
      .prepare<{ agentId: string; conversationId: string }, CursorRow>(
        `
          SELECT conversation_id, agent_id, session_id, directory, updated_at
          FROM local_agent_sessions
          WHERE agent_id = @agentId AND conversation_id = @conversationId
        `
      )
      .get({ agentId, conversationId });

    if (!row) {
      return null;
    }

    return {
      conversationId: row.conversation_id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      directory: row.directory,
      updatedAt: row.updated_at
    };
  }

  set(input: { agentId: string; conversationId: string; sessionId: string; directory: string }): void {
    this.db
      .prepare(
        `
          INSERT INTO local_agent_sessions (conversation_id, agent_id, session_id, directory, updated_at)
          VALUES (@conversationId, @agentId, @sessionId, @directory, @updatedAt)
          ON CONFLICT(conversation_id, agent_id) DO UPDATE SET
            session_id = excluded.session_id,
            directory = excluded.directory,
            updated_at = excluded.updated_at
        `
      )
      .run({ ...input, updatedAt: new Date().toISOString() });
  }

  clear(agentId: string, conversationId: string): void {
    this.db
      .prepare('DELETE FROM local_agent_sessions WHERE agent_id = @agentId AND conversation_id = @conversationId')
      .run({ agentId, conversationId });
  }

  /** Every live cursor for one agent; used when its settings change under it. */
  listByAgent(agentId: string): LocalAgentSessionCursor[] {
    return this.db
      .prepare<{ agentId: string }, CursorRow>(
        'SELECT conversation_id, agent_id, session_id, directory, updated_at FROM local_agent_sessions WHERE agent_id = @agentId'
      )
      .all({ agentId })
      .map((row) => ({
        conversationId: row.conversation_id,
        agentId: row.agent_id,
        sessionId: row.session_id,
        directory: row.directory,
        updatedAt: row.updated_at
      }));
  }
}
