import type { ListModelsOptions, ModelSummary, ProviderId } from '../../../shared/contracts';
import type { SqliteDatabase } from '../client';

type ModelRow = {
  model_id: string;
  provider_id: ProviderId;
  label: string;
  context_window: number | null;
  is_free: number;
  supports_vision: number;
  supports_tools: number;
  archived: number;
  last_synced_at: string;
  last_seen_free_at: string | null;
};

export class ModelsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  getById(modelId: string) {
    const row = this.db
      .prepare<{ modelId: string }, ModelRow>(
        `
          SELECT
            model_id,
            provider_id,
            label,
            context_window,
            is_free,
            supports_vision,
            supports_tools,
            archived,
            last_synced_at,
            last_seen_free_at
          FROM model_cache
          WHERE model_id = @modelId
        `
      )
      .get({ modelId });

    if (!row) {
      return null;
    }

    return {
      id: row.model_id,
      providerId: row.provider_id,
      label: row.label,
      contextWindow: row.context_window,
      isFree: Boolean(row.is_free),
      supportsVision: Boolean(row.supports_vision),
      supportsTools: Boolean(row.supports_tools),
      archived: Boolean(row.archived),
      lastSyncedAt: row.last_synced_at,
      lastSeenFreeAt: row.last_seen_free_at
    } satisfies ModelSummary;
  }

  list(options: ListModelsOptions = {}) {
    const freeOnly = options.freeOnly ? 1 : 0;
    const includeArchived = options.includeArchived ? 1 : 0;

    const rows = this.db
      .prepare<
        { freeOnly: number; includeArchived: number },
        ModelRow
      >(
        `
          SELECT
            model_id,
            provider_id,
            label,
            context_window,
            is_free,
            supports_vision,
            supports_tools,
            archived,
            last_synced_at,
            last_seen_free_at
          FROM model_cache
          WHERE (@freeOnly = 0 OR is_free = 1)
            AND (@includeArchived = 1 OR archived = 0)
          ORDER BY is_free DESC, COALESCE(last_seen_free_at, '') DESC, label ASC
        `
      )
      .all({ freeOnly, includeArchived });

    return rows.map<ModelSummary>((row: ModelRow) => ({
      id: row.model_id,
      providerId: row.provider_id,
      label: row.label,
      contextWindow: row.context_window,
      isFree: Boolean(row.is_free),
      supportsVision: Boolean(row.supports_vision),
      supportsTools: Boolean(row.supports_tools),
      archived: Boolean(row.archived),
      lastSyncedAt: row.last_synced_at,
      lastSeenFreeAt: row.last_seen_free_at
    }));
  }

  upsertModels(models: ModelSummary[]) {
    const existingRows = this.db
      .prepare<[], { model_id: string; last_seen_free_at: string | null }>(
        'SELECT model_id, last_seen_free_at FROM model_cache'
      )
      .all();
    const existing = new Map(
      existingRows.map((row: { model_id: string; last_seen_free_at: string | null }) => [row.model_id, row.last_seen_free_at])
    );

    const now = new Date().toISOString();
    const statement = this.db.prepare(
      `
        INSERT INTO model_cache (
          model_id,
          provider_id,
          label,
          context_window,
          is_free,
          supports_vision,
          supports_tools,
          archived,
          last_synced_at,
          last_seen_free_at
        )
        VALUES (
          @modelId,
          @providerId,
          @label,
          @contextWindow,
          @isFree,
          @supportsVision,
          @supportsTools,
          @archived,
          @lastSyncedAt,
          @lastSeenFreeAt
        )
        ON CONFLICT(model_id) DO UPDATE SET
          provider_id = excluded.provider_id,
          label = excluded.label,
          context_window = excluded.context_window,
          is_free = excluded.is_free,
          supports_vision = excluded.supports_vision,
          supports_tools = excluded.supports_tools,
          archived = excluded.archived,
          last_synced_at = excluded.last_synced_at,
          last_seen_free_at = excluded.last_seen_free_at
      `
    );

    const transaction = this.db.transaction((items: ModelSummary[]) => {
      for (const model of items) {
        const previousLastSeenFreeAt = existing.get(model.id) ?? null;

        statement.run({
          modelId: model.id,
          providerId: model.providerId,
          label: model.label,
          contextWindow: model.contextWindow,
          isFree: model.isFree ? 1 : 0,
          supportsVision: model.supportsVision ? 1 : 0,
          supportsTools: model.supportsTools ? 1 : 0,
          archived: model.archived ? 1 : 0,
          lastSyncedAt: now,
          lastSeenFreeAt: model.isFree ? now : previousLastSeenFreeAt
        });
      }
    });

    transaction(models);
  }

  getCatalogStats() {
    const row = this.db
      .prepare<[], { lastSyncedAt: string | null; count: number }>(
        `
          SELECT MAX(last_synced_at) AS lastSyncedAt, COUNT(*) AS count
          FROM model_cache
        `
      )
      .get();

    return {
      lastSyncedAt: row?.lastSyncedAt ?? null,
      count: row?.count ?? 0
    };
  }
}
