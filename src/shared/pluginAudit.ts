/**
 * What a plugin did, recorded so it can be answered for later.
 *
 * Three properties hold this together, and each is a decision rather than an
 * implementation detail:
 *
 * **Observational.** Nothing here can change what runs. The audit layer is
 * handed values that have already been decided — the approval stance, the
 * arguments, the result — and its only output is a record. It cannot deny a
 * call, cannot widen one, and is never consulted by the approval path. A log
 * that could veto would be a second permission system with none of the first
 * one's visibility.
 *
 * **Redaction is structural.** Secrets are found by *where they are*, not by
 * what they look like: a curated set of sensitive field names, recursively
 * through nested objects, plus exact-value matching against secrets whose
 * provenance is already known (a resolved `bearerTokenEnvVar`, a value the
 * bundle's `env` supplied). Shape-matching for token-like strings is a
 * secondary net, never the mechanism — it both misses (a short API key) and
 * over-redacts (a git SHA, a base64 thumbnail), and a redactor that cries wolf
 * gets read as noise.
 *
 * **Limits apply after redaction and before storage.** The order matters: cap
 * first and a secret can survive inside a truncated prefix. There is no
 * fallback path that stores an oversized raw payload — a record too large to
 * hold is stored truncated with metadata saying so, never stored whole
 * "just this once".
 *
 * Pure: no filesystem, no clock, no storage. Callers supply the timestamp so
 * the record is reproducible in a test.
 */

/* ------------------------------------------------------------------ *
 * Redaction
 * ------------------------------------------------------------------ */

/**
 * Field names whose values are credentials by definition.
 *
 * Curated rather than broad. `key` alone is deliberately absent: it is the most
 * common field name in the world — a map key, a cache key, a sort key — and
 * redacting it would gut the diagnostic value of nearly every record while
 * catching almost nothing a more specific name does not already.
 */
const SENSITIVE_FIELD_NAMES = new Set([
  'access_token',
  'accesstoken',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'client_secret',
  'clientsecret',
  'cookie',
  'credential',
  'credentials',
  'id_token',
  'password',
  'passwd',
  'private_key',
  'privatekey',
  'refresh_token',
  'refreshtoken',
  'secret',
  'session_token',
  'sessiontoken',
  'signature',
  'token'
]);

/** Why a value was replaced. Kept on the record so an audit stays diagnostic. */
export type RedactionReason = 'sensitive-field' | 'known-secret' | 'token-like';

/**
 * What replaces a redacted value.
 *
 * Deliberately not a bare `"[redacted]"` string. An auditor needs to know that
 * a field was present, what type it held, and roughly how big it was — "the
 * token argument was a 64-character string" answers questions that a missing
 * key cannot. The marker also survives round-tripping through JSON, so a stored
 * record can be told apart from one that never had the field.
 */
export type RedactedValue = {
  __redacted: true;
  reason: RedactionReason;
  /** The `typeof` of what was removed, so the shape of the call is still legible. */
  type: string;
  /** Character length for strings; absent for other types. */
  length?: number;
};

export function isRedactedValue(value: unknown): value is RedactedValue {
  return typeof value === 'object' && value !== null && (value as RedactedValue).__redacted === true;
}

function redactionMarker(value: unknown, reason: RedactionReason): RedactedValue {
  return {
    __redacted: true,
    reason,
    type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    ...(typeof value === 'string' ? { length: value.length } : {})
  };
}

/**
 * Whether a string looks like a credential.
 *
 * The secondary net, and scoped tightly on purpose. Only three shapes: a JWT, a
 * recognised vendor prefix, and a long unbroken high-entropy run. A git SHA
 * (40 hex) and a base64 image both fail these deliberately — the first is
 * something an audit wants to keep, and the second is handled by the size cap
 * rather than by pretending it is a secret.
 */
function looksLikeSecret(value: string): boolean {
  if (/^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(value)) {
    return true;
  }

  if (/^(sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[abposr])[-_][A-Za-z0-9_-]{16,}$/.test(value)) {
    return true;
  }

  // A long run with no separators and mixed classes. Hex-only is excluded so a
  // commit SHA survives, which is a value audits are read for.
  return (
    value.length >= 40 &&
    !/\s/.test(value) &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    !/^[0-9a-f]+$/i.test(value)
  );
}

