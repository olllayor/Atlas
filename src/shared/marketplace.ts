import { isContainedPluginPath } from './plugins';

/**
 * Marketplace catalogue parsing.
 *
 * A marketplace is a directory or repository carrying one JSON file that lists
 * plugins and where each one lives. Like the manifest parser this is pure: it
 * decides what a catalogue *means*, and the registry decides what is actually
 * fetchable.
 *
 * Shapes here were taken from 17 real catalogues totalling 380 entries across
 * three installed agents, not from documentation.
 */

/**
 * Where a catalogue lives inside a marketplace, in probe order.
 *
 * Both conventions are live and a repository may carry both — the
 * `superpowers-dev` checkout does. `.agents` is preferred for the same reason
 * `.plugin` leads the manifest conventions: it is the vendor-neutral spelling.
 */
export const MARKETPLACE_CATALOG_PATHS = [
  '.agents/plugins/marketplace.json',
  '.claude-plugin/marketplace.json'
] as const;

/** Observed values. Anything else is treated as unavailable rather than guessed at. */
export type MarketplaceInstallPolicy = 'NOT_AVAILABLE' | 'AVAILABLE' | 'INSTALLED_BY_DEFAULT';

/**
 * When credentials are asked for.
 *
 * `ON_USE` is the token in the official spec and on disk. Third-party writing
 * calls it `ON_FIRST_USE`; that spelling appears in no catalogue.
 */
export type MarketplaceAuthPolicy = 'ON_INSTALL' | 'ON_USE';

export type MarketplaceSource =
  /** A directory inside the marketplace itself. The overwhelming majority. */
  | { kind: 'local'; path: string }
  /**
   * A git repository, optionally a subdirectory of one.
   *
   * `sha` is the pin and is what gets cloned; `ref` is the branch or tag the
   * publisher resolved it from and is part of the entry's identity — two
   * catalogue entries can differ only by `ref`. Fetching `ref` instead of `sha`
   * would mean the code installed today is not the code reviewed yesterday.
   */
  | { kind: 'git'; url: string; subdir: string | null; ref: string | null; sha: string | null }
  /**
   * A kind this build does not know how to fetch.
   *
   * Kept rather than dropped so the UI can say "this entry needs a newer Atlas"
   * instead of silently showing a shorter catalogue than the user expects.
   */
  | { kind: 'unsupported'; detail: string };

export type MarketplaceEntry = {
  name: string;
  source: MarketplaceSource;
  description: string | null;
  version: string | null;
  category: string | null;
  installPolicy: MarketplaceInstallPolicy;
  authPolicy: MarketplaceAuthPolicy;
  /**
   * `false` means the bundle ships no manifest and the catalogue is the only
   * description of it. Atlas refuses those — see `isInstallable`.
   */
  strict: boolean;
};

export type MarketplaceCatalog = {
  name: string;
  displayName: string | null;
  description: string | null;
  owner: string | null;
  entries: MarketplaceEntry[];
};

export type MarketplaceCatalogResult =
  | { ok: true; catalog: MarketplaceCatalog }
  | { ok: false; error: string };

const MAX_ENTRIES = 2_000;
const NAME_PATTERN = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i;

export function parseMarketplaceCatalog(text: string): MarketplaceCatalogResult {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `The catalogue is not valid JSON: ${messageOf(error)}` };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: 'The catalogue must be a JSON object.' };
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';

  if (!name || !NAME_PATTERN.test(name)) {
    // The marketplace name qualifies every install as `<plugin>@<marketplace>`,
    // so a value carrying a separator or whitespace would make that ambiguous.
    return { ok: false, error: 'The catalogue needs a usable "name".' };
  }

  // A repository that is itself one plugin describes it inline instead of
  // listing it: no `plugins` array, and the entry's fields sit at the top
  // level. Real bundles ship this, so pointing Atlas at a single-plugin repo
  // has to work.
  if (!Array.isArray(raw.plugins)) {
    const single = parseEntry(raw);

    if (single) {
      return {
        ok: true,
        catalog: { name, displayName: null, description: single.description, owner: null, entries: [single] }
      };
    }

    return { ok: false, error: 'The catalogue needs a "plugins" array.' };
  }

  const entries: MarketplaceEntry[] = [];
  const seen = new Set<string>();

  for (const value of raw.plugins.slice(0, MAX_ENTRIES)) {
    const entry = parseEntry(value);

    // A malformed entry is skipped rather than failing the catalogue: a
    // marketplace listing 278 plugins must not become unusable because one of
    // them is wrong.
    if (!entry || seen.has(entry.name)) {
      continue;
    }

    seen.add(entry.name);
    entries.push(entry);
  }

  return {
    ok: true,
    catalog: {
      name,
      displayName: stringOrNull(isRecord(raw.interface) ? raw.interface.displayName : null),
      description: stringOrNull(raw.description),
      owner: stringOrNull(isRecord(raw.owner) ? raw.owner.name : raw.owner),
      entries
    }
  };
}

