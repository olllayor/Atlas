/**
 * Where an installed bundle came from.
 *
 * Nothing else records this. A bundle on disk is just a directory: it carries a
 * name and a version, and no trace of the catalogue that handed it over. Two
 * features need that trace and neither can be built without it — an update has
 * to know which entry to re-fetch, and a scoped revocation has to know whether
 * `foo@some-market` is the `foo` that is actually installed.
 *
 * Kept beside the plugins rather than inside them: a bundle must not be able to
 * describe its own provenance, and rewriting a file inside a validated bundle
 * after the fact would undo the point of validating what landed.
 */

import type { ConnectorDeclarationRecord } from '../../shared/pluginConnectors';

export type PluginOrigin = {
  /** The marketplace it was installed from, or `null` for a folder install. */
  marketplace: string | null;
  /** The catalogue entry name, which may differ from the manifest name. */
  entry: string | null;
  /** The manifest version at install time, for the update comparison. */
  version: string | null;
  /** The commit installed, when the entry was pinned to one. */
  sha: string | null;
  /**
   * The repository a URL install came from. `null` for every other path.
   *
   * Recorded so a plugin installed by pasting a link is still updatable. Without
   * it a URL install would be provenance-less the way a folder install is, and
   * "install it again by hand to get the fix" is not an update story.
   */
  url: string | null;
  /** The ref and subdirectory the URL named, so a re-fetch resolves the same way. */
  ref: string | null;
  subdir: string | null;
  /**
   * Connector declarations seen when the bundle was inspected.
   *
   * Kept even though nothing acts on them. A connector-only bundle is refused
   * at install and leaves no other trace, so "why did this not install" becomes
   * unanswerable without it. The timestamp is the *inspection*, which differs
   * from the install for a bundle that was looked at and declined.
   */
  connectors: ConnectorDeclarationRecord | null;
  installedAt: string;
};

export type PluginOriginRecords = Record<string, PluginOrigin>;

/**
 * Reads and writes provenance.
 *
 * Constructed with accessors rather than a repository, like
 * `PluginActivationStore`: the tests build one over a plain object, and the
 * store has no business knowing there is a database.
 */
export class PluginOriginStore {
  constructor(
    private readonly read: () => PluginOriginRecords,
    private readonly write: (value: PluginOriginRecords) => void
  ) {}

  all(): PluginOriginRecords {
    const stored = this.read();
    const records: PluginOriginRecords = {};

    for (const [name, value] of Object.entries(stored)) {
      const origin = normalize(value);

      if (origin) {
        records[name] = origin;
      }
    }

    return records;
  }

  get(name: string): PluginOrigin | null {
    return this.all()[name] ?? null;
  }

  record(name: string, origin: Omit<PluginOrigin, 'installedAt'> & { installedAt?: string }): void {
    this.write({
      ...this.all(),
      [name]: {
        marketplace: origin.marketplace,
        entry: origin.entry,
        version: origin.version,
        sha: origin.sha,
        url: origin.url,
        ref: origin.ref,
        subdir: origin.subdir,
        connectors: origin.connectors ?? null,
        installedAt: origin.installedAt ?? new Date().toISOString()
      }
    });
  }

  /**
   * Drops a plugin's provenance.
   *
   * Called on uninstall. Leaving it behind would mean a folder install later
   * inheriting the marketplace of whatever used to hold the name, which is
   * precisely the confusion a scoped revocation must not have.
   */
  forget(name: string): void {
    const records = this.all();

    if (!(name in records)) {
      return;
    }

    delete records[name];
    this.write(records);
  }
}

/** Tolerates whatever an older build, or a hand-edited file, left behind. */
function normalize(value: unknown): PluginOrigin | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    marketplace: text(record.marketplace),
    entry: text(record.entry),
    version: text(record.version),
    sha: text(record.sha),
    url: text(record.url),
    ref: text(record.ref),
    subdir: text(record.subdir),
    connectors: normalizeConnectors(record.connectors),
    installedAt: text(record.installedAt) ?? ''
  };
}

/** Tolerates an older record that predates connector inspection. */
function normalizeConnectors(value: unknown): ConnectorDeclarationRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const ids = Array.isArray(record.ids)
    ? record.ids.filter((id): id is string => typeof id === 'string')
    : [];

  return ids.length > 0
    ? { ids, version: text(record.version) ?? '', inspectedAt: text(record.inspectedAt) ?? '' }
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
