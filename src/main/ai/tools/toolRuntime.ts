import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { access, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

import { BoundedCommandOutput } from './commandOutputCap';
import type { ContainedFsFailure } from '../../security/containedFs';
import { containedRead, containedReadBuffer } from '../../security/containedFs';
import type { SandboxPolicy } from './sandbox';
import {
  buildSandboxedLaunch,
  deriveSandboxPolicy,
  detectSandboxMechanism,
  isLikelySandboxDenied,
  isSandboxWrapperFailure,
  markSandboxMechanismUnavailable,
  SANDBOX_DENIAL_HINT
} from './sandbox';
import type { ToolWorkspace } from './toolWorkspace';
import { resolveWorkspaceCwd } from './toolWorkspace';

const DEFAULT_READ_LIMIT = 2000;
const MAX_READ_LIMIT = 4000;
const DEFAULT_GREP_LIMIT = 250;
const MAX_GLOB_RESULTS = 100;
const MAX_WEB_RESULTS = 8;
const MAX_WEB_FETCH_CHARS = 20_000;
const MAX_BINARY_BASE64_BYTES = 256_000;
const MIN_USEFUL_FETCH_TEXT_CHARS = 280;

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
]);

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp'
]);

const READ_ONLY_BASH_BLOCKLIST = [
  /\brm\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmkdir\b/i,
  /\brmdir\b/i,
  /\btouch\b/i,
  /\bnpm\s+(install|publish|version)\b/i,
  /\bpnpm\s+(add|install|remove|publish|update)\b/i,
  /\byarn\s+(add|remove|install|set|upgrade)\b/i,
  /\bgit\s+(commit|push|reset|rebase|cherry-pick|merge|stash|apply|am|checkout)\b/i,
  /\bsudo\b/i,
  /\bcurl\b.*\|/i,
  /\bwget\b.*\|/i,
  /(^|[^<])>>?/,
  /\|\s*tee\b/i
];

type CommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  interrupted: boolean;
  /** Set only when the ingest cap dropped content; the text carries its own marker. */
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
};

function expandPath(value: string) {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2));
  }

  return value;
}

export function resolveAbsolutePath(filePath: string) {
  const normalized = expandPath(filePath.trim());

  if (!isAbsolute(normalized)) {
    throw new Error('Expected an absolute path.');
  }

  return resolve(normalized);
}

async function ensureReadableFile(filePath: string) {
  const fileStats = await stat(filePath);

  if (!fileStats.isFile()) {
    throw new Error('Path is not a file.');
  }

  await access(filePath, fsConstants.R_OK);
  return fileStats;
}

function looksBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  return sample.includes(0);
}

function toLineNumberedText(content: string, startLine: number) {
  const lines = content.split('\n');
  const width = String(startLine + Math.max(lines.length - 1, 0)).length;

  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, ' ')}\t${line}`)
    .join('\n');
}

function normalizeLineWindow(offset?: number, limit?: number) {
  const startLine = Math.max(1, Math.floor(offset ?? 1));
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit ?? DEFAULT_READ_LIMIT), MAX_READ_LIMIT));
  return { startLine, boundedLimit };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h\d|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

function renderNotebookContent(raw: string) {
  const notebook = JSON.parse(raw) as {
    cells?: Array<{
      cell_type?: string;
      source?: string[] | string;
    }>;
  };

  const rendered = (notebook.cells ?? [])
    .map((cell, index) => {
      const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source ?? '';
      return `# Cell ${index + 1} (${cell.cell_type ?? 'unknown'})\n${source}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');

  return rendered;
}

