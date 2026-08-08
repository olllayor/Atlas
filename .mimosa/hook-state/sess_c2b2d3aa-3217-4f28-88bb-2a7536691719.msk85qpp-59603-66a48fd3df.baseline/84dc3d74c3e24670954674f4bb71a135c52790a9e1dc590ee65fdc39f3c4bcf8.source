import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseStatusBranchHeader,
  parseStatusFileLine,
} from '../src/main/workspace/GitStateService';

/**
 * `readState` used to run three git subprocesses — `branch --show-current`,
 * `status --porcelain=v1`, and `rev-list --left-right --count @{upstream}...HEAD`
 * — and now runs one, because `status --branch` reports all three. Everything
 * that used to be git's own arithmetic is now this parser's, so the header
 * shapes are pinned here rather than left to a repo fixture: several of them
 * (a deleted upstream, a repo with no commits) are awkward to stage for real
 * and are exactly the ones a naive parser gets wrong.
 */

test('a branch with no upstream reports no drift rather than zero drift', () => {
  // Zero would read as "in sync with the remote", which is a claim about a
  // remote this branch has never been pushed to.
  assert.deepEqual(parseStatusBranchHeader('## main'), {
    branch: 'main',
    ahead: null,
    behind: null,
  });
});

test('an upstream with no bracket is genuinely in sync', () => {
  assert.deepEqual(parseStatusBranchHeader('## main...origin/main'), {
    branch: 'main',
    ahead: 0,
    behind: 0,
  });
});

test('drift is read from the bracket, and the missing side is zero', () => {
  assert.deepEqual(parseStatusBranchHeader('## main...origin/main [ahead 3]'), {
    branch: 'main',
    ahead: 3,
    behind: 0,
  });
  assert.deepEqual(parseStatusBranchHeader('## main...origin/main [behind 2]'), {
    branch: 'main',
    ahead: 0,
    behind: 2,
  });
  assert.deepEqual(parseStatusBranchHeader('## dev...origin/dev [ahead 1, behind 12]'), {
    branch: 'dev',
    ahead: 1,
    behind: 12,
  });
});

test('a deleted upstream reports no drift, not zero drift', () => {
  // `[gone]` means there is nothing left to compare against, which is the same
  // situation as having no upstream at all.
  assert.deepEqual(parseStatusBranchHeader('## feature...origin/feature [gone]'), {
    branch: 'feature',
    ahead: null,
    behind: null,
  });
});

test('a detached HEAD keeps the label the UI already showed', () => {
  assert.deepEqual(parseStatusBranchHeader('## HEAD (no branch)'), {
    branch: 'HEAD (detached)',
    ahead: null,
    behind: null,
  });
});

test('a repo with no commits still names its branch', () => {
  assert.deepEqual(parseStatusBranchHeader('## No commits yet on main'), {
    branch: 'main',
    ahead: null,
    behind: null,
  });
});

test('branch names containing slashes and dashes survive the split', () => {
  // The `...` separator is safe to split on because `..` is illegal in a
  // refname — but only if the split takes the *first* occurrence.
  assert.deepEqual(
    parseStatusBranchHeader('## feat/some-thing...origin/feat/some-thing [ahead 1]'),
    { branch: 'feat/some-thing', ahead: 1, behind: 0 },
  );
});

test('a line that is not a header yields nothing rather than a bad guess', () => {
  assert.deepEqual(parseStatusBranchHeader(''), { branch: null, ahead: null, behind: null });
  assert.deepEqual(parseStatusBranchHeader(' M src/foo.ts'), {
    branch: null,
    ahead: null,
    behind: null,
  });
});

test('file lines keep both status columns and the post-rename path', () => {
  assert.deepEqual(parseStatusFileLine(' M src/foo.ts'), {
    path: 'src/foo.ts',
    indexStatus: ' ',
    workingTreeStatus: 'M',
  });
  assert.deepEqual(parseStatusFileLine('?? untracked.txt'), {
    path: 'untracked.txt',
    indexStatus: '?',
    workingTreeStatus: '?',
  });
  // The new path is the one on disk, so it is the one worth showing.
  assert.deepEqual(parseStatusFileLine('R  old/path.ts -> new/path.ts'), {
    path: 'new/path.ts',
    indexStatus: 'R',
    workingTreeStatus: ' ',
  });
});
