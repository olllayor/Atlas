/**
 * Turning a link someone pasted into something Atlas can fetch.
 *
 * The Agent Plugins format made bundles portable; it said nothing about how a
 * person gets one. In practice they find it on a forge and copy what is in the
 * address bar, which is almost never a clone URL — it is a *browse* URL with a
 * branch and a subdirectory baked into the path:
 *
 *   https://github.com/acme/tools/tree/main/plugins/kanban
 *
 * Asking a user to translate that into a repository, a ref and a subdirectory
 * by hand is asking them to know how git remotes work to install a plugin.
 * This module does the translation.
 *
 * Pure and forge-shaped rather than generic: the four hosts handled here cover
 * what people actually paste, and anything else falls through to "treat it as a
 * clone URL", which is correct for a self-hosted remote and honest about the
 * rest. No filesystem, no network — it decides what to fetch, never fetches.
 */

export type PluginUrlTarget = {
  /** What to clone. */
  url: string;
  /** Branch or tag, when the link named one. `null` means the default branch. */
  ref: string | null;
  /** Path within the repository, when the link pointed inside it. */
  subdir: string | null;
};

export type PluginUrlResult =
  | { ok: true; target: PluginUrlTarget }
  | { ok: false; error: string };

/**
 * Hosts whose browse URLs embed a ref and a path, and where in the path the
 * ref sits.
 *
 * GitHub and Gitea use `/tree/<ref>/<subdir>` after `owner/repo`; GitLab
 * interposes `/-/`; Bitbucket says `src` instead of `tree`. Each is two
 * segments of owner/repo followed by a marker, so one shape describes all four.
 */
const BROWSE_MARKERS = ['tree', 'blob', 'src'];

/** Refused outright. A plugin is code, and these are not places to fetch it from. */
const REFUSED_PROTOCOLS = ['file:', 'ftp:', 'data:', 'javascript:'];

export function parsePluginUrl(input: string): PluginUrlResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: 'Enter a repository URL.' };
  }

  // `git@host:owner/repo.git` is not a URL and `new URL` will not parse it.
  // Rewritten rather than rejected: it is what a forge's "clone with SSH" button
  // hands you, so a user pasting it has done nothing wrong.
  const scp = /^(?:ssh:\/\/)?git@([^:/]+):(.+)$/.exec(trimmed);

  if (scp) {
    return { ok: true, target: { url: `https://${scp[1]}/${stripGitSuffix(scp[2])}`, ref: null, subdir: null } };
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `"${trimmed}" is not a URL.` };
  }

  if (REFUSED_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, error: `Atlas will not fetch a plugin over ${parsed.protocol.replace(':', '')}.` };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Use an https:// repository URL.' };
  }

  // Plaintext is a downgrade for every future fetch of this plugin, not just
  // the first: the URL is recorded as provenance and re-cloned on update.
  if (parsed.protocol === 'http:') {
    return { ok: false, error: 'Use https:// — Atlas will not fetch plugin code over plaintext HTTP.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Remove the credentials from the URL. Atlas does not store them.' };
  }

  const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (segments.length < 2) {
    return { ok: false, error: 'That URL does not name a repository.' };
  }

  const [owner, repo, marker, ...rest] = segments;
  const base = `${parsed.origin}/${owner}/${stripGitSuffix(repo)}`;

  // GitLab's `/-/` separator sits between the repo and the marker. Dropped here
  // so the same shape below handles it.
  const tail = marker === '-' ? rest : marker != null ? [marker, ...rest] : [];
  const [kind, ref, ...path] = tail;

  if (!kind) {
    return { ok: true, target: { url: base, ref: null, subdir: null } };
  }

  if (!BROWSE_MARKERS.includes(kind)) {
    // Something under the repo that is not a browse link — an issue, a release,
    // a pull request. Naming the repository is the useful answer rather than an
    // error, because that is the repository the user meant.
    return { ok: true, target: { url: base, ref: null, subdir: null } };
  }

  if (!ref) {
    return { ok: true, target: { url: base, ref: null, subdir: null } };
  }

  const subdir = path.join('/');

  // A containment check belongs here even though the path came from a URL:
  // `.../tree/main/../../etc` is a perfectly well-formed URL.
  if (subdir && !isContainedSubdir(subdir)) {
    return { ok: false, error: 'That link points outside the repository.' };
  }

  return { ok: true, target: { url: base, ref, subdir: subdir || null } };
}

/**
 * A short label for a target, for the confirmation.
 *
 * Built from the parsed pieces rather than echoing what was typed, so the user
 * confirms what Atlas will actually fetch — not the string they pasted, which
 * may have carried a fragment, a query, or a `.git` this dropped.
 */
export function describePluginUrl(target: PluginUrlTarget): string {
  const parts = [target.url];

  if (target.ref) {
    parts.push(`at ${target.ref}`);
  }

  if (target.subdir) {
    parts.push(`in ${target.subdir}`);
  }

  return parts.join(' ');
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/, '');
}

function isContainedSubdir(subdir: string): boolean {
  const segments = subdir.split('/');

  return !segments.some((segment) => segment === '..' || segment === '' || /^[A-Za-z]:/.test(segment));
}