async function readTextLikeFile(filePath: string, raw: string, offset?: number, limit?: number) {
  const allLines = raw.split('\n');
  const totalLines = allLines.length;
  const { startLine, boundedLimit } = normalizeLineWindow(offset, limit);

  if (startLine > totalLines) {
    return {
      type: 'file_unchanged' as const,
      file: {
        filePath,
        content: '',
        numLines: 0,
        startLine,
        totalLines,
        originalSize: Buffer.byteLength(raw)
      }
    };
  }

  const endLine = Math.min(totalLines, startLine + boundedLimit - 1);
  const selected = allLines.slice(startLine - 1, endLine).join('\n');

  return {
    type: 'text' as const,
    file: {
      filePath,
      content: toLineNumberedText(selected, startLine),
      numLines: endLine - startLine + 1,
      startLine,
      totalLines,
      originalSize: Buffer.byteLength(raw)
    }
  };
}

/**
 * Read caps for the `read_file` tool. `read_file` intentionally takes any
 * absolute path on the user's machine — Atlas is a local-first client and
 * this is not a confinement boundary — but "any path" still has to survive a
 * FIFO that never yields a writer or a multi-gigabyte file, either of which
 * would otherwise stall or OOM the Electron main process on a plain
 * `readFile`. Text gets the tighter cap because it is quoted back to the
 * model at full fidelity; binary/PDF/image content is re-sliced down to
 * `MAX_BINARY_BASE64_BYTES` regardless, so the larger cap only bounds how
 * much is pulled off disk before that slice.
 */
const TEXT_READ_BYTE_CAP = 5 * 1024 * 1024;
const BINARY_READ_BYTE_CAP = 20 * 1024 * 1024;

function throwForContainedFailure(reason: ContainedFsFailure, filePath: string): never {
  switch (reason) {
    case 'not-found':
      throw new Error(`File not found: ${filePath}`);
    case 'not-regular-file':
      throw new Error('Path is not a file.');
    case 'outside-root':
      throw new Error(`Path is outside the allowed root: ${filePath}`);
    case 'disallowed-extension':
      throw new Error(`File extension is not allowed: ${filePath}`);
    case 'changed-during-read':
      throw new Error(`File changed on disk while it was being read: ${filePath}`);
    case 'invalid-path':
      throw new Error('Expected an absolute path.');
    case 'read-failed':
    default:
      throw new Error(`Failed to read file: ${filePath}`);
  }
}

export async function readToolExecute(input: {
  file_path: string;
  offset?: number;
  limit?: number;
  pages?: string;
}) {
  const filePath = resolveAbsolutePath(input.file_path);
  const fileStats = await ensureReadableFile(filePath);
  const extension = extname(filePath).toLowerCase();

  if (extension === '.ipynb') {
    const capped = containedRead({ path: filePath, byteCap: TEXT_READ_BYTE_CAP });
    if (!capped.ok) throwForContainedFailure(capped.reason, filePath);

    const rendered = renderNotebookContent(capped.contents);
    const result = await readTextLikeFile(filePath, rendered, input.offset, input.limit);
    return {
      ...result,
      type: result.type === 'text' ? 'notebook' : result.type,
      ...(capped.truncated ? { readTruncated: true } : {})
    };
  }

  if (extension === '.pdf' || IMAGE_EXTENSIONS.has(extension)) {
    const capped = containedReadBuffer({ path: filePath, byteCap: BINARY_READ_BYTE_CAP });
    if (!capped.ok) throwForContainedFailure(capped.reason, filePath);

    const bytes = capped.buffer.subarray(0, Math.min(capped.buffer.byteLength, MAX_BINARY_BASE64_BYTES));

    return {
      type: extension === '.pdf' ? 'pdf' as const : 'image' as const,
      file: {
        filePath,
        base64: bytes.toString('base64'),
        originalSize: fileStats.size,
        truncated: capped.truncated || capped.buffer.byteLength > bytes.byteLength,
        pagesRequested: input.pages
      }
    };
  }

  const capped = containedReadBuffer({ path: filePath, byteCap: TEXT_READ_BYTE_CAP });
  if (!capped.ok) throwForContainedFailure(capped.reason, filePath);

  const buffer = capped.buffer;
  const isText = TEXT_EXTENSIONS.has(extension) || !looksBinary(buffer);

  if (!isText) {
    const bytes = buffer.subarray(0, Math.min(buffer.byteLength, MAX_BINARY_BASE64_BYTES));
    return {
      type: 'file_unchanged' as const,
      file: {
        filePath,
        content: `Binary file (${extension || 'unknown'}) is not previewable as text.`,
        numLines: 0,
        startLine: 1,
        totalLines: 0,
        originalSize: fileStats.size,
        base64: bytes.toString('base64'),
        truncated: capped.truncated || buffer.byteLength > bytes.byteLength
      }
    };
  }

  // The cap can land mid multibyte-character; trim the partial tail rather
  // than let it decode to replacement characters the file never contained.
  const text = buffer.toString('utf8').replace(/�+$/u, '');
  const result = await readTextLikeFile(filePath, text, input.offset, input.limit);
  return capped.truncated ? { ...result, readTruncated: true } : result;
}

