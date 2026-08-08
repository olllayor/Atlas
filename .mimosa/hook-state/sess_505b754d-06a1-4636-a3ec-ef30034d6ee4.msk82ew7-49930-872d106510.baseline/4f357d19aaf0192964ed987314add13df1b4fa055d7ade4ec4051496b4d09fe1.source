import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveConversationWorkspace } from '../src/main/workspace/conversationWorkspace.js';
import type { WorkspaceDatabase } from '../src/main/workspace/conversationWorkspace.js';
import type {
  AgentInstructionsResult,
  AgentInstructionsService
} from '../src/main/workspace/AgentInstructions.js';
import type { EnvStore } from '../src/main/workspace/EnvStore.js';
import type { FileChangeTracker } from '../src/main/workspace/FileChangeTracker.js';
import type { TerminalHistoryRepo } from '../src/main/db/repositories/terminalHistoryRepo.js';

const PROJECT = {
  id: 'project-1',
  title: 'Atlas',
  root: '/tmp/atlas',
  exists: true,
  isGitRepository: true,
  branch: 'main',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

function makeDatabase(mode: 'work' | 'code' = 'code'): WorkspaceDatabase {
  return {
    conversations: {
      getWorkspace: () => ({ mode, projectId: PROJECT.id })
    },
    projects: {
      get: (id: string) => (id === PROJECT.id ? PROJECT : null)
    }
  } as unknown as WorkspaceDatabase;
}

function makeAgentInstructions(roots: Array<string | null>) {
  const result: AgentInstructionsResult = {
    text: 'Project rule: run pnpm test.',
    segments: [
      {
        source: { path: `${PROJECT.root}/AGENTS.md`, scope: 'project', bytes: 27, truncated: false },
        text: 'Project rule: run pnpm test.'
      }
    ],
    sources: [{ path: `${PROJECT.root}/AGENTS.md`, scope: 'project', bytes: 27, truncated: false }],
    nestedPaths: [],
    totalBytes: 27,
    truncated: false
  };

  return {
    getForRoot: (root: string | null) => {
      roots.push(root);
      return result;
    }
  } as unknown as AgentInstructionsService;
}

test('project env vars reach the tool workspace so child processes inherit them', () => {
  const envStore = {
    getCachedEnv: (projectId: string) =>
      projectId === PROJECT.id ? { API_TOKEN: 'secret-value' } : {}
  } as unknown as EnvStore;

  const workspace = resolveConversationWorkspace(makeDatabase(), 'conversation-1', { envStore });

  assert.deepEqual(workspace.env, { API_TOKEN: 'secret-value' });
});

test('a project with no configured vars leaves the environment untouched', () => {
  const envStore = { getCachedEnv: () => ({}) } as unknown as EnvStore;

  const workspace = resolveConversationWorkspace(makeDatabase(), 'conversation-1', { envStore });

  assert.equal(workspace.env, undefined);
});

test('agent shell commands are written to terminal history and echoed to the panel', () => {
  const recorded: Array<{ conversationId: string; command: string; exitCode: number | null }> = [];
  const echoed: Array<[string, number | null]> = [];

  const terminalHistory = {
    add: (input: { conversationId: string; command: string; exitCode?: number | null }) => {
      recorded.push({
        conversationId: input.conversationId,
        command: input.command,
        exitCode: input.exitCode ?? null
      });
      return null as never;
    }
  } as unknown as TerminalHistoryRepo;

  const workspace = resolveConversationWorkspace(makeDatabase(), 'conversation-1', {
    terminalHistory,
    onAgentCommand: (command, exitCode) => echoed.push([command, exitCode])
  });

  workspace.onCommandRun?.({ command: 'pnpm test', exitCode: 0 });

  assert.deepEqual(recorded, [
    { conversationId: 'conversation-1', command: 'pnpm test', exitCode: 0 }
  ]);
  assert.deepEqual(echoed, [['pnpm test', 0]]);
});

test('a failing history write still lets the terminal echo run', () => {
  const echoed: string[] = [];
  const terminalHistory = {
    add: () => {
      throw new Error('database is locked');
    }
  } as unknown as TerminalHistoryRepo;

  const workspace = resolveConversationWorkspace(makeDatabase(), 'conversation-1', {
    terminalHistory,
    onAgentCommand: (command) => echoed.push(command)
  });

  workspace.onCommandRun?.({ command: 'ls', exitCode: 0 });

  assert.deepEqual(echoed, ['ls']);
});

test('AGENTS.md instructions reach the tool workspace for the resolved root', () => {
  const roots: Array<string | null> = [];

  const workspace = resolveConversationWorkspace(makeDatabase(), 'conversation-1', {
    agentInstructions: makeAgentInstructions(roots)
  });

  assert.deepEqual(roots, [PROJECT.root]);
  assert.equal(workspace.instructions?.text, 'Project rule: run pnpm test.');
});

test('a resolver with no instructions service leaves the workspace without any', () => {
  const workspace = resolveConversationWorkspace(makeDatabase(), 'conversation-1');

  assert.equal(workspace.instructions, undefined);
});

test('work mode with a project attached still gets the project instructions', () => {
  const roots: Array<string | null> = [];

  const workspace = resolveConversationWorkspace(makeDatabase('work'), 'conversation-1', {
    agentInstructions: makeAgentInstructions(roots)
  });

  assert.deepEqual(roots, [PROJECT.root]);
  assert.equal(workspace.instructions?.sources.length, 1);
});

test('file changes are recorded against the conversation that produced them', () => {
  const changes: Array<{ conversationId: string; filePath: string }> = [];
  const fileChangeTracker = {
    recordChange: (input: { conversationId: string; filePath: string }) => {
      changes.push({ conversationId: input.conversationId, filePath: input.filePath });
      return null as never;
    }
  } as unknown as FileChangeTracker;

  const workspace = resolveConversationWorkspace(makeDatabase(), 'conversation-1', {
    fileChangeTracker
  });

  workspace.onFileChange?.({
    filePath: 'src/index.ts',
    beforeContent: 'a',
    afterContent: 'b',
    diffText: '--- a/src/index.ts'
  });

  assert.deepEqual(changes, [{ conversationId: 'conversation-1', filePath: 'src/index.ts' }]);
});
