import type {
  ListModelsOptions,
  ModelRuntimeHints,
  ModelSummary,
  ProviderId
} from '../../../shared/contracts';
import type { SqliteDatabase } from '../client';
import {
  fromTriState,
  parseReasoningEfforts,
  serializeReasoningEfforts,
  toTriState
} from './customProvidersRepo';

type ModelRow = {
  model_id: string;
  provider_id: ProviderId;
  label: string;
  context_window: number | null;
  is_free: number;
  /** NULL when no source has described the modality. */
  supports_vision: number | null;
  supports_document_input: number | null;
  supports_tools: number | null;
  archived: number;
  last_synced_at: string;
  last_seen_free_at: string | null;
  max_output_tokens: number | null;
  supports_temperature: number;
  supports_reasoning: number;
  reasoning_efforts: string | null;
};

const MODEL_COLUMNS = `
  model_id,
  provider_id,
  label,
  context_window,
  is_free,
  supports_vision,
  supports_document_input,
  supports_tools,
  archived,
  last_synced_at,
  last_seen_free_at,
  max_output_tokens,
  supports_temperature,
  supports_reasoning,
  reasoning_efforts
`;

function toSummary(row: ModelRow): ModelSummary {
  return {
    id: row.model_id,
    providerId: row.provider_id,
    label: row.label,
    contextWindow: row.context_window,
    isFree: Boolean(row.is_free),
    supportsVision: toTriState(row.supports_vision),
    supportsDocumentInput: toTriState(row.supports_document_input),
    supportsTools: toTriState(row.supports_tools),
    archived: Boolean(row.archived),
    lastSyncedAt: row.last_synced_at,
    lastSeenFreeAt: row.last_seen_free_at,
    maxOutputTokens: row.max_output_tokens,
    supportsTemperature: Boolean(row.supports_temperature),
    supportsReasoning: Boolean(row.supports_reasoning),
    reasoningEfforts: parseReasoningEfforts(row.reasoning_efforts)
  };
}

export class ModelsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  getById(modelId: string) {
    const row = this.db
      .prepare<{ modelId: string }, ModelRow>(
        `
          SELECT ${MODEL_COLUMNS}
          FROM model_cache
          WHERE model_id = @modelId
        `
      )
      .get({ modelId });

    if (!row) {
      return null;
    }

