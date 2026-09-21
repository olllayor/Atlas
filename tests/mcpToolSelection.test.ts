import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MCP_TOOLS_PER_TURN,
  countWithheldByServer,
  selectToolsForTurn
} from '../src/main/ai/mcp/mcpToolsProvider.js';

const toolsFor = (serverId: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    serverId,
    toolName: `${serverId}_tool_${String(index).padStart(3, '0')}`
  }));

test('an under-cap set is offered whole', () => {
  const offered = [...toolsFor('b', 3), ...toolsFor('a', 2)];
  const selected = selectToolsForTurn(offered);
  assert.equal(selected.length, 5);
  assert.deepEqual(new Set(selected.map((t) => t.toolName)), new Set(offered.map((t) => t.toolName)));
});

test('a chatty server cannot starve a quiet one', () => {
  // Regression: sorting by serverId then slicing dropped every server that
  // sorted after the chatty one, so the user silently lost whole integrations.
  const offered = [...toolsFor('aaa-github', 90), ...toolsFor('zzz-linear', 10)];
  const selected = selectToolsForTurn(offered);

  assert.equal(selected.length, MAX_MCP_TOOLS_PER_TURN);
  const linear = selected.filter((t) => t.serverId === 'zzz-linear');
  assert.equal(linear.length, 10, 'the small server keeps all of its tools');
  assert.equal(selected.filter((t) => t.serverId === 'aaa-github').length, MAX_MCP_TOOLS_PER_TURN - 10);
});

test('selection is stable across turns so the prefix cache holds', () => {
  const offered = [...toolsFor('a', 40), ...toolsFor('b', 40)];
  const shuffled = [...offered].reverse();
  assert.deepEqual(selectToolsForTurn(offered), selectToolsForTurn(shuffled));
});

test('withheld counts are per server, not the global total', () => {
  const offered = [...toolsFor('aaa-github', 90), ...toolsFor('zzz-linear', 10)];
  const withheld = countWithheldByServer(offered, selectToolsForTurn(offered));

  assert.equal(withheld.get('aaa-github'), 36);
  assert.equal(withheld.has('zzz-linear'), false, 'a server that lost nothing is absent');
});
