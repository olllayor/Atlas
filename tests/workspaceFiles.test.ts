import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEntries,
  normalizeRelativePath,
} from '../src/main/workspace/workspaceEntries.js';
import {
  buildFileTree,
  fileSurfaceLabel,
  filterFilePaths,
  flattenFileTree,
  languageForPath,
} from '../src/renderer/components/workbench/fileTreeModel.js';

// ---------------------------------------------------------------------------
// Path normalization — the jail's first gate
// ---------------------------------------------------------------------------

test('a workspace-relative path passes through, minus its ./ prefix', () => {
  assert.equal(normalizeRelativePath('src/main/index.ts'), 'src/main/index.ts');
  assert.equal(normalizeRelativePath('./src/index.ts'), 'src/index.ts');
  assert.equal(normalizeRelativePath('  src/index.ts  '), 'src/index.ts');
});

test('anything that could leave the workspace is rejected, not repaired', () => {
  assert.equal(normalizeRelativePath('../secrets'), null);
  assert.equal(normalizeRelativePath('src/../../secrets'), null);
  assert.equal(normalizeRelativePath('/etc/passwd'), null);
  assert.equal(normalizeRelativePath('C:/Windows/System32'), null);
  assert.equal(normalizeRelativePath(''), null);
  assert.equal(normalizeRelativePath('   '), null);
});

test('a path with two dots inside a name is not an escape', () => {
  assert.equal(normalizeRelativePath('src/file..name.ts'), 'src/file..name.ts');
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

test('directories are derived from the file paths that pass through them', () => {
  const { entries } = buildEntries(['src/main/index.ts', 'README.md'], 100);

  assert.deepEqual(entries, [
    { path: 'src', kind: 'directory' },
    { path: 'src/main', kind: 'directory' },
    { path: 'src/main/index.ts', kind: 'file' },
    { path: 'README.md', kind: 'file' },
  ]);
});

test('a directory sorts before a file inside the same folder', () => {
  const { entries } = buildEntries(['src/zebra/a.ts', 'src/alpha.ts'], 100);

  assert.deepEqual(
    entries.map((entry) => entry.path),
    ['src', 'src/zebra', 'src/zebra/a.ts', 'src/alpha.ts']
  );
});

test('names sort without case deciding the order', () => {
  const { entries } = buildEntries(['b.ts', 'A.ts', 'a.ts'], 100);

  assert.deepEqual(
    entries.map((entry) => entry.path),
    ['A.ts', 'a.ts', 'b.ts']
  );
});

test('a workspace past the cap is reported as truncated', () => {
  const files = Array.from({ length: 5 }, (_, index) => `file-${index}.ts`);
  const result = buildEntries(files, 3);

  assert.equal(result.truncated, true);
  assert.equal(result.entries.filter((entry) => entry.kind === 'file').length, 3);
});

// ---------------------------------------------------------------------------
// The tree the renderer folds
// ---------------------------------------------------------------------------

const ENTRIES = buildEntries(
  ['src/main/index.ts', 'src/main/db/client.ts', 'src/renderer/App.tsx', 'README.md'],
  100
).entries;

test('the flat listing folds back into a tree', () => {
  const tree = buildFileTree(ENTRIES);

  assert.deepEqual(
    tree.map((node) => node.path),
    ['src', 'README.md']
  );
  assert.deepEqual(
    tree[0].children.map((node) => node.path),
    ['src/main', 'src/renderer']
  );
});

test('a collapsed folder contributes one row, not its subtree', () => {
  const rows = flattenFileTree(buildFileTree(ENTRIES), new Set());

  assert.deepEqual(
    rows.map((row) => row.path),
    ['src', 'README.md']
  );
});

test('expanding a folder reveals its children at the next depth', () => {
  const rows = flattenFileTree(buildFileTree(ENTRIES), new Set(['src', 'src/main']));

  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.path}`),
    [
      '0:src',
      '1:src/main',
      '2:src/main/db',
      '2:src/main/index.ts',
      '1:src/renderer',
      '0:README.md',
    ]
  );
});

test('expanding a folder whose parent is closed shows nothing', () => {
  const rows = flattenFileTree(buildFileTree(ENTRIES), new Set(['src/main']));

  assert.deepEqual(
    rows.map((row) => row.path),
    ['src', 'README.md']
  );
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const PATHS = [
  'src/renderer/components/workbench/FilesPanel.tsx',
  'src/main/workspace/WorkspaceIndex.ts',
  'src/shared/contracts.ts',
  'README.md',
];

test('a query matches as a subsequence of the whole path', () => {
  const { matches } = filterFilePaths(PATHS, 'wsindex', 10);

  assert.deepEqual(
    matches.map((match) => match.path),
    ['src/main/workspace/WorkspaceIndex.ts']
  );
});

test('a match in the file name outranks one spread across folders', () => {
  const { matches } = filterFilePaths(PATHS, 'contracts', 10);
  assert.equal(matches[0].path, 'src/shared/contracts.ts');
});

test('matching is case-insensitive and reports where it landed', () => {
  const { matches } = filterFilePaths(['src/App.tsx'], 'app', 10);

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].positions, [4, 5, 6]);
});

test('a query nothing contains returns nothing', () => {
  assert.deepEqual(filterFilePaths(PATHS, 'zzz', 10).matches, []);
});

test('an empty query is not a search', () => {
  assert.deepEqual(filterFilePaths(PATHS, '   ', 10), { matches: [], truncated: false });
});

test('results past the limit are cut and reported', () => {
  const many = Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`);
  const result = filterFilePaths(many, 'file', 5);

  assert.equal(result.matches.length, 5);
  assert.equal(result.truncated, true);
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

test('the viewer picks a language from the extension, or none at all', () => {
  assert.equal(languageForPath('src/App.tsx'), 'tsx');
  assert.equal(languageForPath('src/main/index.ts'), 'typescript');
  assert.equal(languageForPath('Makefile'), 'makefile');
  assert.equal(languageForPath('.gitignore'), 'bash');
  assert.equal(languageForPath('LICENSE'), undefined);
  assert.equal(languageForPath('logo.weirdext'), undefined);
});

test('a file tab is named after the file, not its path', () => {
  assert.equal(fileSurfaceLabel('src/main/index.ts'), 'index.ts');
  assert.equal(fileSurfaceLabel('README.md'), 'README.md');
});
