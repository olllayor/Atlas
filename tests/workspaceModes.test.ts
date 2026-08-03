import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createBuiltInTools, describeWorkspaceModeForPrompt } from '../src/main/ai/tools/builtInTools.js';
import {
  buildUnifiedDiff,
  editFileToolExecute,
  writeFileToolExecute
} from '../src/main/ai/tools/codeTools.js';
import { grepToolExecute } from '../src/main/ai/tools/toolRuntime.js';
import { resolveWorkspaceCwd, resolveWritablePath } from '../src/main/ai/tools/toolWorkspace.js';
import type { SidebarConversationItem } from '../src/renderer/components/sidebarViewModel.js';
import { splitSidebarItemsByProject } from '../src/renderer/components/sidebarViewModel.js';
import type { WorkspaceProject } from '../src/shared/contracts.js';
import { resolveNewConversationProjectId } from '../src/main/workspace/conversationWorkspace.js';
import { parseUnifiedDiff } from '../src/shared/toolCellGrammar.js';
import {
  DEFAULT_WORKSPACE_MODE,
  isWorkspaceMode,
  isWorkspaceModeReady,
  shouldPromptForProject
} from '../src/shared/workspaceModes.js';

const modelsRepo = { list: () => [] } as never;

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function toolNames(workspace: Parameters<typeof createBuiltInTools>[3]) {
  return Object.keys(createBuiltInTools(modelsRepo, null, 'ask', workspace)).sort();
}

test('work is the default mode and the fallback for unknown values', () => {
  assert.equal(DEFAULT_WORKSPACE_MODE, 'work');
  assert.equal(isWorkspaceMode('code'), true);
  assert.equal(isWorkspaceMode('coding'), false);
});

test('only code mode requires a project to be ready', () => {
  assert.equal(isWorkspaceModeReady('work', false), true);
  assert.equal(isWorkspaceModeReady('code', false), false);
  assert.equal(isWorkspaceModeReady('code', true), true);
});

test('switching to code with no project at all prompts for a folder', () => {
  assert.equal(shouldPromptForProject('code', null), true);
});

test('work mode never prompts for a folder', () => {
  assert.equal(shouldPromptForProject('work', null), false);
});

test('a usable project suppresses the prompt', () => {
  assert.equal(shouldPromptForProject('code', { exists: true }), false);
});

test('a project missing on disk is a shown gate, not an auto-opened dialog', () => {
  assert.equal(shouldPromptForProject('code', { exists: false }), false);
});

test('work mode is offered no file-editing or git tools', () => {
  const names = toolNames({ mode: 'work', root: '/tmp' });
  assert.equal(names.includes('write_file'), false);
  assert.equal(names.includes('edit_file'), false);
  assert.equal(names.includes('git_status'), false);
  assert.equal(names.includes('read_file'), true);
});

test('code mode without a project is offered no editing tools either', () => {
  const names = toolNames({ mode: 'code', root: null });
  assert.equal(names.includes('write_file'), false);
  assert.equal(names.includes('edit_file'), false);
});

test('code mode with a project gains the editing and git tools', () => {
  const names = toolNames({ mode: 'code', root: '/tmp/project' });
  assert.equal(names.includes('write_file'), true);
  assert.equal(names.includes('edit_file'), true);
  assert.equal(names.includes('git_status'), true);
  assert.equal(names.includes('git_diff'), true);
});

test('the permission ladder still outranks the mode', () => {
  const names = Object.keys(
    createBuiltInTools(modelsRepo, null, 'read-only', { mode: 'code', root: '/tmp/project' })
  );
  assert.equal(names.includes('write_file'), false);
  assert.equal(names.includes('bash'), false);
});

test('the work-mode prompt cancels instructions from earlier code turns', () => {
  const prompt = describeWorkspaceModeForPrompt('work', { mode: 'work', root: null });
  assert.match(prompt, /no longer applies/);
  assert.match(prompt, /Work mode/);
});

test('the shell falls back to the home directory when no project is attached', () => {
  assert.equal(resolveWorkspaceCwd({ mode: 'work', root: null }), homedir());
  assert.equal(resolveWorkspaceCwd({ mode: 'code', root: '/tmp/project' }), '/tmp/project');
});

test('writes are refused outside code mode', () => {
  assert.throws(
    () => resolveWritablePath('notes.md', { mode: 'work', root: '/tmp/project' }),
    /only available in Code mode/
  );
});

test('writes are refused when code mode has no project', () => {
  assert.throws(() => resolveWritablePath('notes.md', { mode: 'code', root: null }), /no project folder/);
});

test('writes cannot escape the project root', () => {
  const workspace = { mode: 'code' as const, root: '/tmp/project' };
  assert.throws(() => resolveWritablePath('../outside.txt', workspace), /outside the project folder/);
  assert.throws(() => resolveWritablePath('/etc/hosts', workspace), /outside the project folder/);
  assert.equal(resolveWritablePath('src/app.ts', workspace), resolve('/tmp/project/src/app.ts'));
});

test('repository and Atlas metadata stay read-only inside a writable root', () => {
  const workspace = { mode: 'code' as const, root: '/tmp/project' };
  assert.throws(() => resolveWritablePath('.git/hooks/pre-commit', workspace), /read-only/);
  assert.throws(() => resolveWritablePath('.atlas/config.json', workspace), /read-only/);
  // A file that merely starts with the same letters is not metadata.
  assert.equal(resolveWritablePath('.gitignore', workspace), resolve('/tmp/project/.gitignore'));
});

