import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCiteSelector,
  findCitedText,
  normalizeCiteWhitespace,
} from '../src/renderer/lib/citeSelection';

test('normalizeCiteWhitespace collapses runs to one space', () => {
  assert.equal(normalizeCiteWhitespace('a  \n\t b'), 'a b');
});

test('createCiteSelector keeps exact text with normalized offsets', () => {
  const text = 'Hello   world\nnewline';
  const selector = createCiteSelector(text, 0, text.length);
  assert.ok(selector);
  assert.equal(selector.text, text);
  // "Hello   world\nnewline" normalizes to "Hello world newline" (19 chars).
  assert.equal(selector.start, 0);
  assert.equal(selector.end, 19);
  assert.equal(selector.prefix, '');
  assert.equal(selector.suffix, '');
});

test('createCiteSelector stores prefix and suffix context', () => {
  const text = 'aaa SELECTION bbb';
  const selector = createCiteSelector(text, 4, 13);
  assert.ok(selector);
  assert.equal(selector.text, 'SELECTION');
  assert.equal(selector.prefix, 'aaa ');
  assert.equal(selector.suffix, ' bbb');
});

test('createCiteSelector returns null for blank selections', () => {
  assert.equal(createCiteSelector('hello   world', 5, 8), null);
});

test('findCitedText matches exact offsets with context', () => {
  const text = 'aaa SELECTION bbb';
  const selector = createCiteSelector(text, 4, 13)!;
  assert.deepEqual(findCitedText(text, selector), { start: 4, end: 13 });
});

test('findCitedText resolves drifted offsets through context', () => {
  const text = 'aaa SELECTION bbb';
  const selector = createCiteSelector(text, 4, 13)!;
  const drifted = { ...selector, start: 0, end: 9 };
  assert.deepEqual(findCitedText(text, drifted), { start: 4, end: 13 });
});

test('findCitedText accepts a unique quote even without context', () => {
  const text = 'aaa SELECTION bbb';
  const selector = { text: 'SELECTION', start: 0, end: 9, prefix: '', suffix: '' };
  assert.deepEqual(findCitedText(text, selector), { start: 4, end: 13 });
});

test('findCitedText refuses repeated quotes without disambiguating context', () => {
  const text = 'yes no yes';
  const selector = { text: 'yes', start: 0, end: 3, prefix: '', suffix: '' };
  assert.equal(findCitedText(text, selector), null);
});

test('findCitedText refuses context ties instead of guessing', () => {
  // Identical 32-char windows on both sides of each occurrence.
  const filler = ' word'.repeat(20);
  const text = `${filler} SELECTION ${filler} SELECTION ${filler}`;
  const first = text.indexOf('SELECTION');
  const selector = createCiteSelector(text, first, first + 9)!;
  assert.equal(findCitedText(text, selector), null);
});

test('findCitedText rejects blank quotes', () => {
  assert.equal(
    findCitedText('hello', { text: '  ', start: 0, end: 2, prefix: '', suffix: '' }),
    null,
  );
});