export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
    /** Per-stream ingest budget; defaults to COMMAND_OUTPUT_BYTE_BUDGET. */
    maxOutputBytes?: number;
  } = {}
) {
  return new Promise<CommandResult>((resolvePromise, reject) => {
    const combinedEnv = options.env ? { ...process.env, ...options.env } : process.env;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: combinedEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Each stream is budgeted on its own, so a noisy stderr cannot squeeze out
    // the stdout the model actually asked for. The decoders keep multi-byte
    // characters intact across chunk boundaries.
    const stdout = new BoundedCommandOutput(options.maxOutputBytes);
    const stderr = new BoundedCommandOutput(options.maxOutputBytes);
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let interrupted = false;
    let timeoutId: NodeJS.Timeout | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        interrupted = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout.write(typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk));
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr.write(typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk));
    });

    child.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      stdout.write(stdoutDecoder.end());
      stderr.write(stderrDecoder.end());

      resolvePromise({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code,
        interrupted,
        ...(stdout.truncated ? { stdoutTruncated: true as const } : {}),
        ...(stderr.truncated ? { stderrTruncated: true as const } : {})
      });
    });
  });
}

/**
 * Relative search paths resolve against the conversation's workspace, so
 * "search src/" means the attached project rather than wherever the Electron
 * binary was launched from.
 *
 * With no project attached there is no sensible default: searching the whole
 * home directory would take minutes and return mostly noise, so an omitted
 * path is an error the model can act on rather than a scan it has to wait out.
 */
function resolveSearchPath(value: string | undefined, workspace: ToolWorkspace | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    if (!workspace?.root) {
      throw new Error(
        'No project folder is attached, so there is no default search directory. Pass an explicit path.'
      );
    }

    return workspace.root;
  }

  const normalized = expandPath(trimmed);
  return isAbsolute(normalized) ? normalized : resolve(resolveWorkspaceCwd(workspace), normalized);
}

function maybeResolveResultPath(basePath: string, value: string) {
  return isAbsolute(value) ? value : resolve(basePath, value);
}

