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

/**
 * Provider ids that are servable without a `custom_providers` row.
 *
 * Every provider used to be a saved endpoint, so "is this provider real?" was
 * answerable with a join. OpenCode broke that: it is an integration that
 * brings its own configuration and its own credentials, so its models were
 * written by a refresh, hidden from every `configuredOnly` read, and then
 * deleted by the orphan sweep in the same call.
 *
 * Read through a callback because the answer changes at runtime — switch the
 * integration off and its models go back to being orphans, exactly like a
 * deleted endpoint's.
 */
export type SelfManagedProviders = () => readonly ProviderId[];

export class ModelsRepo {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly selfManagedProviders: SelfManagedProviders = () => []
  ) {}

  /**
   * `provider_id IN (…)` for the self-managed set, with its bound parameters.
   * Collapses to the false literal when the set is empty, which keeps every
   * query one shape whether or not an integration is on.
   */
  private selfManagedMatch(): { sql: string; params: Record<string, string> } {
    const ids = [...this.selfManagedProviders()];
    if (ids.length === 0) {
      return { sql: '0', params: {} };
    }

    return {
      sql: `model_cache.provider_id IN (${ids.map((_, index) => `@self${index}`).join(', ')})`,
      params: Object.fromEntries(ids.map((id, index) => [`self${index}`, id]))
    };
  }

  getById(modelId: string, preferredProviderId?: ProviderId | null) {
    const selfManaged = this.selfManagedMatch();
    const row = this.db
      .prepare<Record<string, string | null>, ModelRow>(
        `
          SELECT ${MODEL_COLUMNS}
          FROM model_cache
          WHERE model_id = @modelId
          -- (modelId, providerId) is the real key now; a bare modelId can match
          -- many rows (BAI and EMPERO both serve glm-5.3-flash). Prefer the
          -- caller's pinned provider first, then a servable provider, then
          -- non-archived, then lexicographic for determinism. The preferred
          -- branch falls through automatically when that provider does not serve
          -- this id.
          ORDER BY CASE WHEN @preferredProviderId IS NOT NULL AND provider_id = @preferredProviderId THEN 0 ELSE 1 END ASC,
            CASE WHEN EXISTS (
              SELECT 1 FROM custom_providers c
              WHERE c.id = model_cache.provider_id AND c.enabled = 1
            ) OR ${selfManaged.sql} THEN 0 ELSE 1 END ASC,
            archived ASC,
            provider_id ASC
          LIMIT 1
        `
      )
      .get({ modelId, preferredProviderId: preferredProviderId ?? null, ...selfManaged.params });

    if (!row) {
      return null;
    }

    return toSummary(row);
  }

  /**
   * Request-shaping facts for a model. Returns an empty object for unknown
   * models so callers fall back to provider defaults rather than guessing.
   */
  getRuntimeHints(modelId: string, preferredProviderId?: ProviderId | null): ModelRuntimeHints {
    const model = this.getById(modelId, preferredProviderId);
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

    const selfManaged = this.selfManagedMatch();
    const rows = this.db
      .prepare<Record<string, string | number>, ModelRow>(
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
              OR ${selfManaged.sql}
            )
          ORDER BY is_free DESC, COALESCE(last_seen_free_at, '') DESC, label ASC
        `
      )
      .all({ freeOnly, includeArchived, configuredOnly, ...selfManaged.params });

    return rows.map<ModelSummary>(toSummary);
  }

  /**
   * Drops cached models whose provider no longer exists at all. Disabled
   * providers are left alone: their models come back when re-enabled, without
   * needing another catalog fetch. A self-managed provider counts as existing
   * for as long as its integration is on.
   */
  deleteOrphanedModels() {
    const selfManaged = this.selfManagedMatch();
    this.db
      .prepare<Record<string, string>, unknown>(
        `
          DELETE FROM model_cache
          WHERE NOT EXISTS (
            SELECT 1 FROM custom_providers WHERE custom_providers.id = model_cache.provider_id
          )
          AND NOT ${selfManaged.sql}
        `
      )
      .run(selfManaged.params);
  }

  /**
   * Upserts a provider catalog. When `pruneProviderId` is supplied, models that
   * provider no longer serves are archived instead of lingering as selectable
   * entries that 404 at send time.
   */
  upsertModels(models: ModelSummary[], options: { pruneProviderId?: ProviderId } = {}) {
    const existingRows = this.db
      .prepare<[], { provider_id: string; model_id: string; last_seen_free_at: string | null }>(
        'SELECT provider_id, model_id, last_seen_free_at FROM model_cache'
      )
      .all();
    const existing = new Map(
      existingRows.map(
        (row: { provider_id: string; model_id: string; last_seen_free_at: string | null }) => [
          `${row.provider_id}\u0000${row.model_id}`,
          row.last_seen_free_at
        ]
      )
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
        ON CONFLICT(provider_id, model_id) DO UPDATE SET
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
        const previousLastSeenFreeAt = existing.get(`${model.providerId}\u0000${model.id}`) ?? null;

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
          WHERE archived = 0
        `
      )
      .get();

    return {
      lastSyncedAt: row?.lastSyncedAt ?? null,
      count: row?.count ?? 0
    };
  }
}