export type RedactionOptions = {
  /**
   * Values already known to be secret, by provenance.
   *
   * The primary mechanism for anything the bundle supplied: a resolved bearer
   * token or an `env` value is a secret because of *where it came from*, and
   * matching it exactly catches it wherever a server echoes it back — including
   * places no field name would suggest.
   */
  knownSecrets?: readonly string[];
};

/**
 * Replaces secrets in a value, recursively.
 *
 * Order is primary-mechanism-first: a known secret value, then a sensitive
 * field name, then the shape heuristic. That ordering is what keeps the
 * `reason` on the marker honest — a token caught by provenance says so, rather
 * than being attributed to a lucky regex.
 */
export function redactForAudit(value: unknown, options: RedactionOptions = {}): unknown {
  // Short values are excluded from exact matching: an empty or one-character
  // "secret" would redact every occurrence of that character in the payload.
  const secrets = (options.knownSecrets ?? []).filter((secret) => secret.length >= 8);

  function walk(node: unknown, fieldName: string | null, depth: number): unknown {
    // A cycle or a pathologically nested payload must not become a stack
    // overflow inside the logging path, which would turn an audit into an
    // outage.
    if (depth > 12) {
      return redactionMarker(node, 'sensitive-field');
    }

    if (typeof node === 'string') {
      if (secrets.some((secret) => node.includes(secret))) {
        return redactionMarker(node, 'known-secret');
      }

      if (fieldName && SENSITIVE_FIELD_NAMES.has(fieldName.toLowerCase())) {
        return redactionMarker(node, 'sensitive-field');
      }

      return looksLikeSecret(node) ? redactionMarker(node, 'token-like') : node;
    }

    // A sensitive *name* redacts whatever it holds, not only strings: an
    // `authorization: { scheme, value }` object is still a credential.
    if (fieldName && SENSITIVE_FIELD_NAMES.has(fieldName.toLowerCase()) && node !== null && typeof node === 'object') {
      return redactionMarker(node, 'sensitive-field');
    }

    if (Array.isArray(node)) {
      // Elements inherit the array's field name: `tokens: [...]` is a list of
      // tokens, and the index is not a name of its own.
      return node.map((item) => walk(item, fieldName, depth + 1));
    }

    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, item]) => [
          key,
          walk(item, key, depth + 1)
        ])
      );
    }

    return node;
  }

  return walk(value, null, 0);
}

/* ------------------------------------------------------------------ *
 * Size limits
 * ------------------------------------------------------------------ */

/** Per-payload ceiling. A record is evidence, not a copy of the data. */
export const AUDIT_PAYLOAD_MAX_BYTES = 8 * 1024;

/** Ceiling on one string inside a payload, so one field cannot eat the budget. */
const AUDIT_STRING_MAX_CHARS = 1024;

/**
 * What was dropped to fit, stated rather than implied.
 *
 * A record that was silently shortened is worse than no record: it reads as
 * complete. `fields` names what lost content so an auditor knows where to go
 * looking for the rest.
 */
export type AuditTruncation = {
  originalBytes: number;
  storedBytes: number;
  /** Field names whose contents were shortened, in encounter order. */
  fields: string[];
};

export type CappedPayload = {
  value: unknown;
  /** Absent when the payload fitted whole. */
  truncation: AuditTruncation | null;
};

function byteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 0 : Buffer.byteLength(json, 'utf8');
  } catch {
    // A cycle or a BigInt. Reported as unmeasurable rather than crashing the
    // logging path.
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Bounds a payload for storage.
 *
 * **Called after `redactForAudit`, never before.** Capping first would let a
 * secret survive inside a truncated prefix — the redactor would then be handed
 * a string it can no longer recognise, and the surviving fragment is stored
 * forever. The ordering is the whole safety argument, which is why it is stated
 * here and asserted in the tests.
 *
 * There is no path that returns the original payload when it does not fit. An
 * oversized record is stored truncated with metadata; it is never stored whole
 * as a fallback.
 */
export function capForAudit(value: unknown, budget = AUDIT_PAYLOAD_MAX_BYTES): CappedPayload {
  const originalBytes = byteLength(value);

  if (originalBytes <= budget) {
    return { value, truncation: null };
  }

  const fields: string[] = [];

  function shrink(node: unknown, fieldName: string | null, depth: number): unknown {
    if (depth > 12) {
      return null;
    }

    if (typeof node === 'string' && node.length > AUDIT_STRING_MAX_CHARS) {
      fields.push(fieldName ?? '(root)');
      return `${node.slice(0, AUDIT_STRING_MAX_CHARS)}…`;
    }

    if (Array.isArray(node)) {
      const kept = node.slice(0, 50);

      if (kept.length < node.length) {
        fields.push(fieldName ?? '(root)');
      }

      return kept.map((item) => shrink(item, fieldName, depth + 1));
    }

    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, item]) => [
          key,
          shrink(item, key, depth + 1)
        ])
      );
    }

    return node;
  }

  let shrunk = shrink(value, null, 0);
  let storedBytes = byteLength(shrunk);

  // Still over after per-field shrinking — a payload made of thousands of small
  // fields. Replaced wholesale rather than left oversized: the metadata below
  // still says what was there.
  if (storedBytes > budget) {
    shrunk = { __truncated: true, note: 'Payload exceeded the audit budget and was not stored.' };
    storedBytes = byteLength(shrunk);
  }

  return {
    value: shrunk,
    truncation: {
      originalBytes: Number.isFinite(originalBytes) ? originalBytes : -1,
      storedBytes,
      fields: [...new Set(fields)]
    }
  };
}

/* ------------------------------------------------------------------ *
 * The record
 * ------------------------------------------------------------------ */

export type PluginAuditEventType =
  | 'mcp_list_tools'
  | 'approval_requested'
  | 'approval_responded'
  | 'mcp_call'
  | 'plugin_invocation';

export type PluginAuditOutcome = 'ok' | 'error' | 'denied' | 'cancelled';

/**
 * One line of the plugin audit trail.
 *
 * Keyed on `requestId` rather than a message id, because that is the identifier
 * that exists for the whole life of a turn: an assistant message row is not
 * written until the turn finishes, so anything recorded before then would have
 * no message to point at.
 */
export type PluginAuditRecord = {
  id: string;
  /** The durable join key. Present on every record without exception. */
  requestId: string;
  conversationId: string;
  type: PluginAuditEventType;
  /** ISO 8601, supplied by the caller so records are reproducible in tests. */
  at: string;
  /**
   * Who the data went to or came from.
   *
   * The configured server name — `<plugin>/<server-key>` — plus the endpoint
   * for an HTTP transport. Null for records that touched no server, such as an
   * invocation announcement.
   */
  server: { name: string; transport: string; endpoint: string | null } | null;
  /** Which bundle, and at which version. Captured when the record is made. */
  plugin: { name: string; version: string | null } | null;
  /** The tool as the model named it, for call and approval records. */
  tool: string | null;
  outcome: PluginAuditOutcome;
  /**
   * Ties an approval request to its response, and both to the call they gated.
   *
   * Without it a transcript shows an approval and a call with no way to prove
   * they were the same decision.
   */
  approvalId: string | null;
  toolCallId: string | null;
  /** Redacted and capped. See `redactForAudit` and `capForAudit`. */
  payload: unknown;
  truncation: AuditTruncation | null;
  /** One sentence when the outcome is not `ok`. */
  detail: string | null;
};

/**
 * Builds a record with redaction and capping applied, in that order.
 *
 * The single entry point on purpose: a caller that assembled a record by hand
 * could get the order wrong, and getting it wrong is the one mistake in this
 * module that loses a secret rather than merely losing detail.
 */
export function buildAuditRecord(
  input: Omit<PluginAuditRecord, 'payload' | 'truncation'> & {
    payload?: unknown;
    knownSecrets?: readonly string[];
  }
): PluginAuditRecord {
  const { payload, knownSecrets, ...rest } = input;

  if (payload === undefined) {
    return { ...rest, payload: undefined, truncation: null };
  }

  const redacted = redactForAudit(payload, { knownSecrets });
  const capped = capForAudit(redacted);

  return { ...rest, payload: capped.value, truncation: capped.truncation };
}
