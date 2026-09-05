/**
 * Shared Sites domain model.
 *
 * Sites are durable, versioned, multi-file static artifacts produced by the
 * agent. Unlike saved visuals (single ephemeral HTML blob rendered inline),
 * a site owns a file tree, an immutable version history, and a review gate
 * before it leaves the app.
 *
 * Everything in this module is pure so it can be unit tested without Electron
 * or SQLite.
 */

export const SITE_ENTRY_FILE = 'index.html';

export type SiteStatus = 'draft' | 'published' | 'unpublished' | 'deleted';

export type SiteVersionState =
  | 'draft'
  | 'building'
  | 'build_failed'
  | 'preview_ready'
  | 'published'
  | 'archived';

export type SiteExportFormat = 'folder' | 'zip';

/**
 * The confirmed runtime policy for Atlas sites.
 *
 * Atlas has no server runtime, so server-side code is denied outright rather
 * than left open. Network hosts are default-deny: anything reaching outside
 * the artifact is surfaced in the review checklist before the site can leave
 * the app.
 */
export type SiteRuntimePolicy = {
  allowServerCode: boolean;
  allowClientJs: boolean;
  allowedExtensions: readonly string[];
  allowedNetworkHosts: readonly string[];
  maxArtifactBytes: number;
  maxFileBytes: number;
  maxFileCount: number;
  maxPathLength: number;
};

export const ATLAS_SITE_POLICY: SiteRuntimePolicy = {
  allowServerCode: false,
  allowClientJs: true,
  allowedExtensions: [
    '.html',
    '.htm',
    '.css',
    '.js',
    '.mjs',
    '.json',
    '.svg',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.avif',
    '.ico',
    '.woff',
    '.woff2',
    '.txt',
    '.md',
    '.webmanifest',
  ],
  allowedNetworkHosts: [],
  maxArtifactBytes: 10_000_000,
  maxFileBytes: 4_000_000,
  maxFileCount: 200,
  maxPathLength: 200,
};

export type SiteViolationCode =
  | 'empty_artifact'
  | 'missing_entry'
  | 'invalid_path'
  | 'path_traversal'
  | 'unsupported_extension'
  | 'too_many_files'
  | 'file_too_large'
  | 'artifact_too_large'
  | 'server_code'
  | 'client_js_disabled'
  | 'external_resource';

export type SiteViolationSeverity = 'error' | 'warning';

export type SiteViolation = {
  code: SiteViolationCode;
  severity: SiteViolationSeverity;
  path: string | null;
  message: string;
};

export type SiteValidationResult = {
  ok: boolean;
  errors: SiteViolation[];
  warnings: SiteViolation[];
  totalBytes: number;
  fileCount: number;
};

export type SiteFileInput = {
  path: string;
  /** Text contents. Empty for binary assets — pass their size via byteSize. */
  contents: string;
  /** Authoritative size in bytes. Derived from `contents` when omitted. */
  byteSize?: number;
};

export type SiteFileMeta = {
  path: string;
  byteSize: number;
  mime: string;
  sha256: string;
};

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.txt',
  '.md',
  '.webmanifest',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** Patterns that indicate the artifact expects a server runtime Atlas cannot provide. */