test('a generated diff round-trips through the transcript parser', () => {
  const before = ['one', 'two', 'three', 'four', 'five'].join('\n');
  const after = ['one', 'two', 'CHANGED', 'four', 'five'].join('\n');
  const diff = buildUnifiedDiff('src/app.ts', before, after);

  assert.ok(diff);
  const parsed = parseUnifiedDiff(diff!);
  assert.ok(parsed);
  assert.equal(parsed!.length, 1);
  assert.equal(parsed![0]!.path, 'src/app.ts');
  assert.equal(parsed![0]!.added, 1);
  assert.equal(parsed![0]!.removed, 1);
});

test('identical content produces no diff', () => {
  assert.equal(buildUnifiedDiff('a.txt', 'same', 'same'), null);
});

test('write_file creates the file and returns a parseable diff', async () => {
  const project = makeProject();

  try {
    const workspace = { mode: 'code' as const, root: project.root };
    const output = await writeFileToolExecute({ file_path: 'src/new.ts', content: 'export const a = 1;\n' }, workspace);

    assert.equal(await readFile(join(project.root, 'src/new.ts'), 'utf8'), 'export const a = 1;\n');
    assert.ok(parseUnifiedDiff(output));
  } finally {
    project.cleanup();
  }
});

test('edit_file refuses an ambiguous match unless replace_all is set', async () => {
  const project = makeProject();

  try {
    const workspace = { mode: 'code' as const, root: project.root };
    mkdirSync(join(project.root, 'src'), { recursive: true });
    writeFileSync(join(project.root, 'src/app.ts'), 'a\na\n', 'utf8');

    await assert.rejects(
      editFileToolExecute({ file_path: 'src/app.ts', old_string: 'a', new_string: 'b' }, workspace),
      /appears 2 times/
    );

    await editFileToolExecute(
      { file_path: 'src/app.ts', old_string: 'a', new_string: 'b', replace_all: true },
      workspace
    );
    assert.equal(await readFile(join(project.root, 'src/app.ts'), 'utf8'), 'b\nb\n');
  } finally {
    project.cleanup();
  }
});

test('edit_file will not write through a path outside the project', async () => {
  const project = makeProject();

  try {
    await assert.rejects(
      editFileToolExecute(
        { file_path: '../escape.txt', old_string: 'a', new_string: 'b' },
        { mode: 'code', root: project.root }
      ),
      /outside the project folder/
    );
  } finally {
    project.cleanup();
  }
});

test('a rootless search demands an explicit path instead of scanning $HOME', async () => {
  await assert.rejects(
    grepToolExecute({ pattern: 'anything' }, { mode: 'work', root: null }),
    /no default search directory/
  );
});

test('sidebar sections keep project order and send orphans to Recents', () => {
  const project = (id: string): WorkspaceProject => ({
    id,
    title: id,
    root: `/tmp/${id}`,
    exists: true,
    isGitRepository: false,
    branch: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
  });
  const item = (id: string, projectId: string | null) =>
    ({
      id,
      projectId,
      isRunning: false,
      status: 'idle',
      primaryLabel: id,
      secondaryLabel: null,
      timestampLabel: null,
      timestampMs: null,
    }) as SidebarConversationItem;

  const { sections, ungrouped } = splitSidebarItemsByProject(
    [item('a', 'p1'), item('b', null), item('c', 'gone'), item('d', 'p2'), item('e', 'p1')],
    [project('p1'), project('p2')]
  );

  assert.deepEqual(
    sections.map((section) => [section.project.id, section.items.map((entry) => entry.id)]),
    [
      ['p1', ['a', 'e']],
      ['p2', ['d']],
    ]
  );
  // 'c' points at a detached project, so it falls back rather than vanishing.
  assert.deepEqual(ungrouped.map((entry) => entry.id), ['b', 'c']);
});

test('a new chat lands in the project the caller states, not the remembered one', () => {
  const projects = {
    get: (id: string) =>
      id === 'gone'
        ? { id: 'gone', exists: false }
        : ['p1', 'p2'].includes(id)
          ? { id, exists: true }
          : null,
  } as never;

  // The reported bug: reading a chat in p2 and pressing the New chat shortcut
  // filed it under p1, because only an explicit workspace change moved the
  // remembered id.
  assert.equal(resolveNewConversationProjectId(projects, { projectId: 'p2' }, 'p1'), 'p2');

  // An explicit null is a statement, not an omission: an unfiled chat begets
  // an unfiled chat rather than adopting the last project used.
  assert.equal(resolveNewConversationProjectId(projects, { projectId: null }, 'p1'), null);

  // Only a caller with nothing on screen inherits the remembered project.
  assert.equal(resolveNewConversationProjectId(projects, undefined, 'p1'), 'p1');
  assert.equal(resolveNewConversationProjectId(projects, {}, 'p1'), 'p1');

  // Folders that are gone never come back, from either source.
  assert.equal(resolveNewConversationProjectId(projects, { projectId: 'gone' }, 'p1'), null);
  assert.equal(resolveNewConversationProjectId(projects, undefined, 'gone'), null);
  assert.equal(resolveNewConversationProjectId(projects, undefined, 'deleted'), null);
});
