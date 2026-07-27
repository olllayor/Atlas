import type { ProviderId } from '../../../shared/contracts';
import type {
  CustomProvider,
  CustomProviderApiFormat,
  CustomProviderModel
} from '../../../shared/customProviders';
import type { SqliteDatabase } from '../client';

type ProviderRow = {
  id: string;
  name: string;
  base_url: string;
  api_format: string;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ModelRow = {
  provider_id: string;
  model_id: string;
  label: string;
  is_free: number;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_tools: number;
  supports_vision: number;
  supports_document_input: number;
  supports_reasoning: number;
  supports_temperature: number;
  sort_order: number;
};

const VALID_FORMATS: CustomProviderApiFormat[] = ['anthropic-messages', 'chat-completions', 'responses'];

function toApiFormat(value: string): CustomProviderApiFormat {
  return VALID_FORMATS.includes(value as CustomProviderApiFormat)
    ? (value as CustomProviderApiFormat)
    : 'chat-completions';
}

function toModel(row: ModelRow): CustomProviderModel {
  return {
    id: row.model_id,
    label: row.label,
    isFree: Boolean(row.is_free),
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    supportsTools: Boolean(row.supports_tools),
    supportsVision: Boolean(row.supports_vision),
    supportsDocumentInput: Boolean(row.supports_document_input),
    supportsReasoning: Boolean(row.supports_reasoning),
    supportsTemperature: Boolean(row.supports_temperature)
  };
}

export type CustomProviderRecord = Omit<CustomProvider, 'hasApiKey'>;

export class CustomProvidersRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(): CustomProviderRecord[] {
    const providers = this.db
      .prepare<[], ProviderRow>(
        `
          SELECT id, name, base_url, api_format, enabled, sort_order, created_at, updated_at
          FROM custom_providers
          ORDER BY sort_order ASC, created_at ASC
        `
      )
      .all();

    if (providers.length === 0) {
      return [];
    }

    // One read for every provider's models beats N round trips.
    const modelRows = this.db
      .prepare<[], ModelRow>(
        `
          SELECT provider_id, model_id, label, is_free, context_window, max_output_tokens,
                 supports_tools, supports_vision, supports_document_input,
                 supports_reasoning, supports_temperature, sort_order
          FROM custom_provider_models
          ORDER BY sort_order ASC, model_id ASC
        `
      )
      .all();

    const modelsByProvider = new Map<string, CustomProviderModel[]>();
    for (const row of modelRows) {
      const bucket = modelsByProvider.get(row.provider_id);
      if (bucket) {
        bucket.push(toModel(row));
      } else {
        modelsByProvider.set(row.provider_id, [toModel(row)]);
      }
    }

    return providers.map((row) => ({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiFormat: toApiFormat(row.api_format),
      enabled: Boolean(row.enabled),
      models: modelsByProvider.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getById(providerId: ProviderId): CustomProviderRecord | null {
    return this.list().find((provider) => provider.id === providerId) ?? null;
  }

  create(input: {
    id: ProviderId;
    name: string;
    baseUrl: string;
    apiFormat: CustomProviderApiFormat;
    models: CustomProviderModel[];
  }): CustomProviderRecord {
    const now = new Date().toISOString();
    const nextOrder =
      this.db.prepare<[], { next: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM custom_providers').get()
        ?.next ?? 0;

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT INTO custom_providers (id, name, base_url, api_format, enabled, sort_order, created_at, updated_at)
            VALUES (@id, @name, @baseUrl, @apiFormat, 1, @sortOrder, @now, @now)
          `
        )
        .run({
          id: input.id,
          name: input.name,
          baseUrl: input.baseUrl,
          apiFormat: input.apiFormat,
          sortOrder: nextOrder,
          now
        });

      this.writeModels(input.id, input.models);
    });

    transaction();

    const created = this.getById(input.id);
    if (!created) {
      throw new Error('Failed to persist the provider.');
    }

    return created;
  }

  update(
    providerId: ProviderId,
    patch: {
      name?: string;
      baseUrl?: string;
      apiFormat?: CustomProviderApiFormat;
      enabled?: boolean;
    }
  ): CustomProviderRecord {
    const existing = this.getById(providerId);
    if (!existing) {
      throw new Error('That provider no longer exists.');
    }

    this.db
      .prepare(
        `
          UPDATE custom_providers
          SET name = @name,
              base_url = @baseUrl,
              api_format = @apiFormat,
              enabled = @enabled,
              updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({
        id: providerId,
        name: patch.name ?? existing.name,
        baseUrl: patch.baseUrl ?? existing.baseUrl,
        apiFormat: patch.apiFormat ?? existing.apiFormat,
        enabled: (patch.enabled ?? existing.enabled) ? 1 : 0,
        updatedAt: new Date().toISOString()
      });

    const updated = this.getById(providerId);
    if (!updated) {
      throw new Error('That provider no longer exists.');
    }

    return updated;
  }

  setModels(providerId: ProviderId, models: CustomProviderModel[]): CustomProviderRecord {
    const existing = this.getById(providerId);
    if (!existing) {
      throw new Error('That provider no longer exists.');
    }

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM custom_provider_models WHERE provider_id = @providerId').run({ providerId });
      this.writeModels(providerId, models);
      this.db
        .prepare('UPDATE custom_providers SET updated_at = @updatedAt WHERE id = @id')
        .run({ id: providerId, updatedAt: new Date().toISOString() });
    });

    transaction();

    const updated = this.getById(providerId);
    if (!updated) {
      throw new Error('That provider no longer exists.');
    }

    return updated;
  }

  delete(providerId: ProviderId) {
    const transaction = this.db.transaction(() => {
      // The FK cascade only fires when foreign_keys is on; delete explicitly so
      // the rows go regardless of pragma state.
      this.db.prepare('DELETE FROM custom_provider_models WHERE provider_id = @providerId').run({ providerId });
      this.db.prepare('DELETE FROM custom_providers WHERE id = @providerId').run({ providerId });
    });

    transaction();
  }

  private writeModels(providerId: ProviderId, models: CustomProviderModel[]) {
    const statement = this.db.prepare(
      `
        INSERT INTO custom_provider_models (
          provider_id, model_id, label, is_free, context_window, max_output_tokens,
          supports_tools, supports_vision, supports_document_input,
          supports_reasoning, supports_temperature, sort_order
        )
        VALUES (
          @providerId, @modelId, @label, @isFree, @contextWindow, @maxOutputTokens,
          @supportsTools, @supportsVision, @supportsDocumentInput,
          @supportsReasoning, @supportsTemperature, @sortOrder
        )
        ON CONFLICT(provider_id, model_id) DO UPDATE SET
          label = excluded.label,
          is_free = excluded.is_free,
          context_window = excluded.context_window,
          max_output_tokens = excluded.max_output_tokens,
          supports_tools = excluded.supports_tools,
          supports_vision = excluded.supports_vision,
          supports_document_input = excluded.supports_document_input,
          supports_reasoning = excluded.supports_reasoning,
          supports_temperature = excluded.supports_temperature,
          sort_order = excluded.sort_order
      `
    );

    models.forEach((model, index) => {
      statement.run({
        providerId,
        modelId: model.id,
        label: model.label,
        isFree: model.isFree ? 1 : 0,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportsTools: model.supportsTools ? 1 : 0,
        supportsVision: model.supportsVision ? 1 : 0,
        supportsDocumentInput: model.supportsDocumentInput ? 1 : 0,
        supportsReasoning: model.supportsReasoning ? 1 : 0,
        supportsTemperature: model.supportsTemperature ? 1 : 0,
        sortOrder: index
      });
    });
  }
}
