import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_SLASH_COMMANDS,
  filterSlashCommands,
  matchCommandAtStart,
  parseStandaloneSlashCommand,
} from '../src/renderer/lib/slashCommands.js';

test('the built-in set is the fixed control vocabulary', () => {
  const names = BUILTIN_SLASH_COMMANDS.map((command) => command.name);
  assert.deepEqual(names, ['compact', 'review', 'fork', 'side', 'goal', 'model', 'plan']);
});

test('parseStandaloneSlashCommand consumes exact invocations only', () => {
  assert.equal(parseStandaloneSlashCommand('/compact')?.name, 'compact');
  assert.equal(parseStandaloneSlashCommand('/COMPACT ')?.name, 'compact');
  assert.equal(parseStandaloneSlashCommand(' /review'), null, 'must start at column zero');
  assert.equal(parseStandaloneSlashCommand('/compact now'), null, 'trailing args are not standalone');
  assert.equal(parseStandaloneSlashCommand('/unknown'), null);
  assert.equal(parseStandaloneSlashCommand('compact'), null);
});

test('matchCommandAtStart recognizes a command prefix and its word boundary', () => {
  assert.equal(matchCommandAtStart('/revie'), null, 'partial names are autocomplete territory');
  assert.equal(matchCommandAtStart('/review')?.name, 'review');
  assert.equal(matchCommandAtStart('/review extra')?.name, 'review');
  assert.equal(
    matchCommandAtStart('/reviews'),
    null,
    'longer names do not shadow shorter commands'
  );
  assert.equal(matchCommandAtStart('hey /review'), null);
});

test('filterSlashCommands matches names and descriptions', () => {
  assert.deepEqual(filterSlashCommands('').length, BUILTIN_SLASH_COMMANDS.length);
  assert.deepEqual(filterSlashCommands('comp').map((command) => command.name), ['compact']);
  assert.ok(filterSlashCommands('diff').some((command) => command.name === 'review'));
  assert.deepEqual(filterSlashCommands('zzz'), []);
});