export async function grepToolExecute(input: {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-B'?: number;
  '-A'?: number;
  '-C'?: number;
  context?: number;
  '-n'?: boolean;
  '-i'?: boolean;
  type?: string;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
}, workspace?: ToolWorkspace) {
  const searchPath = resolveSearchPath(input.path, workspace);
  const outputMode = input.output_mode ?? 'files_with_matches';
  const headLimit = Math.max(0, Math.floor(input.head_limit ?? DEFAULT_GREP_LIMIT));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));

  const args = ['--hidden', '--glob', '!.git', '--glob', '!.svn', '--glob', '!.hg'];
  const context =
    input.context ??
    input['-C'] ??
    undefined;

  if (input.multiline) {
    args.push('-U');
  }

  if (input['-i']) {
    args.push('-i');
  }

  if (outputMode === 'files_with_matches') {
    args.push('-l');
  } else if (outputMode === 'count') {
    args.push('--count');
  } else if (input['-n'] !== false) {
    args.push('-n');
  }

  if (typeof context === 'number') {
    args.push('-C', String(Math.max(0, Math.floor(context))));
  } else {
    if (typeof input['-A'] === 'number') {
      args.push('-A', String(Math.max(0, Math.floor(input['-A']))));
    }

    if (typeof input['-B'] === 'number') {
      args.push('-B', String(Math.max(0, Math.floor(input['-B']))));
    }
  }

  if (input.glob?.trim()) {
    args.push('--glob', input.glob.trim());
  }

  if (input.type?.trim()) {
    args.push('--type', input.type.trim());
  }

  if (input.pattern.startsWith('-')) {
    args.push('-e', input.pattern);
  } else {
    args.push(input.pattern);
  }

  args.push(searchPath);

  // Deliberately unsandboxed: the argv is built here, not by the model, and
  // ripgrep only reads. Reads are unrestricted under every Atlas sandbox policy.
  const result = await runCommand('rg', args, { cwd: resolveWorkspaceCwd(workspace), timeoutMs: 30_000 });

  if (result.code !== 0 && result.code !== 1) {
    throw new Error(result.stderr.trim() || `ripgrep exited with code ${result.code ?? 'unknown'}.`);
  }

  const lines = result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const selectedLines = headLimit === 0 ? lines.slice(offset) : lines.slice(offset, offset + headLimit);

  if (outputMode === 'files_with_matches') {
    const filenames = selectedLines.map((line) => maybeResolveResultPath(searchPath, line));
    return {
      mode: outputMode,
      numFiles: filenames.length,
      filenames,
      appliedLimit: headLimit === 0 ? undefined : headLimit,
      appliedOffset: offset || undefined
    };
  }

  if (outputMode === 'count') {
    const numMatches = selectedLines.reduce((total, line) => {
      const countText = line.slice(line.lastIndexOf(':') + 1);
      const value = Number.parseInt(countText, 10);
      return Number.isFinite(value) ? total + value : total;
    }, 0);
    const filenames = selectedLines
      .map((line) => {
        const separator = line.lastIndexOf(':');
        return separator === -1 ? '' : maybeResolveResultPath(searchPath, line.slice(0, separator));
      })
      .filter(Boolean);

    return {
      mode: outputMode,
      numFiles: filenames.length,
      filenames,
      content: selectedLines.join('\n'),
      numMatches,
      appliedLimit: headLimit === 0 ? undefined : headLimit,
      appliedOffset: offset || undefined
    };
  }

  const filenames = Array.from(
    new Set(
      selectedLines
        .map((line) => {
          const separator = line.indexOf(':');
          return separator === -1 ? '' : maybeResolveResultPath(searchPath, line.slice(0, separator));
        })
        .filter(Boolean)
    )
  );

  return {
    mode: outputMode,
    numFiles: filenames.length,
    filenames,
    content: selectedLines.join('\n'),
    numLines: selectedLines.length,
    appliedLimit: headLimit === 0 ? undefined : headLimit,
    appliedOffset: offset || undefined
  };
}

