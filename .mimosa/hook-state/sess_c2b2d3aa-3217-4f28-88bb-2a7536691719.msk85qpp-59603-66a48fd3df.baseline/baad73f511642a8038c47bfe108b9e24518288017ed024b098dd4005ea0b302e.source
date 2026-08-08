/**
 * Revocation.
 *
 * Atlas installs third-party code, so it needs a way to un-trust it after the
 * fact. A blocklist is one JSON file, published beside a marketplace catalogue,
 * naming plugins that must stop running — a bundle whose maintainer lost their
 * account, one that shipped a credential stealer, one that simply broke.
 *
 * Pure, like the catalogue parser beside it: this decides what a blocklist
 * *means*, and the registry decides whose blocklist is allowed to say it.
 */

/**
 * Where a blocklist lives inside a marketplace, in probe order.
 *
 * The same three directories as `MARKETPLACE_CATALOG_PATHS` and for the same
 * reason: a marketplace that publishes a catalogue Atlas can read publishes its
 * revocations in the same place.
 */
export const BLOCKLIST_PATHS = [
  '.atlas/plugins/blocklist.json',
  '.agents/plugins/blocklist.json',
  '.claude-plugin/blocklist.json'
] as const;

/**
 * Why a plugin was revoked.
 *
 * `security` is the only value that changes anything: it is the one that must
 * not be dismissible, because the user is not in a position to judge whether
 * the credential-stealing version is the one they have. Everything else is
 * modelled so a reason can be shown, not so it can be acted on differently.
 */
export type BlocklistReason = 'security' | 'malware' | 'broken' | 'deprecated' | 'other';

export type BlocklistEntry = {
  /** The plugin's manifest name. */
  plugin: string;
  /**
   * The marketplace the revocation is scoped to, or `null` for any.
   *
   * Written as the `@marketplace` half of the upstream `<plugin>@<marketplace>`
   * key. A bare `<plugin>` means the publisher is naming the code rather than
   * one distribution of it.
   */
  marketplace: string | null;
  reason: BlocklistReason;
  /** Free text from the publisher. Untrusted, display-only. */
  detail: string | null;
  /**
   * The newest version the revocation covers, inclusive, or `null` for all.
   *
   * A publisher who has already shipped the fix wants to revoke what came
   * before it, not their own remedy. Absent means every version, which is the
   * safe reading of a file that only says "this plugin".
   */
  maxVersion: string | null;
};

export type Blocklist = { entries: BlocklistEntry[] };

export const EMPTY_BLOCKLIST: Blocklist = { entries: [] };

export type BlocklistResult = { ok: true; blocklist: Blocklist } | { ok: false; error: string };

const MAX_ENTRIES = 2_000;
const MAX_DETAIL_LENGTH = 512;
const NAME_PATTERN = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i;

/**
 * Parses a blocklist.
 *
 * Two shapes are accepted, because upstream publishes one and an array is the
 * obvious thing to write by hand:
 *
 * ```json
 * { "plugins": { "foo@some-market": { "reason": "security" } } }
 * { "blocked": [ { "plugin": "foo", "marketplace": "some-market", "reason": "security" } ] }
 * ```
 *
 * A malformed entry is skipped rather than failing the file. The alternative is
 * that one bad line disarms every other revocation in it, which is the failure
 * mode a blocklist can least afford.
 */
export function parseBlocklist(text: string): BlocklistResult {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `The blocklist is not valid JSON: ${messageOf(error)}` };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: 'The blocklist must be a JSON object.' };
  }

  const entries: BlocklistEntry[] = [];

  if (isRecord(raw.plugins)) {
    for (const [key, value] of Object.entries(raw.plugins).slice(0, MAX_ENTRIES)) {
      const entry = parseKeyedEntry(key, value);

      if (entry) {
        entries.push(entry);
      }
    }
  }

  const listed = Array.isArray(raw.blocked)
    ? raw.blocked
    : Array.isArray(raw.plugins)
      ? raw.plugins
      : [];

  for (const value of listed.slice(0, MAX_ENTRIES)) {
    const entry = parseListedEntry(value);

    if (entry) {
      entries.push(entry);
    }
  }

  return { ok: true, blocklist: { entries } };
}

