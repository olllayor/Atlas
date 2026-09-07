/**
 * Which markdown links are references to files in the project.
 *
 * A reply that says "the fix is in `[ChatWindow.tsx](src/renderer/components/ChatWindow.tsx:42)`"
 * is naming a place in the codebase, not linking to the web, and the transcript
 * renders it as a file chip rather than as a blue underlined URL. Deciding
 * which is which is pure string work, so it lives here where it can be tested
 * without a DOM.
 *
 * The bar for "this is a file" is deliberately high. A false positive turns an
 * ordinary link into something that looks clickable-into-the-editor and is not,
 * so a bare host (`example.com`), anything with a scheme, and anything carrying
 * a query or fragment are all rejected outright, and the extension must be one
 * a project actually contains.
 */

/**
 * Extensions that count as a file reference.
 *
 * An allowlist rather than a shape test: `notes.com` and `v1.2` both look like
 * `name.ext`, and neither is a file anyone wants a chip for.
 */
const FILE_EXTENSIONS = new Set([
  // TypeScript / JavaScript
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  // Web
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'svelte', 'vue', 'astro',
  // Data and config
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml', 'csv', 'tsv',
  'lock', 'gradle', 'properties', 'plist', 'conf', 'cfg',
  // Other languages
  'py', 'pyi', 'rb', 'rs', 'go', 'java', 'kt', 'kts', 'swift', 'm', 'mm', 'c', 'h',
  'cc', 'cpp', 'hpp', 'cs', 'php', 'ex', 'exs', 'erl', 'hs', 'lua', 'pl', 'r',
  'scala', 'clj', 'dart', 'zig', 'sql', 'proto', 'graphql', 'gql',
  // Shell and build
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'mk', 'cmake', 'dockerfile',
  // Docs and assets referenced in code review
  'md', 'mdx', 'txt', 'rst', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
  'snap', 'patch', 'diff',
]);

export type FileRef = {
  /** The path as written, without the `:line` suffix. */
  path: string;
  /** Directory prefix including its trailing separator, or `''`. */
  directory: string;
  /** The filename on its own. */
  name: string;
  /** Lowercased extension, for picking the badge. */
  extension: string;
  /** Line number when the reference carried one. */
  line: number | null;
};

/** Everything a URL can carry that a project-relative path cannot. */
const NON_PATH = /^[a-z][a-z0-9+.-]*:|^\/\/|[?#\s]/i;

/**
 * Parse a link target as a file reference, or return null.
 *
 * Accepts project-relative (`src/main/index.ts`) and absolute
 * (`/Users/me/app/src/main/index.ts`) paths, with an optional `:line` or
 * `:line:column` suffix — the same shapes agents write them in.
 */
export function parseFileRef(href: string): FileRef | null {
  const trimmed = href.trim();
  if (!trimmed || NON_PATH.test(trimmed)) return null;

  // `path:12` and `path:12:5` both mean line 12; the column is dropped because
  // nothing in the transcript can act on it.
  const located = /^(.*?):(\d+)(?::\d+)?$/.exec(trimmed);
  const path = located ? located[1] : trimmed;
  const line = located ? Number(located[2]) : null;

  if (!path || path.endsWith('/') || path.endsWith('\\')) return null;

  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = path.slice(cut + 1);
  const dot = name.lastIndexOf('.');

  // A leading dot is the whole name on a dotfile (`.gitignore`), not an
  // extension boundary.
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!FILE_EXTENSIONS.has(extension)) return null;

  return {
    path,
    directory: path.slice(0, cut + 1),
    name,
    extension,
    line,
  };
}

/**
 * The badge label for a file chip: two characters, because three sit wider
 * than the cap height of the text they run alongside and start to read as a
 * word rather than as a mark.
 */
export function fileRefBadge(extension: string): string {
  const collapsed: Record<string, string> = {
    tsx: 'TS',
    mts: 'TS',
    cts: 'TS',
    jsx: 'JS',
    mjs: 'JS',
    cjs: 'JS',
    yml: 'YM',
    yaml: 'YM',
    // `JS` is already JavaScript's mark, and braces are what JSON looks like.
    json: '{}',
    jsonc: '{}',
    json5: '{}',
    dockerfile: 'DK',
    markdown: 'MD',
  };

  return (collapsed[extension] ?? (extension.slice(0, 2) || '··')).toUpperCase();
}

/**
 * Fragment prefix that carries a file reference through the markdown
 * sanitizer.
 *
 * Streamdown's bundled `rehype-harden` (default config, no `defaultOrigin`)
 * cannot parse bare project-relative hrefs — exactly the `[Name](src/…)`
 * shape the model is asked to write — and replaces those links with a
 * `<span>text [blocked]</span>` before the transcript's anchor component ever
 * runs, so file chips never render (t3code never hits this: react-markdown +
 * rehype-sanitize keeps relative links and resolves them at render time).
 * Hash-only URLs pass hardening untouched, so the remark phase rewrites
 * file-ref hrefs into this fragment and the anchor decodes it back into a
 * chip. The encoded path never holds a literal colon (`encodeURIComponent`
 * escapes it), so the trailing `:line` split below is unambiguous.
 */
export const FILE_REF_HASH_PREFIX = '#atlas-file:';

/** `file://` URLs the model sometimes emits instead of a bare path. */
export function fileUrlToPath(href: string): string | null {
  const match = /^file:\/\/(?:localhost)?(\/[^?#]*)(?:[?#].*)?$/i.exec(href.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}

export function encodeFileRefHref(ref: Pick<FileRef, 'path' | 'line'>): string {
  return `${FILE_REF_HASH_PREFIX}${encodeURIComponent(ref.path)}${ref.line ? `:${ref.line}` : ''}`;
}

/** Inverse of `encodeFileRefHref`, re-validated through `parseFileRef`. */
export function decodeFileRefHash(href: string): FileRef | null {
  if (!href.startsWith(FILE_REF_HASH_PREFIX)) return null;
  const rest = href.slice(FILE_REF_HASH_PREFIX.length);
  const located = /^(.+?)(?::(\d+))?$/.exec(rest);
  if (!located) return null;
  let path: string;
  try {
    path = decodeURIComponent(located[1]!);
  } catch {
    return null;
  }
  const line = located[2] !== undefined ? Number(located[2]) : null;
  return parseFileRef(line !== null ? `${path}:${line}` : path);
}

/**
 * Rewrite one markdown link destination into a sanitizer-safe fragment when
 * it names a project file — directly (`src/…`, `/abs/…`, `name.ext`) or
 * wrapped in `file://`. Anything else returns null (leave the href alone).
 */
export function rewriteFileRefHref(href: string): string | null {
  const direct = parseFileRef(href);
  if (direct) return encodeFileRefHref(direct);
  const unwrapped = fileUrlToPath(href);
  if (unwrapped) {
    const ref = parseFileRef(unwrapped);
    if (ref) return encodeFileRefHref(ref);
  }
  return null;
}