export async function globToolExecute(input: {
  pattern: string;
  path?: string;
}, workspace?: ToolWorkspace) {
  const startedAt = Date.now();
  const searchPath = resolveSearchPath(input.path, workspace);
  const args = ['--files', '--hidden', '--glob', '!.git', '--glob', '!.svn', '--glob', '!.hg', '-g', input.pattern, searchPath];
  // Deliberately unsandboxed, for the same reason as grep_search above.
  const result = await runCommand('rg', args, { cwd: resolveWorkspaceCwd(workspace), timeoutMs: 30_000 });

  if (result.code !== 0 && result.code !== 1) {
    throw new Error(result.stderr.trim() || `rg --files exited with code ${result.code ?? 'unknown'}.`);
  }

  const absoluteFiles = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => maybeResolveResultPath(searchPath, line));

  const filesWithStats = await Promise.all(
    absoluteFiles.map(async (filename) => ({
      filename,
      modifiedAt: (await stat(filename)).mtimeMs
    }))
  );

  filesWithStats.sort((left, right) => right.modifiedAt - left.modifiedAt);

  return {
    durationMs: Date.now() - startedAt,
    numFiles: filesWithStats.length,
    filenames: filesWithStats.slice(0, MAX_GLOB_RESULTS).map((entry) => entry.filename),
    truncated: filesWithStats.length > MAX_GLOB_RESULTS
  };
}

