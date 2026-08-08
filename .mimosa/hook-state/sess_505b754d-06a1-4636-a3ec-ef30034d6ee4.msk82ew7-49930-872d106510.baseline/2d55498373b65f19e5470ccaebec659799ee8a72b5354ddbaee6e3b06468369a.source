import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MENTION_DEFINITIONS,
  applyMention,
  filterMentions,
  getMentionToken,
  hasMention,
  matchMentionQuery,
  parseMentions,
} from '../src/shared/mentions.js';

const SITES = MENTION_DEFINITIONS.find((definition) => definition.id === 'sites')!;

test('parseMentions detects @Sites regardless of casing and position', () => {
  assert.deepEqual(parseMentions('@Sites build me a landing page'), ['sites']);
  assert.deepEqual(parseMentions('build me a page @sites'), ['sites']);
  assert.deepEqual(parseMentions('please @SITES do it'), ['sites']);
  assert.equal(hasMention('@Sites go', 'sites'), true);
});

test('parseMentions ignores text that merely contains the word', () => {
  assert.deepEqual(parseMentions('build some sites for me'), []);
  assert.deepEqual(parseMentions('what are static sites?'), []);
  assert.deepEqual(parseMentions(''), []);
});

test('parseMentions requires the trigger to start a word', () => {
  // Email addresses and decorators must never silently enable a toolset.
  assert.deepEqual(parseMentions('mail me at bob@sites.example'), []);
  assert.deepEqual(parseMentions('foo@Sites'), []);
  assert.deepEqual(parseMentions('@@Sites'), []);
});

test('parseMentions requires a word boundary after the label', () => {
  assert.deepEqual(parseMentions('@Sitesmith is a company'), []);
  assert.deepEqual(parseMentions('@Sites.'), ['sites']);
  assert.deepEqual(parseMentions('@Sites, please'), ['sites']);
});

test('matchMentionQuery tracks an in-progress mention at the caret', () => {
  const text = 'hey @Si';
  const match = matchMentionQuery(text, text.length);

  assert.ok(match);
  assert.equal(match?.query, 'Si');
  assert.equal(match?.start, 4);
  assert.equal(match?.end, 7);
});

test('matchMentionQuery opens immediately on a bare trigger', () => {
  const match = matchMentionQuery('@', 1);
  assert.ok(match);
  assert.equal(match?.query, '');
});

test('matchMentionQuery closes once the mention is no longer at the caret', () => {
  assert.equal(matchMentionQuery('@Sites and then', 15), null, 'whitespace ends the attempt');
  assert.equal(matchMentionQuery('no trigger here', 15), null);
  assert.equal(matchMentionQuery('bob@sites', 9), null, 'trigger must start a word');
});

test('filterMentions matches label, id, and keywords', () => {
  assert.deepEqual(filterMentions('site').map((entry) => entry.id), ['sites']);
  assert.deepEqual(filterMentions('landing').map((entry) => entry.id), ['sites']);
  assert.deepEqual(filterMentions('').map((entry) => entry.id), MENTION_DEFINITIONS.map((entry) => entry.id));
  assert.deepEqual(filterMentions('nonsense'), []);
});

test('applyMention completes the token and reports the new caret', () => {
  const text = 'hey @Si there';
  const match = matchMentionQuery(text, 7)!;
  const result = applyMention(text, match, SITES);

  assert.equal(result.text, 'hey @Sites  there');
  assert.equal(result.caret, 'hey @Sites '.length);
  // The completed text must round-trip through the parser.
  assert.deepEqual(parseMentions(result.text), ['sites']);
});

test('getMentionToken uses canonical casing', () => {
  assert.equal(getMentionToken(SITES), '@Sites');
});
