import assert from 'node:assert/strict';
import test from 'node:test';

import type { PluginMentionEntry } from '../src/shared/pluginMentions.js';
import {
  applyPluginMention,
  describePluginMention,
  matchPluginMentionQuery,
  parsePluginMentions,
  suggestPluginMentions
} from '../src/shared/pluginMentions.js';

const CATALOG: PluginMentionEntry[] = [
  { name: 'github', description: 'Issues and pull requests', skills: ['pr-review', 'triage'], available: true },
  { name: 'github-actions', description: 'Workflow runs', skills: ['rerun'], available: true },
  { name: 'kanban', description: 'Boards', skills: [], available: true },
  {
    name: 'archived',
    description: 'Switched off',
    skills: ['go'],
    available: false,
    unavailableReason: 'Disabled.'
  }
];

/* ------------------------------------------------------------------ *
 * Parsing what a message named
 * ------------------------------------------------------------------ */

test('a bare plugin mention names the plugin and no skill', () => {
  assert.deepEqual(parsePluginMentions('@github what changed?', CATALOG), [
    { plugin: 'github', skill: null }
  ]);
});

test('a following word is a skill only when the plugin actually has one by that name', () => {
  assert.deepEqual(parsePluginMentions('@github pr-review this branch', CATALOG), [
    { plugin: 'github', skill: 'pr-review' }
  ]);

  // The common case. "fix" must not become a failed skill lookup.
  assert.deepEqual(parsePluginMentions('@github fix this bug', CATALOG), [
    { plugin: 'github', skill: null }
  ]);
});

test('the longest plugin name wins', () => {
  // Otherwise `@github-actions` matches `@github` and leaves `-actions` behind
  // as a stray word.
  assert.deepEqual(parsePluginMentions('@github-actions rerun it', CATALOG), [
    { plugin: 'github-actions', skill: 'rerun' }
  ]);
});

test('a plugin name must end at a word boundary', () => {
  assert.deepEqual(parsePluginMentions('@githubbing', CATALOG), []);
  assert.deepEqual(parsePluginMentions('@kanbanx', CATALOG), []);
});

test('@ must start a word, so addresses and code do not scope a turn', () => {
  assert.deepEqual(parsePluginMentions('mail me at me@github.com', CATALOG), []);
  assert.deepEqual(parsePluginMentions('see foo@github', CATALOG), []);
  assert.deepEqual(parsePluginMentions('@@github', CATALOG), []);
});

test('an unknown name is not a mention', () => {
  assert.deepEqual(parsePluginMentions('@nonesuch do it', CATALOG), []);
});

test('several plugins in one message all resolve', () => {
  assert.deepEqual(parsePluginMentions('@github triage then @kanban', CATALOG), [
    { plugin: 'github', skill: 'triage' },
    { plugin: 'kanban', skill: null }
  ]);
});

test('the same plugin twice is one activation, but two skills are two requests', () => {
  assert.deepEqual(parsePluginMentions('@github and @github again', CATALOG), [
    { plugin: 'github', skill: null }
  ]);

  assert.deepEqual(parsePluginMentions('@github triage and @github pr-review', CATALOG), [
    { plugin: 'github', skill: 'triage' },
    { plugin: 'github', skill: 'pr-review' }
  ]);
});

test('an unavailable plugin still parses — refusing it is the runtime\'s job, not the parser\'s', () => {
  // The user must get "that plugin is disabled", not silence. A parser that
  // dropped it would make the mention indistinguishable from a typo.
  assert.deepEqual(parsePluginMentions('@archived go', CATALOG), [
    { plugin: 'archived', skill: 'go' }
  ]);
});

test('an empty message or an empty catalogue yields nothing', () => {
  assert.deepEqual(parsePluginMentions('', CATALOG), []);
  assert.deepEqual(parsePluginMentions('@github', []), []);
});

/* ------------------------------------------------------------------ *
 * The autocomplete
 * ------------------------------------------------------------------ */

function queryAt(text: string) {
  return matchPluginMentionQuery(text, text.length, CATALOG);
}