function decodeDuckDuckGoUrl(rawUrl: string) {
  try {
    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const parsed = new URL(url, 'https://duckduckgo.com');
    const redirectUrl = parsed.searchParams.get('uddg');
    return redirectUrl ? decodeURIComponent(redirectUrl) : parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function fetchText(url: URL | string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'Atlas/0.1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      ...(init?.headers ?? {})
    }
  });

  return response;
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function stripTagsPreserveSpacing(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export async function webSearchToolExecute(input: {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}) {
  const startedAt = Date.now();
  const searchUrl = new URL('https://duckduckgo.com/html/');
  searchUrl.searchParams.set('q', input.query);

  const response = await fetchText(searchUrl);

  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}.`);
  }

  const html = await response.text();
  const blockPattern = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>?/gi;
  const allowed = new Set((input.allowed_domains ?? []).map((domain) => domain.replace(/^www\./, '').toLowerCase()));
  const blocked = new Set((input.blocked_domains ?? []).map((domain) => domain.replace(/^www\./, '').toLowerCase()));
  const seen = new Set<string>();
  const results: Array<{ title: string; url: string; snippet?: string }> = [];

  for (const blockMatch of html.matchAll(blockPattern)) {
    const block = blockMatch[1] ?? '';
    const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) {
      continue;
    }

    const url = decodeDuckDuckGoUrl(titleMatch[1] ?? '');
    const domain = extractDomain(url).toLowerCase();

    if (!domain || seen.has(url)) {
      continue;
    }

    if (allowed.size > 0 && !allowed.has(domain)) {
      continue;
    }

    if (blocked.has(domain)) {
      continue;
    }

    seen.add(url);
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = stripTagsPreserveSpacing(snippetMatch?.[1] ?? snippetMatch?.[2] ?? '');
    results.push({
      title: stripTagsPreserveSpacing(titleMatch[2] ?? '') || url,
      url,
      snippet: snippet || undefined
    });

    if (results.length >= MAX_WEB_RESULTS) {
      break;
    }
  }

  return {
    query: input.query,
    results,
    durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2))
  };
}

async function fetchViaJinaReader(url: string) {
  const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
  const response = await fetchText(jinaUrl);

  if (!response.ok) {
    throw new Error(`Jina reader failed with status ${response.status}.`);
  }

  return {
    response,
    text: await response.text()
  };
}

function scoreParagraph(paragraph: string, keywords: string[]) {
  const haystack = paragraph.toLowerCase();
  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function buildPromptKeywords(prompt: string) {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((word) => word.length >= 4)
    )
  ).slice(0, 12);
}

function extractRelevantText(text: string, prompt: string) {
  const normalized = text.trim();

  if (normalized.length <= MAX_WEB_FETCH_CHARS) {
    return normalized;
  }

  const keywords = buildPromptKeywords(prompt);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (keywords.length > 0) {
    const scored = paragraphs
      .map((paragraph) => ({
        paragraph,
        score: scoreParagraph(paragraph, keywords)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    const selected: string[] = [];
    let totalLength = 0;

    for (const entry of scored) {
      if (totalLength >= MAX_WEB_FETCH_CHARS) {
        break;
      }

      selected.push(entry.paragraph);
      totalLength += entry.paragraph.length + 2;
    }

    if (selected.length > 0) {
      return selected.join('\n\n').slice(0, MAX_WEB_FETCH_CHARS);
    }
  }

  return normalized.slice(0, MAX_WEB_FETCH_CHARS);
}

export async function webFetchToolExecute(input: {
  url: string;
  prompt: string;
}) {
  const startedAt = Date.now();
  const normalizedUrl = new URL(input.url);

  if (normalizedUrl.protocol === 'http:') {
    normalizedUrl.protocol = 'https:';
  }

  let response = await fetchText(normalizedUrl);
  const arrayBuffer = await response.arrayBuffer();
  let bytes = arrayBuffer.byteLength;
  let contentType = response.headers.get('content-type') ?? '';
  let extractedText = '';
  let fetchMode: 'direct' | 'jina-reader' = 'direct';

  if (contentType.includes('html')) {
    extractedText = stripHtml(Buffer.from(arrayBuffer).toString('utf8'));
  } else if (
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('javascript')
  ) {
    extractedText = Buffer.from(arrayBuffer).toString('utf8');
  } else {
    extractedText = `Fetched ${bytes} bytes from ${normalizedUrl.toString()}, but the response content type (${contentType || 'unknown'}) is not text-friendly.`;
  }

  const looksBlocked =
    response.status >= 400 ||
    extractedText.length < MIN_USEFUL_FETCH_TEXT_CHARS ||
    /enable javascript|access denied|captcha|verify you are human|attention required/i.test(extractedText);

  if (looksBlocked) {
    try {
      const fallback = await fetchViaJinaReader(normalizedUrl.toString());
      response = fallback.response;
      bytes = Buffer.byteLength(fallback.text, 'utf8');
      contentType = response.headers.get('content-type') ?? 'text/plain';
      extractedText = fallback.text;
      fetchMode = 'jina-reader';
    } catch {
      // Keep the direct result if reader fallback fails.
    }
  }

  return {
    bytes,
    code: response.status,
    codeText: response.statusText,
    result: extractRelevantText(extractedText, input.prompt),
    durationMs: Date.now() - startedAt,
    url: response.url || normalizedUrl.toString(),
    fetchMode
  };
}

function validateBashCommand(command: string) {
  const normalized = command.trim();

  if (!normalized) {
    throw new Error('Command cannot be empty.');
  }

  for (const pattern of READ_ONLY_BASH_BLOCKLIST) {
    if (pattern.test(normalized)) {
      throw new Error(
        'Command rejected by Atlas safety policy. This first integration only allows read-only shell commands.'
      );
    }
  }
}

async function ensureWorkingDirectoryReadable(cwd: string) {
  await access(dirname(resolve(cwd, '.')), fsConstants.R_OK);
}

export async function bashToolExecute(input: {
  command: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
  dangerouslyDisableSandbox?: boolean;
}, workspace?: ToolWorkspace) {
  // Code mode exists so the agent can change a project, so the read-only
  // command policy is lifted there — the writable boundary is the OS sandbox
  // plus the approval ladder, not a regex list. Work mode keeps the regex as
  // well, because on a host with no sandbox mechanism it is the only guard.
  if (workspace?.mode !== 'code') {
    validateBashCommand(input.command);
  }

  const cwd = resolveWorkspaceCwd(workspace);
  await ensureWorkingDirectoryReadable(cwd);

  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh';
  const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', input.command] : ['-lc', input.command];

  const mechanism = await detectSandboxMechanism();
  // The escalation flag only means anything where there is a sandbox to
  // escalate out of; on an unsandboxed host it is a no-op rather than a
  // second, pointless approval prompt.
  const escalated = Boolean(input.dangerouslyDisableSandbox) && mechanism !== 'none';
  const policy: SandboxPolicy = escalated
    ? { fs: { kind: 'danger-full-access' }, network: 'allow' }
    : deriveSandboxPolicy(workspace);
  const launch = buildSandboxedLaunch([shell, ...shellArgs], policy, mechanism);

  const combinedEnv = { ...process.env, ...(workspace?.env ?? {}), ...launch.env };

  if (input.run_in_background) {
    const child = spawn(launch.command, launch.args, {
      cwd,
      env: combinedEnv,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    workspace?.onCommandRun?.({ command: input.command, exitCode: null });

    // No denial detection is possible here: with `stdio: 'ignore'` there is no
    // output to inspect and no exit code to wait for, so a sandbox denial in a
    // background command surfaces only as the work never happening.
    return {
      stdout: '',
      stderr: '',
      interrupted: false,
      backgroundTaskId: randomUUID(),
      noOutputExpected: true,
      sandbox: launch.mechanism,
      sandboxNetwork: policy.network,
      sandboxEscalated: escalated,
      returnCodeInterpretation: 'backgrounded'
    };
  }

  const result = await runCommand(launch.command, launch.args, {
    cwd,
    env: { ...(workspace?.env ?? {}), ...launch.env },
    timeoutMs: Math.max(100, Math.min(Math.floor(input.timeout ?? 30_000), 120_000))
  });

  if (isSandboxWrapperFailure(launch.mechanism, result.code, result.stderr)) {
    if (launch.mechanism === 'bubblewrap') {
      markSandboxMechanismUnavailable();
    }

    // The command never ran, so reporting its exit code as the command's own
    // result would be a lie the model would then try to debug.
    return {
      stdout: '',
      stderr: result.stderr,
      interrupted: false,
      sandbox: launch.mechanism,
      sandboxNetwork: policy.network,
      sandboxEscalated: escalated,
      sandboxFailed: true as const,
      returnCodeInterpretation: 'sandbox_failed'
    };
  }

  workspace?.onCommandRun?.({ command: input.command, exitCode: result.code ?? null });

  const isSuccess = !result.interrupted && result.code === 0;
  const rawStdout = result.stdout;
  const rawStderr = result.stderr;
  // Silent commands (e.g. `rm`, `mkdir`, `touch`) produce empty stdout and stderr.
  // Models like DeepSeek often interpret empty output as unconfirmed/failed and enter
  // retry loops. Providing explicit success text gives clear feedback to the model.
  const stdout = isSuccess && !rawStdout.trim() && !rawStderr.trim()
    ? '(Command executed successfully with exit code 0)'
    : rawStdout;
  const sandboxDenied =
    !result.interrupted && isLikelySandboxDenied(launch.mechanism, result.code, rawStdout, rawStderr);

  return {
    stdout,
    stderr: rawStderr,
    interrupted: result.interrupted,
    sandbox: launch.mechanism,
    sandboxNetwork: policy.network,
    sandboxEscalated: escalated,
    // Additive: the bounded text already carries its own marker, but callers
    // that summarise a run should not have to parse it back out.
    ...(result.stdoutTruncated || result.stderrTruncated ? { outputTruncated: true as const } : {}),
    ...(sandboxDenied ? { sandboxDenied: true as const, sandboxDenialHint: SANDBOX_DENIAL_HINT } : {}),
    returnCodeInterpretation:
      result.interrupted ? 'timed_out' : result.code === 0 ? 'success' : `exit_code_${result.code ?? 'unknown'}`
  };
}

export async function listDirectoryPreview(pathValue?: string, workspace?: ToolWorkspace) {
  const basePath = resolveSearchPath(pathValue, workspace);
  const entries = await readdir(basePath, { withFileTypes: true });
  return entries.slice(0, 50).map((entry) => ({
    name: entry.name,
    path: resolve(basePath, entry.name),
    kind: entry.isDirectory() ? 'directory' : 'file'
  }));
}