/** `<plugin>@<marketplace>` or a bare `<plugin>`, mapped to its detail object. */
function parseKeyedEntry(key: string, value: unknown): BlocklistEntry | null {
  const at = key.lastIndexOf('@');
  const plugin = (at > 0 ? key.slice(0, at) : key).trim();
  const marketplace = at > 0 ? key.slice(at + 1).trim() : '';

  if (!NAME_PATTERN.test(plugin) || (marketplace && !NAME_PATTERN.test(marketplace))) {
    return null;
  }

  const detail = isRecord(value) ? value : {};

  return {
    plugin,
    marketplace: marketplace || null,
    reason: parseReason(detail.reason),
    detail: text(detail.detail ?? detail.message ?? detail.description),
    maxVersion: text(detail.maxVersion ?? detail.max_version ?? detail.upTo)
  };
}

function parseListedEntry(value: unknown): BlocklistEntry | null {
  if (typeof value === 'string') {
    return parseKeyedEntry(value, {});
  }

  if (!isRecord(value)) {
    return null;
  }

  // A list entry may still carry the combined key rather than split fields;
  // both spellings appear in hand-written files.
  const combined = text(value.id ?? value.key);

  if (combined && !text(value.plugin) && !text(value.name)) {
    return parseKeyedEntry(combined, value);
  }

  const plugin = text(value.plugin ?? value.name);
  const marketplace = text(value.marketplace ?? value.source);

  if (!plugin || !NAME_PATTERN.test(plugin)) {
    return null;
  }

  return {
    plugin,
    marketplace: marketplace && NAME_PATTERN.test(marketplace) ? marketplace : null,
    reason: parseReason(value.reason),
    detail: text(value.detail ?? value.message ?? value.description),
    maxVersion: text(value.maxVersion ?? value.max_version ?? value.upTo)
  };
}

function parseReason(value: unknown): BlocklistReason {
  const reason = typeof value === 'string' ? value.trim().toLowerCase() : '';

  return reason === 'security' ||
    reason === 'malware' ||
    reason === 'broken' ||
    reason === 'deprecated'
    ? reason
    : 'other';
}

/**
 * What to tell the user about a revocation.
 *
 * The publisher's own text is appended rather than substituted, so a blocklist
 * cannot phrase a security revocation as something reassuring. The first
 * sentence is always Atlas's.
 */
export function describeBlock(entry: BlocklistEntry): string {
  const headline =
    entry.reason === 'security' || entry.reason === 'malware'
      ? 'Withdrawn for security. Atlas will not run it.'
      : entry.reason === 'broken'
        ? 'Withdrawn by its publisher as broken. Atlas will not run it.'
        : 'Withdrawn by its publisher. Atlas will not run it.';

  return entry.detail ? `${headline} “${entry.detail.slice(0, MAX_DETAIL_LENGTH)}”` : headline;
}

/**
 * The revocation covering a plugin, or `null`.
 *
 * `origin` is the marketplace the copy on disk came from. Scoping only ever
 * excuses a copy *known* to have come from somewhere else: an unknown origin is
 * covered, because most unknowns are bundles installed before provenance was
 * recorded at all, and letting every one of those sit outside every revocation
 * would make the whole mechanism arrive empty. The cost is that a folder install
 * sharing a name with a revoked plugin is caught too, which is the right way for
 * this to be wrong — the bundle is still on disk, and the reason is on the row.
 */
export function findBlock(
  blocklist: Blocklist,
  plugin: { name: string; version: string | null; origin: string | null },
  compareVersions: (left: string, right: string) => number | null
): BlocklistEntry | null {
  for (const entry of blocklist.entries) {
    if (entry.plugin.toLowerCase() !== plugin.name.toLowerCase()) {
      continue;
    }

    if (
      entry.marketplace &&
      plugin.origin &&
      entry.marketplace.toLowerCase() !== plugin.origin.toLowerCase()
    ) {
      continue;
    }

    if (entry.maxVersion && plugin.version) {
      const order = compareVersions(plugin.version, entry.maxVersion);

      // An installed version newer than the ceiling is the fixed one. An
      // ordering this cannot compute leaves the revocation standing, because
      // "could not tell" is not a reason to keep running revoked code.
      if (order != null && order > 0) {
        continue;
      }
    }

    return entry;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
