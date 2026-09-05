import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executionTargetChipText,
  executionTargetRows,
  revealTargetForChip,
  worktreeBranchShort,
} from '../src/renderer/components/workspace/executionTargetViewModel.js';

test('execution target rows gate worktrees on git and cloud on beta', () => {
  const rows = executionTargetRows({
    isGitRepo: false,
    cloudSandboxEnabled: false,
  });

  assert.deepEqual(
    rows.map((row) => ({
      value: row.value,
      disabled: row.disabled,
      needsSettings: row.needsSettings,
      tagline: row.tagline,
    })),
    [
      {
        value: 'local',
        disabled: false,
        needsSettings: false,
        tagline: 'Run directly on your machine',
      },
      {
        value: 'worktree',
        disabled: true,
        needsSettings: false,
        tagline: 'Requires a git repository attached',
      },
      {
        value: 'cloud',
        disabled: true,
        needsSettings: true,
        tagline: 'Enable in Settings → Beta',
      },
    ]
  );
});

test('worktree row unlocks with a git repo, cloud with the beta flag', () => {
  const rows = executionTargetRows({
    isGitRepo: true,
    cloudSandboxEnabled: true,
  });

  assert.deepEqual(
    rows.map((row) => ({ value: row.value, disabled: row.disabled, needsSettings: row.needsSettings })),
    [
      { value: 'local', disabled: false, needsSettings: false },
      { value: 'worktree', disabled: false, needsSettings: false },
      { value: 'cloud', disabled: false, needsSettings: false },
    ]
  );
});

test('worktree branch short name follows WorktreeService branch naming', () => {
  // Git refs carry the full UUID (`atlas/<id>`, see WorktreeService.provisionWorktree);
  // this helper is display-only, shortening to `atlas/<first8>` for the chip label.
  assert.equal(
    worktreeBranchShort('3f9ab2c1-1234-5678-90ab-cdef01234567'),
    'atlas/3f9ab2c1'
  );
  assert.equal(worktreeBranchShort('short'), null);
  assert.equal(worktreeBranchShort(undefined), null);
});

test('worktree branch short name never editorializes a hyphen inside the first eight', () => {
  // The id's eighth character is a hyphen here; the label is a raw slice of the
  // stored ref, not a hyphen-stripped digest that would diverge from it.
  assert.equal(worktreeBranchShort('3f9a-b2c1-1234'), 'atlas/3f9a-b2c');
});

test('execution target chip copy stays compact while exposing location', () => {
  assert.equal(executionTargetChipText({ target: 'local' }).label, 'Local');

  assert.equal(
    executionTargetChipText({
      target: 'worktree',
      worktreeBranch: 'atlas/3f9ab2c1',
    }).label,
    'Worktree · atlas/3f9ab2c1'
  );

  assert.match(executionTargetChipText({ target: 'cloud' }).aria, /Cloudflare Cloud Sandbox/);
});

test('reveal follows a real worktree; every other state reveals the project root', () => {
  // Worktree with an actual root → reveal the worktree.
  assert.equal(revealTargetForChip({ executionTarget: 'worktree', hasWorktree: true }), 'worktree');
  // Worktree label but no root (fork, stale row) → project, not an error.
  assert.equal(revealTargetForChip({ executionTarget: 'worktree', hasWorktree: false }), 'project');
  // Local keeps a worktree on disk but operates on the project → project.
  assert.equal(revealTargetForChip({ executionTarget: 'local', hasWorktree: true }), 'project');
  assert.equal(revealTargetForChip({ executionTarget: 'local', hasWorktree: false }), 'project');
  // Cloud (even with a leftover worktree) → project.
  assert.equal(revealTargetForChip({ executionTarget: 'cloud', hasWorktree: true }), 'project');
  assert.equal(revealTargetForChip({ executionTarget: 'cloud', hasWorktree: false }), 'project');
});
