import assert from 'node:assert/strict';
import test from 'node:test';

import type { DiffFile } from '../src/shared/toolCellGrammar';
import { groupChangedFiles, topDirectoryOf } from '../src/renderer/components/transcript/ChangedFilesBar';

function file(path: string, added = 1, removed = 0): DiffFile {
  return { path, added, removed, hunks: [] };
}

test('top directory is the first segment, empty for root files', () => {
  assert.equal(topDirectoryOf('src/renderer/App.tsx'), 'src');
  assert.equal(topDirectoryOf('tests/a.test.ts'), 'tests');
  assert.equal(topDirectoryOf('README.md'), '');
  assert.equal(topDirectoryOf('src\\main\\index.ts'), 'src');
});

test('folders group with summed totals, root files first', () => {
  const groups = groupChangedFiles([
    file('tests/a.test.ts', 26, 9),
    file('src/renderer/App.tsx', 70, 20),
    file('src/main/index.ts', 1, 2),
    file('README.md', 5, 0),
  ]);

  assert.deepEqual(
    groups.map((group) => group.folder),
    ['', 'src', 'tests']
  );
  assert.deepEqual(
    groups.map((group) => [group.added, group.removed]),
    [
      [5, 0],
      [71, 22],
      [26, 9],
    ]
  );
  assert.deepEqual(
    groups[1]?.files.map((entry) => entry.path),
    ['src/renderer/App.tsx', 'src/main/index.ts']
  );
});
