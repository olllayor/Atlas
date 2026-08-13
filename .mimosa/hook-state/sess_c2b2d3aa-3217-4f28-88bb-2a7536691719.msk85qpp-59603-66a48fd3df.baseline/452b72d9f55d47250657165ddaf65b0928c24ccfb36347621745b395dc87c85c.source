/**
 * `.app.json` — connector declarations, read and never acted on.
 *
 * A connector is not a remote MCP server, and conflating the two is the mistake
 * this module exists to prevent. An MCP server is an endpoint Atlas can reach
 * with a bearer token the user configured; a connector names an OAuth
 * integration that some *application* has already authorised, and the token is
 * supplied by that application rather than negotiated here. Atlas has no
 * connector broker, so it can read these declarations and it cannot honour one.
 *
 * The answer is to say so. 85% of the official catalogue ships an `.app.json`,
 * and a browser that stayed silent about them would describe those bundles as
 * offering nothing — when what is true is that they offer something Atlas
 * cannot yet perform. That is a different sentence, and the user is entitled to
 * it before they install.
 *
 * **Ground truth.** The vocabulary below was read off the seven `.app.json`
 * files in a real Codex install rather than inferred: every one is
 * `{ "apps": { "<key>": { "id", "required"?, "capabilities"?, "category"? } } }`
 * and nothing else. Notably there is **no scopes field** anywhere in the
 * format — a connector's scopes live with the authorising application, not in
 * the bundle — so this reports capabilities and declines to invent the rest.
 */

/**
 * Which family an id belongs to.
 *
 * `connector_*` is a first-party OAuth connector; `asdk_app_*` is an Apps SDK
 * application. Both are equally unreachable here, but they fail for different
 * reasons and a user debugging one benefits from knowing which they have.
 */
export type PluginConnectorKind = 'first-party-connector' | 'apps-sdk-app' | 'unknown';

export type PluginConnector = {
  /** The bundle's own key, e.g. `github`. */
  key: string;
  /** The opaque connector id. Never resolved, never used to fetch anything. */
  id: string;
  kind: PluginConnectorKind;
  /** Declared capabilities, e.g. `read`, `write`. Verbatim from the manifest. */
  capabilities: string[];
  category: string | null;
  /** True when the bundle says it cannot function without this connector. */
  required: boolean;
};

export type PluginConnectorResult =
  | { ok: true; connectors: PluginConnector[] }
  | { ok: false; error: string };

/** What Atlas tells the user about every connector it finds. */
export const CONNECTOR_UNAVAILABLE_NOTICE =
  'Requires account linking — Atlas cannot perform this yet.';

export function classifyConnectorId(id: string): PluginConnectorKind {
  if (id.startsWith('connector_')) {
    return 'first-party-connector';
  }

  if (id.startsWith('asdk_app_')) {
    return 'apps-sdk-app';
  }

  return 'unknown';
}

/**
 * Parses `.app.json`.
 *
 * Strictly declarative: this reads names and returns values. It creates no
 * OAuth state, resolves no id, contacts nothing, and stores no token — there is
 * nowhere in this module that could, which is the property worth keeping as the
 * file grows.
 *
 * Per-entry failure isolation, like `.mcp.json`: one malformed app costs that
 * app and nothing else, because a bundle's other declarations are still true.
 */
export function parsePluginConnectors(text: string): PluginConnectorResult {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `The connector configuration is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'The connector configuration must be a JSON object.' };
  }

  const container = (raw as Record<string, unknown>).apps;

  if (typeof container !== 'object' || container === null || Array.isArray(container)) {
    // Every observed file has exactly this key. A file without it declares no
    // connectors rather than being broken.
    return { ok: true, connectors: [] };
  }

  const connectors: PluginConnector[] = [];

  for (const [key, value] of Object.entries(container as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue;
    }

    const entry = value as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';

    // The id is the only field every observed entry carries, and the only one
    // that identifies anything. An entry without one names nothing.
    if (!id) {
      continue;
    }

    connectors.push({
      key,
      id,
      kind: classifyConnectorId(id),
      capabilities: Array.isArray(entry.capabilities)
        ? entry.capabilities.filter((item): item is string => typeof item === 'string')
        : [],
      category: typeof entry.category === 'string' && entry.category.trim() ? entry.category.trim() : null,
      required: entry.required === true
    });
  }

  return { ok: true, connectors };
}

/**
 * What is recorded in provenance when a bundle is inspected.
 *
 * Kept even though nothing acts on it: a connector-only bundle refused at
 * install leaves no other trace, and "why did this not install" is a question
 * worth being able to answer six months later. The timestamp is the inspection,
 * not the install — the two differ for a bundle that was looked at and declined.
 */
export type ConnectorDeclarationRecord = {
  /** Connector ids the bundle declared, in manifest order. */
  ids: string[];
  /** The bundle version those declarations came from. */
  version: string;
  /** ISO timestamp of the inspection that read them. */
  inspectedAt: string;
};

export function toConnectorDeclaration(
  connectors: PluginConnector[],
  version: string,
  inspectedAt: string
): ConnectorDeclarationRecord | null {
  return connectors.length > 0
    ? { ids: connectors.map((connector) => connector.id), version, inspectedAt }
    : null;
}
