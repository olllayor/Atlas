import type { SqliteDatabase } from '../client';

/** What produced the rolling summary: the deterministic heuristic or a model pass. */
export type SummarySource = 'heuristic' | 'model';

/**
 * 'ready' rows are usable; 'building' marks an in-flight model refresh. A row
 * stuck in 'building' after a crash is treated as absent by readers and
 * retried by the next refresh — the durable lock for the async pass.
 */
export type SummaryStatus = 'ready' | 'building';

export type ConversationSummaryRecord = {
  conversationId: string;
  fingerprint: string;
  rollingSummary: string;
  source: SummarySource;
  status: SummaryStatus;
  updatedAt: string;
};

type ConversationSummaryRow = {
  conversation_id: string;
  fingerprint: string;
  rolling_summary: string;
  source: string;
  status: string;
  updated_at: string;
};

function mapRow(row: ConversationSummaryRow): ConversationSummaryRecord {
  return {
    conversationId: row.conversation_id,
    fingerprint: row.fingerprint,
    rollingSummary: row.rolling_summary,
    source: row.source === 'model' ? 'model' : 'heuristic',
    status: row.status === 'building' ? 'building' : 'ready',
    updatedAt: row.updated_at
  };
}

export class ConversationSummariesRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(conversationId: string): ConversationSummaryRecord | null {
    const row = this.db
      .prepare<{ conversationId: string }, ConversationSummaryRow>(
        `SELECT * FROM conversation_summaries WHERE conversation_id = @conversationId`
      )
      .get({ conversationId });

    return row ? mapRow(row) : null;
  }

  upsert(input: {
    conversationId: string;
    fingerprint: string;
    rollingSummary: string;
    source: SummarySource;
    status: SummaryStatus;
  }): ConversationSummaryRecord {
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO conversation_summaries (
          conversation_id, fingerprint, rolling_summary, source, status, updated_at
        ) VALUES (
          @conversationId, @fingerprint, @rollingSummary, @source, @status, @updatedAt
        )
        ON CONFLICT(conversation_id) DO UPDATE SET
          fingerprint = @fingerprint,
          rolling_summary = @rollingSummary,
          source = @source,
          status = @status,
          updated_at = @updatedAt`
      )
      .run({
        conversationId: input.conversationId,
        fingerprint: input.fingerprint,
        rollingSummary: input.rollingSummary,
        source: input.source,
        status: input.status,
        updatedAt
      });

    return {
      conversationId: input.conversationId,
      fingerprint: input.fingerprint,
      rollingSummary: input.rollingSummary,
      source: input.source,
      status: input.status,
      updatedAt
    };
  }

  deleteForConversation(conversationId: string): void {
    this.db
      .prepare('DELETE FROM conversation_summaries WHERE conversation_id = @conversationId')
      .run({ conversationId });
  }
}
