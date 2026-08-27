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

export interface OpenCodeProviderSummary {
  readonly id: string;
  readonly name: string;
}

export interface OpenCodeProviderListResult {
  /** Upstream providers keyed by providerID. */
  readonly providers: Readonly<Record<string, { readonly id: string; readonly name: string }>>;
  /** Provider ids that opencode reports as authenticated/connected. */
  readonly connected: readonly string[];
  /** Total upstream models across all providers (defensive flattening). */
  readonly modelCount: number;
}

export interface OpencodeRawClient {
  readonly provider: {
    list(): Promise<{ data?: unknown }>;
  };
}

/** Narrow surface consumed by probe/adapter code and fakes alike. */
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

export function createOpenCodeInventoryClient(
  input: CreateOpenCodeClientInput
): OpenCodeInventoryClient {
  const headers = buildAuthHeaders(input.serverPassword);
  const raw = createOpencodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
    throwOnError: true,
    ...(headers ? { headers } : {})
  }) as unknown as OpencodeRawClient;

  return {
    async listProviders() {
      const response = await raw.provider.list();
      const data = (response?.data ?? {}) as Record<string, unknown>;

      const providersRecord = (data.providers ?? {}) as Record<
        string,
        { id?: string; name?: string }
      >;
      const providers: OpenCodeProviderListResult['providers'] = Object.fromEntries(
        Object.entries(providersRecord).map(([id, value]) => [
          id,
          { id: value?.id ?? id, name: value?.name ?? id }
        ])
      );

      const connected = Array.isArray(data.connected)
        ? data.connected.filter((entry): entry is string => typeof entry === 'string')
        : [];

      const modelCount = Object.values(providersRecord).reduce((total, value) => {
        const models = (value as { models?: Record<string, unknown> } | undefined)?.models;
        return total + (typeof models === 'object' && models !== null ? Object.keys(models).length : 0);
      }, 0);

      return { providers, connected, modelCount };
    }
  };
}