const SERVER_CODE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brequire\s*\(\s*['"]node:/, label: "require('node:…')" },
  { pattern: /\brequire\s*\(\s*['"](fs|path|child_process|http|https|net|os|crypto)['"]\s*\)/, label: 'require of a Node builtin' },
  { pattern: /\bfrom\s+['"]node:/, label: "import from 'node:…'" },
  { pattern: /\bprocess\s*\.\s*env\b/, label: 'process.env' },
  { pattern: /\b__dirname\b|\b__filename\b/, label: '__dirname / __filename' },
  { pattern: /\bmodule\s*\.\s*exports\b/, label: 'module.exports' },
  { pattern: /\bexport\s+(default\s+)?async\s+function\s+(handler|GET|POST)\b/, label: 'server route handler' },
];

const SCRIPT_TAG_PATTERN = /<script\b[^>]*>|\bon[a-z]+\s*=\s*["']/i;

const EXTERNAL_URL_PATTERN = /\b(?:src|href|action|data-src)\s*=\s*["'](https?:\/\/[^"'>\s]+)["']/gi;
const CSS_EXTERNAL_URL_PATTERN = /url\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/gi;
const IMPORT_EXTERNAL_URL_PATTERN = /\b(?:import|fetch)\s*\(?\s*["'](https?:\/\/[^"']+)["']/gi;

export function getSiteFileExtension(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function getSiteMimeType(path: string): string {
  return MIME_BY_EXTENSION[getSiteFileExtension(path)] ?? 'application/octet-stream';
}

export function isTextSiteFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(getSiteFileExtension(path));
}

/**
 * Normalize a site-relative path.
 *
 * Returns null when the path escapes the site root or is otherwise unusable.
 * This is the single choke point for path safety: every write, read, delete,
 * and protocol-handler lookup must run through it.
 */
export function normalizeSitePath(input: string): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim();
  if (!value) return null;

  // Reject anything that could resolve outside the site root before we touch it.
  if (value.includes('\0')) return null;
  if (value.includes('\\')) return null;
  if (/^[a-zA-Z]:/.test(value)) return null;
  if (value.startsWith('//')) return null;

  value = value.replace(/^\.\//, '');
  value = value.replace(/^\/+/, '');
  if (!value) return null;

  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    if (segment.endsWith(' ') || segment.endsWith('.')) return null;
    segments.push(segment);
  }

  if (segments.length === 0) return null;

  const normalized = segments.join('/');
  if (normalized.length > ATLAS_SITE_POLICY.maxPathLength) return null;

  return normalized;
}

function violation(
  code: SiteViolationCode,
  severity: SiteViolationSeverity,
  path: string | null,
  message: string
): SiteViolation {
  return { code, severity, path, message };
}

function collectExternalHosts(contents: string): string[] {
  const hosts = new Set<string>();
  for (const pattern of [EXTERNAL_URL_PATTERN, CSS_EXTERNAL_URL_PATTERN, IMPORT_EXTERNAL_URL_PATTERN]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(contents);
    while (match) {
      try {
        hosts.add(new URL(match[1]).host);
      } catch {
        // Unparseable URL: not a host we can allowlist, ignore.
      }
      match = pattern.exec(contents);
    }
  }
  return [...hosts];
}

export function byteLengthOf(contents: string): number {
  return Buffer.byteLength(contents, 'utf8');
}

/**
 * Validate a complete site artifact against the runtime policy.
 *
 * Errors block preview and publish. Warnings do not block preview but must be
 * acknowledged in the review checklist before the site leaves the app.
 */
export function validateSiteArtifact(
  files: readonly SiteFileInput[],
  policy: SiteRuntimePolicy = ATLAS_SITE_POLICY
): SiteValidationResult {
  const errors: SiteViolation[] = [];
  const warnings: SiteViolation[] = [];
  let totalBytes = 0;

  if (files.length === 0) {
    errors.push(violation('empty_artifact', 'error', null, 'The site has no files.'));
    return { ok: false, errors, warnings, totalBytes: 0, fileCount: 0 };
  }

  if (files.length > policy.maxFileCount) {
    errors.push(
      violation(
        'too_many_files',
        'error',
        null,
        `The site has ${files.length} files, over the limit of ${policy.maxFileCount}.`
      )
    );
  }

  const seenPaths = new Set<string>();
  let hasEntry = false;

  for (const file of files) {
    const normalized = normalizeSitePath(file.path);
    if (!normalized) {
      errors.push(
        violation('path_traversal', 'error', file.path, `"${file.path}" is not a valid site path.`)
      );
      continue;
    }

    if (seenPaths.has(normalized)) {
      errors.push(violation('invalid_path', 'error', normalized, `Duplicate file path "${normalized}".`));
      continue;
    }
    seenPaths.add(normalized);

    if (normalized === SITE_ENTRY_FILE) hasEntry = true;

    const extension = getSiteFileExtension(normalized);
    if (!policy.allowedExtensions.includes(extension)) {
      errors.push(
        violation(
          'unsupported_extension',
          'error',
          normalized,
          `Unsupported file type "${extension || '(none)'}" — allowed: ${policy.allowedExtensions.join(', ')}.`
        )
      );
      continue;
    }

    const size = file.byteSize ?? byteLengthOf(file.contents);
    totalBytes += size;

    if (size > policy.maxFileBytes) {
      errors.push(
        violation(
          'file_too_large',
          'error',
          normalized,
          `"${normalized}" is ${size} bytes, over the per-file limit of ${policy.maxFileBytes}.`
        )
      );
    }

    if (!isTextSiteFile(normalized)) {
      // Binary assets carry no code to inspect.
      continue;
    }

    if (!policy.allowServerCode) {
      for (const { pattern, label } of SERVER_CODE_PATTERNS) {
        if (pattern.test(file.contents)) {
          errors.push(
            violation(
              'server_code',
              'error',
              normalized,
              `"${normalized}" uses ${label}. Atlas sites are static — there is no server runtime.`
            )
          );
          break;
        }
      }
    }

    if (!policy.allowClientJs && SCRIPT_TAG_PATTERN.test(file.contents)) {
      errors.push(
        violation('client_js_disabled', 'error', normalized, `"${normalized}" contains client-side script.`)
      );
    }

    for (const host of collectExternalHosts(file.contents)) {
      if (policy.allowedNetworkHosts.includes(host)) continue;
      warnings.push(
        violation(
          'external_resource',
          'warning',
          normalized,
          `"${normalized}" loads from ${host}. External resources break offline viewing and leak visits to that host.`
        )
      );
    }
  }

  if (!hasEntry) {
    errors.push(
      violation('missing_entry', 'error', null, `The site is missing its entry file "${SITE_ENTRY_FILE}".`)
    );
  }

  if (totalBytes > policy.maxArtifactBytes) {
    errors.push(
      violation(
        'artifact_too_large',
        'error',
        null,
        `The site is ${totalBytes} bytes, over the limit of ${policy.maxArtifactBytes}.`
      )
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    totalBytes,
    fileCount: seenPaths.size,
  };
}

/**
 * Content-Security-Policy served with every previewed site file.
 *
 * Mirrors the runtime policy: same-origin only, no framing by third parties,
 * no form submission off-origin. `unsafe-inline` is required because generated
 * sites routinely inline their styles and scripts.
 */
export function buildSitePreviewCsp(policy: SiteRuntimePolicy = ATLAS_SITE_POLICY): string {
  const connect = policy.allowedNetworkHosts.length
    ? `'self' ${policy.allowedNetworkHosts.map((host) => `https://${host}`).join(' ')}`
    : "'self'";

  return [
    "default-src 'self'",
    `script-src ${policy.allowClientJs ? "'self' 'unsafe-inline'" : "'none'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/* ------------------------------------------------------------------ *
 * Transport DTOs shared between main, preload, and renderer.
 * ------------------------------------------------------------------ */

export type SiteSummary = {
  id: string;
  title: string;
  slug: string;
  status: SiteStatus;
  draftVersionId: string | null;
  currentVersionId: string | null;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SiteVersionSummary = {
  id: string;
  siteId: string;
  versionNo: number;
  label: string | null;
  state: SiteVersionState;
  isDraft: boolean;
  fileCount: number;
  totalBytes: number;
  buildLog: string | null;
  validation: SiteValidationResult | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type SiteEventRecord = {
  id: string;
  siteId: string;
  versionId: string | null;
  eventType: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

export type SiteDetail = {
  site: SiteSummary;
  draft: SiteVersionSummary | null;
  current: SiteVersionSummary | null;
  versions: SiteVersionSummary[];
  files: SiteFileMeta[];
  events: SiteEventRecord[];
};

export type CreateSiteRequest = {
  title: string;
  sourceConversationId?: string | null;
  files?: SiteFileInput[];
};

export type WriteSiteFileRequest = {
  siteId: string;
  path: string;
  contents: string;
};

export type DeleteSiteFileRequest = {
  siteId: string;
  path: string;
};

export type ReadSiteFileRequest = {
  siteId: string;
  versionId?: string | null;
  path: string;
};

export type PublishSiteRequest = {
  siteId: string;
  label?: string | null;
  /** Warning codes the user explicitly acknowledged in the review checklist. */
  acknowledgedWarnings?: SiteViolationCode[];
};

export type RollbackSiteRequest = {
  siteId: string;
  versionId: string;
};

export type ExportSiteRequest = {
  siteId: string;
  versionId?: string | null;
  format: SiteExportFormat;
};

export type ExportSiteResult = {
  cancelled: boolean;
  destination: string | null;
  format: SiteExportFormat;
};

export type DetectedPackage = {
  name: string;
  category: "icons" | "styling" | "animation" | "components" | "utility";
  installed: boolean;
  version?: string;
};

export type WorkspaceProjectAnalysis = {
  projectRoot: string;
  projectTitle: string;
  packageJsonFound: boolean;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  defaultExportSubpath: string;
  detectedPackages: DetectedPackage[];
  missingPackages: string[];
  installCommand: string;
};

export type AnalyzeWorkspaceRequest = {
  siteId: string;
  versionId?: string | null;
  projectRoot: string;
};

export type ExportSiteToWorkspaceRequest = {
  siteId: string;
  versionId?: string | null;
  projectRoot: string;
  subpath: string;
};

export type ExportSiteToWorkspaceResult = {
  destination: string;
  writtenFiles: string[];
  totalBytes: number;
};

export type OpenSitePreviewRequest = {
  siteId: string;
  versionId?: string | null;
};

export type SitePreviewTarget = {
  url: string;
  siteId: string;
  versionId: string;
};

/**
 * The pre-publish review checklist. Publishing is blocked while any error
 * remains, or while an unacknowledged warning remains.
 */
export type SiteReviewChecklist = {
  siteId: string;
  versionId: string;
  validation: SiteValidationResult;
  hasEntryFile: boolean;
  fileCount: number;
  totalBytes: number;
  externalHosts: string[];
  canPublish: boolean;
  blockingReasons: string[];
};

export function slugifySiteTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'untitled-site';
}