test('typing @ opens the picker with every plugin', () => {
  const query = queryAt('@');
  assert.ok(query);
  assert.equal(query.skillQuery, null);

  const suggestions = suggestPluginMentions(query, CATALOG);
  assert.deepEqual(
    suggestions.map((s) => s.kind === 'plugin' && s.entry.name),
    ['github', 'github-actions', 'kanban', 'archived']
  );
});

test('typing narrows by name and description', () => {
  assert.deepEqual(
    suggestPluginMentions(queryAt('@git')!, CATALOG).map((s) => s.kind === 'plugin' && s.entry.name),
    ['github', 'github-actions']
  );

  assert.deepEqual(
    suggestPluginMentions(queryAt('@boards')!, CATALOG).map((s) => s.kind === 'plugin' && s.entry.name),
    ['kanban'],
    'the description is searchable too'
  );
});

test('a disabled plugin is offered with its reason rather than hidden', () => {
  // Missing from the picker reads as "not installed", and the user goes looking
  // in the browser for something already there.
  const shown = suggestPluginMentions(queryAt('@arch')!, CATALOG);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].kind === 'plugin' && shown[0].entry.unavailableReason, 'Disabled.');
});

test('a space after a known plugin switches the picker to its skills', () => {
  const query = queryAt('@github ');

  assert.ok(query);
  assert.equal(query.skillQuery, '');
  assert.equal(query.plugin?.name, 'github');

  assert.deepEqual(
    suggestPluginMentions(query, CATALOG).map((s) => (s.kind === 'skill' ? s.skill : null)),
    ['pr-review', 'triage']
  );
});

test('the skill half narrows as it is typed', () => {
  assert.deepEqual(
    suggestPluginMentions(queryAt('@github pr')!, CATALOG).map((s) => (s.kind === 'skill' ? s.skill : null)),
    ['pr-review']
  );
});

test('the picker closes once the message moves on', () => {
  // Otherwise it would hang open across an entire sentence.
  assert.equal(queryAt('@github fix the bug'), null);
  assert.equal(queryAt('@unknown '), null, 'an unknown plugin opens no skill half');
  assert.equal(queryAt('@github\n'), null);
});

test('the picker does not open where a mention could not be', () => {
  assert.equal(queryAt('me@github'), null);
  assert.equal(matchPluginMentionQuery('@github', -1, CATALOG), null);
  assert.equal(matchPluginMentionQuery('@github', 99, CATALOG), null);
});

/* ------------------------------------------------------------------ *
 * Completing one
 * ------------------------------------------------------------------ */

test('choosing a plugin leaves the caret ready for a skill, not past it', () => {
  const text = 'look at @git please';
  const query = matchPluginMentionQuery(text, 12, CATALOG)!;
  const applied = applyPluginMention(text, query, { kind: 'plugin', entry: CATALOG[0] });

  // No trailing space: the next keystroke is usually the space that opens the
  // skill picker, and inserting one here would fire it unasked.
  assert.equal(applied.text, 'look at @github please');
  assert.equal(applied.caret, 'look at @github'.length);
});

test('choosing a skill completes the whole mention', () => {
  const text = '@github pr';
  const query = matchPluginMentionQuery(text, text.length, CATALOG)!;
  const applied = applyPluginMention(text, query, {
    kind: 'skill',
    entry: CATALOG[0],
    skill: 'pr-review'
  });

  assert.equal(applied.text, '@github pr-review ');
  assert.equal(applied.caret, applied.text.length);
});

test('a completed mention round-trips back through the parser', () => {
  const applied = applyPluginMention('@git', queryAt('@git')!, {
    kind: 'skill',
    entry: CATALOG[0],
    skill: 'triage'
  });

  assert.deepEqual(parsePluginMentions(applied.text, CATALOG), [
    { plugin: 'github', skill: 'triage' }
  ]);
});

test('a mention describes itself the way the transcript shows it', () => {
  assert.equal(describePluginMention({ plugin: 'github', skill: null }), '@github');
  assert.equal(describePluginMention({ plugin: 'github', skill: 'triage' }), '@github triage');
});
