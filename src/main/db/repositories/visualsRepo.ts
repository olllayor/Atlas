import type { SqliteDatabase } from '../client';

type VisualRow = {
  id: string;
  title: string;
  content: string;
  visual_type: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SavedVisual = {
  id: string;
  title: string;
  content: string;
  visualType: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export class VisualsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  save(visual: Omit<SavedVisual, 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString();
    this.db
      .prepare<{
        id: string;
        title: string;
        content: string;
        visualType: string;
        sourceConversationId: string | null;
        sourceMessageId: string | null;
        createdAt: string;
        updatedAt: string;
      }>(
        `
          INSERT INTO saved_visuals (
            id, title, content, visual_type,
            source_conversation_id, source_message_id,
            created_at, updated_at
          ) VALUES (
            @id, @title, @content, @visualType,
            @sourceConversationId, @sourceMessageId,
            @createdAt, @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            visual_type = excluded.visual_type,
            updated_at = excluded.updated_at
        `
      )
      .run({
        id: visual.id,
        title: visual.title,
        content: visual.content,
        visualType: visual.visualType,
        sourceConversationId: visual.sourceConversationId,
        sourceMessageId: visual.sourceMessageId,
        createdAt: now,
        updatedAt: now,
      });

    return this.getById(visual.id);
  }

  getById(id: string): SavedVisual | null {
    const row = this.db
      .prepare<{ id: string }, VisualRow>(
        `
          SELECT id, title, content, visual_type,
                 source_conversation_id, source_message_id,
                 created_at, updated_at
          FROM saved_visuals
          WHERE id = @id
        `
      )
      .get({ id });

    if (!row) return null;

    return this.mapRow(row);
  }

  list(limit = 50): SavedVisual[] {
    const rows = this.db
      .prepare<{ limit: number }, VisualRow>(
        `
          SELECT id, title, content, visual_type,
                 source_conversation_id, source_message_id,
                 created_at, updated_at
          FROM saved_visuals
          ORDER BY updated_at DESC
          LIMIT @limit
        `
      )
      .all({ limit });

    return rows.map(this.mapRow);
  }

  search(query: string, limit = 50): SavedVisual[] {
    const rows = this.db
      .prepare<{ query: string; limit: number }, VisualRow>(
        `
          SELECT id, title, content, visual_type,
                 source_conversation_id, source_message_id,
                 created_at, updated_at
          FROM saved_visuals
          WHERE title LIKE @query OR content LIKE @query
          ORDER BY updated_at DESC
          LIMIT @limit
        `
      )
      .all({ query: `%${query}%`, limit });

    return rows.map(this.mapRow);
  }

  deleteById(id: string): boolean {
    const result = this.db
      .prepare<{ id: string }>(
        'DELETE FROM saved_visuals WHERE id = @id'
      )
      .run({ id });

    return result.changes > 0;
  }

  private mapRow(row: VisualRow): SavedVisual {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      visualType: row.visual_type,
      sourceConversationId: row.source_conversation_id,
      sourceMessageId: row.source_message_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
