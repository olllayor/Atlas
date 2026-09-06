import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitTextByUrls } from '../src/shared/linkify';

describe('splitTextByUrls', () => {
  it('leaves plain text alone', () => {
    assert.deepEqual(splitTextByUrls('just some words'), [{ kind: 'text', text: 'just some words' }]);
  });

  it('finds a lone URL', () => {
    assert.deepEqual(splitTextByUrls('https://github.com/pingdotgg/t3code/pull/5307'), [
      { kind: 'url', url: 'https://github.com/pingdotgg/t3code/pull/5307' },
    ]);
  });

  it('splits surrounding prose', () => {
    assert.deepEqual(splitTextByUrls('see https://example.com/a and enjoy'), [
      { kind: 'text', text: 'see ' },
      { kind: 'url', url: 'https://example.com/a' },
      { kind: 'text', text: ' and enjoy' },
    ]);
  });

  it('strips sentence punctuation and closers', () => {
    assert.deepEqual(splitTextByUrls('(see https://github.com/x/y.)'), [
      { kind: 'text', text: '(see ' },
      { kind: 'url', url: 'https://github.com/x/y' },
      { kind: 'text', text: '.)' },
    ]);
    assert.deepEqual(splitTextByUrls('wow! https://example.com/a, right?'), [
      { kind: 'text', text: 'wow! ' },
      { kind: 'url', url: 'https://example.com/a' },
      { kind: 'text', text: ',' },
      { kind: 'text', text: ' right?' },
    ]);
  });

  it('keeps balanced parens inside the URL', () => {
    assert.deepEqual(splitTextByUrls('https://en.wikipedia.org/wiki/X_(disambiguation) ok'), [
      { kind: 'url', url: 'https://en.wikipedia.org/wiki/X_(disambiguation)' },
      { kind: 'text', text: ' ok' },
    ]);
  });

  it('finds several URLs in one run', () => {
    assert.deepEqual(splitTextByUrls('https://a.com/1 https://b.com/2'), [
      { kind: 'url', url: 'https://a.com/1' },
      { kind: 'text', text: ' ' },
      { kind: 'url', url: 'https://b.com/2' },
    ]);
  });

  it('ignores non-web schemes', () => {
    assert.deepEqual(splitTextByUrls('see atlas://cite/abc and javascript:alert(1)'), [
      { kind: 'text', text: 'see atlas://cite/abc and javascript:alert(1)' },
    ]);
  });

  it('leaves unparseable candidates as text', () => {
    assert.deepEqual(splitTextByUrls('broken https://??? link'), [
      { kind: 'text', text: 'broken https://??? link' },
    ]);
  });

  it('keeps localhost links', () => {
    assert.deepEqual(splitTextByUrls('dev at http://localhost:3000/x'), [
      { kind: 'text', text: 'dev at ' },
      { kind: 'url', url: 'http://localhost:3000/x' },
    ]);
  });
});
