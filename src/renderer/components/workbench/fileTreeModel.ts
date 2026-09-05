/**
 * Flat path list in, tree rows out.
 *
 * Main hands the panel every file in one call, so expanding a folder is a
 * local fold rather than another round trip, and the search box filters
 * without asking anyone. Everything here is pure and ordered: rows must not
 * move under the pointer between renders.
 */

import type { WorkspaceEntry } from '../../../shared/contracts';

export type FileTreeNode = {
  /** Workspace-relative path of this node. */
  path: string;
  /** Last segment, which is what the row shows. */
  name: string;
  kind: 'file' | 'directory';
  children: FileTreeNode[];
};

export type FileTreeRow = {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  depth: number;
  /** Directories only: whether their children are showing. */
  expanded: boolean;
};

/**
 * Builds the tree from entries already sorted by the index (directories
 * before files, case-insensitive within a folder), so the fold preserves that
 * order instead of re-deriving it.
 */
export function buildFileTree(entries: readonly WorkspaceEntry[]): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const byPath = new Map<string, FileTreeNode>();

  for (const entry of entries) {
    const separator = entry.path.lastIndexOf('/');
    const name = separator < 0 ? entry.path : entry.path.slice(separator + 1);
    const node: FileTreeNode = { path: entry.path, name, kind: entry.kind, children: [] };
    byPath.set(entry.path, node);

    if (separator < 0) {
      roots.push(node);
      continue;
    }

    // A parent is always listed before its children, because every directory
    // on the way to a file is in the entry list and sorts ahead of it.
    const parent = byPath.get(entry.path.slice(0, separator));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

/** The rows actually on screen: a collapsed folder contributes one row. */
export function flattenFileTree(
  nodes: readonly FileTreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];

  for (const node of nodes) {
    const isExpanded = node.kind === 'directory' && expanded.has(node.path);
    rows.push({
      path: node.path,
      name: node.name,
      kind: node.kind,
      depth,
      expanded: isExpanded,
    });
    if (isExpanded) rows.push(...flattenFileTree(node.children, expanded, depth + 1));
  }

  return rows;
}

export type FileMatch = {
  path: string;
  /** Indices into `path` that the query matched, for highlighting. */
  positions: number[];
};

/**
 * Subsequence match over the whole path, the way a quick-open box works:
 * `rpm` finds `src/renderer/panel/Model.ts`. Ranked so a match that lands in
 * the file's own name beats one spread across its folders, then by how tight
 * the match is, then by path length.
 */
export function filterFilePaths(
  paths: readonly string[],
  query: string,
  limit: number
): { matches: FileMatch[]; truncated: boolean } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: [], truncated: false };

  const scored: Array<{ match: FileMatch; score: number }> = [];

  for (const path of paths) {
    const positions = matchPositions(path.toLowerCase(), needle);
    if (!positions) continue;
    scored.push({ match: { path, positions }, score: scorePath(path, positions) });
  }

  scored.sort((left, right) => left.score - right.score || left.match.path.localeCompare(right.match.path));

  return {
    matches: scored.slice(0, limit).map((entry) => entry.match),
    truncated: scored.length > limit,
  };
}

/** Leftmost subsequence match, or null when the query is not in the path. */
function matchPositions(haystack: string, needle: string): number[] | null {
  const positions: number[] = [];
  let cursor = 0;

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return null;
    positions.push(found);
    cursor = found + 1;
  }

  return positions;
}

/** Lower is better. */
function scorePath(path: string, positions: number[]): number {
  const nameStart = path.lastIndexOf('/') + 1;
  const inName = positions[0] >= nameStart ? 0 : 1_000;
  const span = positions[positions.length - 1] - positions[0];
  return inName + span * 4 + path.length;
}

/**
 * Language tag for the viewer's highlighter. Extension only: sniffing content
 * to guess a language is a lot of machinery for a read-only pane, and an
 * unknown extension renders as plain text rather than wrongly coloured code.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

/** Files whose whole name carries the language, extension or not. */
const LANGUAGE_BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'bash',
  '.env': 'bash',
};

export function languageForPath(path: string): string | undefined {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  const byName = LANGUAGE_BY_NAME[name];
  if (byName) return byName;

  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1)];
}

/** What the tab shows for a file surface. */
export function fileSurfaceLabel(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath;
}