function parseEntry(value: unknown): MarketplaceEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = typeof value.name === 'string' ? value.name.trim() : '';

  if (!name || !NAME_PATTERN.test(name)) {
    return null;
  }

  const policy = isRecord(value.policy) ? value.policy : {};

  return {
    name,
    source: parseSource(value.source),
    description: stringOrNull(value.description),
    version: stringOrNull(value.version),
    category: stringOrNull(value.category),
    installPolicy: parseInstallPolicy(policy.installation),
    authPolicy: policy.authentication === 'ON_USE' ? 'ON_USE' : 'ON_INSTALL',
    // Absent means strict. Only an explicit `false` opts out, and 10 of 380
    // observed entries carry the key at all.
    strict: value.strict !== false
  };
}

function parseSource(value: unknown): MarketplaceSource {
  // The bare-string shorthand, and `{source: "url", url: "./"}` alongside it.
  // Both mean "the marketplace directory is itself the plugin".
  if (typeof value === 'string') {
    return containedLocal(value) ?? { kind: 'unsupported', detail: value };
  }

  if (!isRecord(value)) {
    return { kind: 'unsupported', detail: 'no source' };
  }

  const kind = typeof value.source === 'string' ? value.source.trim().toLowerCase() : '';

  if (kind === 'local') {
    const path = typeof value.path === 'string' ? value.path : '';
    return containedLocal(path) ?? { kind: 'unsupported', detail: `local path "${path}"` };
  }

  if (kind === 'github') {
    // `owner/name` shorthand. Constrained tightly because it becomes part of a
    // clone URL, and anything looser could smuggle in a host.
    const repo = stringOrNull(value.repo);

    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return { kind: 'unsupported', detail: `github repo "${repo ?? ''}"` };
    }

    return {
      kind: 'git',
      url: `https://github.com/${repo}.git`,
      subdir: null,
      ref: null,
      // Spelled `commit` by this source kind; `sha` beside it identifies the
      // catalogue entry rather than the revision to fetch.
      sha: shaOrNull(value.commit)
    };
  }

  if (kind === 'url' || kind === 'git' || kind === 'git-subdir') {
    const url = stringOrNull(value.url);

    // A relative `url` is the repo-is-the-plugin shorthand, not an address.
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return containedLocal(url) ?? { kind: 'unsupported', detail: `relative url "${url}"` };
    }

    // Only https. A catalogue naming `git://` or `http://` would be asking to
    // fetch executable code over a channel nobody can authenticate.
    if (!url || !/^https:\/\//i.test(url)) {
      return { kind: 'unsupported', detail: url ? `insecure url "${url}"` : 'url with no address' };
    }

    const subdir = typeof value.path === 'string' ? value.path.trim() : '';

    if (subdir && !isContainedPluginPath(subdir)) {
      return { kind: 'unsupported', detail: `subdirectory "${subdir}"` };
    }

    return {
      kind: 'git',
      url,
      subdir: subdir || null,
      ref: stringOrNull(value.ref),
      sha: shaOrNull(value.sha)
    };
  }

  return { kind: 'unsupported', detail: kind || 'unknown source' };
}

/** A git object name, or nothing. Anything else would end up on a command line. */
function shaOrNull(value: unknown): string | null {
  const sha = stringOrNull(value);
  return sha && /^[0-9a-f]{7,64}$/i.test(sha) ? sha : null;
}

/** A local source may only name somewhere inside the marketplace. */
function containedLocal(path: string): MarketplaceSource | null {
  const trimmed = path.trim();
  return trimmed && isContainedPluginPath(trimmed) ? { kind: 'local', path: trimmed } : null;
}

function parseInstallPolicy(value: unknown): MarketplaceInstallPolicy {
  return value === 'NOT_AVAILABLE' || value === 'INSTALLED_BY_DEFAULT' || value === 'AVAILABLE'
    ? value
    : 'AVAILABLE';
}

/**
 * Whether Atlas will install an entry, and why not when it will not.
 *
 * `strict: false` is refused on purpose. Those bundles ship no manifest at all
 * — name, version and components come from the catalogue instead — which means
 * the thing describing the code and the thing shipping it are no longer the
 * same artifact. Every safety property here rests on the manifest travelling
 * with the bundle it describes.
 */
export function marketplaceEntryBlocker(entry: MarketplaceEntry): string | null {
  if (entry.installPolicy === 'NOT_AVAILABLE') {
    return 'This marketplace has marked the plugin unavailable.';
  }

  if (!entry.strict) {
    return 'This plugin ships no manifest of its own, so Atlas cannot verify what it contains.';
  }

  if (entry.source.kind === 'unsupported') {
    return `Atlas cannot fetch this plugin (${entry.source.detail}).`;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
