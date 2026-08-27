/**
 * Thin factory over the official `@opencode-ai/sdk` v2 client — Atlas' only
 * place that constructs SDK instances. Blueprint:
 * pingdotgg/t3code `opencodeRuntime.ts` L680-692 (Basic auth, throwOnError).
 *
 * The narrow exported interface is deliberate: everything downstream
 * (probe, adapter, tests) programs against `OpenCodeInventoryClient`, never
 * against raw SDK generics — mirroring how t3 isolates SDK churn behind
 * `OpenCodeRuntime`'s shape.
 */

import { createOpencodeClient } from '@opencode-ai/sdk/v2';

/** Upstream model as opencode reports it, narrowed to what the catalog needs. */
export interface OpenCodeModelInfo {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
  readonly contextWindow: number | null;
  readonly maxOutputTokens: number | null;
  readonly costPerMillion: { readonly input: number; readonly output: number } | null;
  readonly capabilities: {
    readonly temperature: boolean | null;
    readonly reasoning: boolean | null;
    readonly toolcall: boolean | null;
    readonly image: boolean | null;
    readonly pdf: boolean | null;
  };
}

export interface OpenCodeProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly models: readonly OpenCodeModelInfo[];
}

export interface OpenCodeProviderListResult {
  /** Every provider opencode knows about, connected or not. */
  readonly providers: readonly OpenCodeProviderInfo[];
  /** Provider ids that opencode reports as authenticated/connected. */
  readonly connected: readonly string[];
  /** opencode's own default model per provider id, when it names one. */
  readonly defaults: Readonly<Record<string, string>>;
  /** Total upstream models across all providers. */
  readonly modelCount: number;
}

/** Narrow surface consumed by probe/catalog code and fakes alike. */
export interface OpenCodeInventoryClient {
  listProviders(): Promise<OpenCodeProviderListResult>;
}

export interface CreateOpenCodeClientInput {
  readonly baseUrl: string;
  readonly directory: string;
  /** Keychain-stored server password (plan D3); sent as HTTP Basic auth. */
  readonly serverPassword?: string;
}

function buildAuthHeaders(serverPassword?: string): Record<string, string> | undefined {
  if (!serverPassword || serverPassword.trim().length === 0) {
    return undefined;
  }
  const encoded = Buffer.from(`opencode:${serverPassword}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

/**
 * Build the raw SDK client. Everything Atlas talks to opencode through — the
 * catalog, the probe, and the streaming adapter — starts here, so auth and
 * `directory` scoping are configured in exactly one place.
 */
export function createOpenCodeSdkClient(input: CreateOpenCodeClientInput) {
  const headers = buildAuthHeaders(input.serverPassword);
  return createOpencodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
    throwOnError: true,
    ...(headers ? { headers } : {})
  });
}

export type OpenCodeSdkClient = ReturnType<typeof createOpenCodeSdkClient>;

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Normalize `GET /provider` into Atlas' own shape.
 *
 * The wire payload is `{ all: Provider[]; default: Record<providerID, modelID>;
 * connected: providerID[] }` — deliberately re-read defensively here, because
 * opencode aggregates third-party catalogs and a single odd entry must not
 * take the whole refresh down.
 */
export function normalizeProviderListPayload(payload: unknown): OpenCodeProviderListResult {
  const data = (payload ?? {}) as {
    all?: unknown;
    connected?: unknown;
    default?: unknown;
  };

  const providers: OpenCodeProviderInfo[] = (Array.isArray(data.all) ? data.all : [])
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry?.id === 'string')
    .map((entry) => {
      const rawModels = (entry.models ?? {}) as Record<string, Record<string, unknown>>;
      const models = Object.entries(rawModels)
        .map(([modelKey, model]) => {
          const limit = (model?.limit ?? {}) as { context?: unknown; output?: unknown };
          const cost = (model?.cost ?? {}) as { input?: unknown; output?: unknown };
          const capabilities = (model?.capabilities ?? {}) as Record<string, unknown>;
          const input = (capabilities.input ?? {}) as Record<string, unknown>;

          return {
            id: typeof model?.id === 'string' ? model.id : modelKey,
            name: typeof model?.name === 'string' ? model.name : modelKey,
            ...(typeof model?.status === 'string' ? { status: model.status } : {}),
            contextWindow: toNumberOrNull(limit.context),
            maxOutputTokens: toNumberOrNull(limit.output),
            costPerMillion:
              typeof cost.input === 'number' && typeof cost.output === 'number'
                ? { input: cost.input, output: cost.output }
                : null,
            capabilities: {
              temperature: toBooleanOrNull(capabilities.temperature),
              reasoning: toBooleanOrNull(capabilities.reasoning),
              toolcall: toBooleanOrNull(capabilities.toolcall),
              image: toBooleanOrNull(input.image),
              pdf: toBooleanOrNull(input.pdf)
            }
          } satisfies OpenCodeModelInfo;
        })
        .sort((left, right) => left.id.localeCompare(right.id));

      return {
        id: String(entry.id),
        name: typeof entry.name === 'string' ? entry.name : String(entry.id),
        models
      } satisfies OpenCodeProviderInfo;
    });

  const connected = Array.isArray(data.connected)
    ? data.connected.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const defaultsRecord = (data.default ?? {}) as Record<string, unknown>;
  const defaults = Object.fromEntries(
    Object.entries(defaultsRecord).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );

  return {
    providers,
    connected,
    defaults,
    modelCount: providers.reduce((total, provider) => total + provider.models.length, 0)
  };
}

export function createOpenCodeInventoryClient(
  input: CreateOpenCodeClientInput
): OpenCodeInventoryClient {
  const client = createOpenCodeSdkClient(input);

  return {
    async listProviders() {
      const response = await client.provider.list();
      return normalizeProviderListPayload((response as { data?: unknown } | undefined)?.data);
    }
  };
}