    return toSummary(row);
  }

  /**
   * Request-shaping facts for a model. Returns an empty object for unknown
   * models so callers fall back to provider defaults rather than guessing.
   */
  getRuntimeHints(modelId: string): ModelRuntimeHints {
    const model = this.getById(modelId);
    if (!model) {
      return {};
    }

    return {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens ?? null,
      supportsTemperature: model.supportsTemperature ?? true,
      supportsReasoning: model.supportsReasoning ?? false,
      reasoningEfforts: model.reasoningEfforts ?? null,
      supportsTools: model.supportsTools
    };
  }

  list(options: ListModelsOptions = {}) {
    const freeOnly = options.freeOnly ? 1 : 0;
    const includeArchived = options.includeArchived ? 1 : 0;
    const configuredOnly = options.configuredOnly ? 1 : 0;

    const rows = this.db
      .prepare<{ freeOnly: number; includeArchived: number; configuredOnly: number }, ModelRow>(
        `
          SELECT ${MODEL_COLUMNS}
          FROM model_cache
          WHERE (@freeOnly = 0 OR is_free = 1)
            AND (@includeArchived = 1 OR archived = 0)
            AND (
              @configuredOnly = 0
              OR EXISTS (
                SELECT 1 FROM custom_providers
                WHERE custom_providers.id = model_cache.provider_id
                  AND custom_providers.enabled = 1
              )
            )
          ORDER BY is_free DESC, COALESCE(last_seen_free_at, '') DESC, label ASC
        `
      )
      .all({ freeOnly, includeArchived, configuredOnly });

    return rows.map<ModelSummary>(toSummary);
  }

  /**
   * Drops cached models whose provider no longer exists at all. Disabled
   * providers are left alone: their models come back when re-enabled, without
   * needing another catalog fetch.
   */
  deleteOrphanedModels() {
    this.db.exec(
      `
        DELETE FROM model_cache
        WHERE NOT EXISTS (
          SELECT 1 FROM custom_providers WHERE custom_providers.id = model_cache.provider_id
        )
      `
    );
  }

  /**
   * Upserts a provider catalog. When `pruneProviderId` is supplied, models that
   * provider no longer serves are archived instead of lingering as selectable
   * entries that 404 at send time.
   */
  upsertModels(models: ModelSummary[], options: { pruneProviderId?: ProviderId } = {}) {
    const existingRows = this.db
      .prepare<[], { model_id: string; last_seen_free_at: string | null }>(
        'SELECT model_id, last_seen_free_at FROM model_cache'
      )
      .all();
    const existing = new Map(
      existingRows.map((row: { model_id: string; last_seen_free_at: string | null }) => [
        row.model_id,
        row.last_seen_free_at
      ])
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
          supports_document_input,
          supports_tools,
          archived,
          last_synced_at,
          last_seen_free_at,
          max_output_tokens,
          supports_temperature,
          supports_reasoning,
          reasoning_efforts
        )
        VALUES (
          @modelId,
          @providerId,
          @label,
          @contextWindow,
          @isFree,
          @supportsVision,
          @supportsDocumentInput,
          @supportsTools,
          @archived,
          @lastSyncedAt,
          @lastSeenFreeAt,
          @maxOutputTokens,
          @supportsTemperature,
          @supportsReasoning,
          @reasoningEfforts
        )
        ON CONFLICT(model_id) DO UPDATE SET
          provider_id = excluded.provider_id,
          label = excluded.label,
          context_window = excluded.context_window,
          is_free = excluded.is_free,
          supports_vision = excluded.supports_vision,
          supports_document_input = excluded.supports_document_input,
          supports_tools = excluded.supports_tools,
          archived = excluded.archived,
          last_synced_at = excluded.last_synced_at,
          last_seen_free_at = excluded.last_seen_free_at,
          max_output_tokens = excluded.max_output_tokens,
          supports_temperature = excluded.supports_temperature,
          supports_reasoning = excluded.supports_reasoning,
          reasoning_efforts = excluded.reasoning_efforts
      `
    );

    const archiveStatement = this.db.prepare(
      `
        UPDATE model_cache
        SET archived = 1
        WHERE provider_id = @providerId
          AND archived = 0
      `
    );

    const transaction = this.db.transaction((items: ModelSummary[]) => {
      // Archive the provider's rows up front, then let the upsert below clear
      // the flag for everything still in the catalog. Comparing sync
      // timestamps instead would miss models written in the same millisecond.
      if (options.pruneProviderId && items.length > 0) {
        archiveStatement.run({ providerId: options.pruneProviderId });
      }

      for (const model of items) {
        const previousLastSeenFreeAt = existing.get(model.id) ?? null;

        statement.run({
          modelId: model.id,
          providerId: model.providerId,
          label: model.label,
          contextWindow: model.contextWindow,
          isFree: model.isFree ? 1 : 0,
          supportsVision: fromTriState(model.supportsVision),
          supportsDocumentInput: fromTriState(model.supportsDocumentInput),
          supportsTools: fromTriState(model.supportsTools),
          archived: model.archived ? 1 : 0,
          lastSyncedAt: now,
          lastSeenFreeAt: model.isFree ? now : previousLastSeenFreeAt,
          maxOutputTokens: model.maxOutputTokens ?? null,
          supportsTemperature: (model.supportsTemperature ?? true) ? 1 : 0,
          supportsReasoning: (model.supportsReasoning ?? false) ? 1 : 0,
          reasoningEfforts: serializeReasoningEfforts(model.reasoningEfforts)
        });
      }
    });

    transaction(models);
  }

  /** Used when a user-configured provider is removed for good. */
  deleteByProvider(providerId: ProviderId) {
    this.db.prepare('DELETE FROM model_cache WHERE provider_id = @providerId').run({ providerId });
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
