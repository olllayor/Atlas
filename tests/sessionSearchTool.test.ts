import assert from 'node:assert/strict';
import test from 'node:test';

import { MESSAGE_SEARCH_MATCH_CLOSE, MESSAGE_SEARCH_MATCH_OPEN } from '../src/shared/contracts.js';
import type { MessageSearchHit, SearchMessagesRequest } from '../src/shared/contracts.js';
import { createBuiltInTools } from '../src/main/ai/tools/builtInTools.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

const MODELS_REPO = { list: () => [], getRuntimeHints: () => ({}) } as never;

const WORK_WORKSPACE: ToolWorkspace = { mode: 'work', executionTarget: 'local', root: null };

type SessionSearchTool = {
  needsApproval?: unknown;
  execute: (input: { query: string; projectOnly: boolean; limit: number }) => Promise<{
    totalMatches: number;
    results: Array<{
      conversationTitle: string;
      conversationId: string;
      role: string;
      snippet: string;
      createdAt: string;
    }>;
  }>;
};

function createFakeSource(hits: MessageSearchHit[] = []) {
  const requests: SearchMessagesRequest[] = [];
  return {
    requests,
    searchMessages: (request: SearchMessagesRequest) => {
      requests.push(request);
      return hits;
    },
  };
}

function createHit(overrides: Partial<MessageSearchHit> = {}): MessageSearchHit {
  return {
    conversationId: 'conversation-1',
    conversationTitle: 'Older chat',
    messageId: 'message-1',
    role: 'user',
    snippet: 'plain snippet',
    createdAt: '2026-08-01T00:00:00.000Z',
    archived: false,
    ...overrides,
  };
}

function sessionSearchTool(
  source: ReturnType<typeof createFakeSource>,
  workspace: ToolWorkspace = WORK_WORKSPACE,
): SessionSearchTool {
  const tools = createBuiltInTools(MODELS_REPO, null, 'ask', workspace, undefined, undefined, source) as Record<
    string,
    SessionSearchTool
  >;
  return tools.session_search;
}

test('session_search is offered in every permission mode and never needs approval', () => {
  for (const mode of ['read-only', 'ask', 'full-access'] as const) {
    const source = createFakeSource();
    const tools = createBuiltInTools(MODELS_REPO, null, mode, WORK_WORKSPACE, undefined, undefined, source) as Record<
      string,
      SessionSearchTool
    >;

    assert.ok(tools.session_search, `session_search must exist in ${mode} mode`);
    assert.equal(tools.session_search.needsApproval, undefined, `recall is read-only in ${mode} mode`);
  }
});

test('session_search is omitted when no search source is provided', () => {
  const tools = createBuiltInTools(MODELS_REPO, null, 'ask', WORK_WORKSPACE) as Record<string, unknown>;
  assert.equal(tools.session_search, undefined);
});

test('session_search maps hits and translates match markers to markdown', async () => {
  const source = createFakeSource([
    createHit({
      snippet: `before ${MESSAGE_SEARCH_MATCH_OPEN}checkpoint${MESSAGE_SEARCH_MATCH_CLOSE} after`,
    }),
  ]);

  const result = await sessionSearchTool(source).execute({ query: 'checkpoint', projectOnly: false, limit: 8 });

  assert.equal(result.totalMatches, 1);
  assert.deepEqual(result.results, [
    {
      conversationTitle: 'Older chat',
      conversationId: 'conversation-1',
      role: 'user',
      snippet: 'before **checkpoint** after',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ]);
  assert.ok(!result.results[0].snippet.includes(MESSAGE_SEARCH_MATCH_OPEN), 'no PUA marker reaches the model');
});

test('session_search passes the project filter only when asked and available', async () => {
  const workspace: ToolWorkspace = { ...WORK_WORKSPACE, projectId: 'project-1' };

  const scoped = createFakeSource();
  await sessionSearchTool(scoped, workspace).execute({ query: 'checkpoint', projectOnly: true, limit: 8 });
  assert.equal(scoped.requests[0]?.projectId, 'project-1');

  const unscoped = createFakeSource();
  await sessionSearchTool(unscoped, workspace).execute({ query: 'checkpoint', projectOnly: false, limit: 8 });
  assert.equal(unscoped.requests[0]?.projectId, null, 'projectOnly off searches everything');
});

test('projectOnly without an attached project searches everything rather than nothing', async () => {
  const source = createFakeSource();
  await sessionSearchTool(source, WORK_WORKSPACE).execute({ query: 'checkpoint', projectOnly: true, limit: 8 });

  assert.equal(source.requests[0]?.projectId, null);
});

test('session_search forwards query and limit and never asks for archived chats', async () => {
  const source = createFakeSource();
  // Direct execute calls bypass zod's .trim(); the model path gets trimmed
  // input, and the repo's tokenizer tolerates whitespace either way.
  await sessionSearchTool(source).execute({ query: 'compaction ladder', projectOnly: false, limit: 3 });

  assert.deepEqual(source.requests[0], {
    query: 'compaction ladder',
    limit: 3,
    includeArchived: false,
    projectId: null,
  });
});

test('session_search reports an empty result set honestly', async () => {
  const result = await sessionSearchTool(createFakeSource()).execute({
    query: 'nothing matches this',
    projectOnly: false,
    limit: 8,
  });

  assert.deepEqual(result, { totalMatches: 0, results: [] });
});
