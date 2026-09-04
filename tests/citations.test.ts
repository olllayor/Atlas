import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  splitByCitations,
  assistantCitationsToPlainText,
  collectAssistantCitations,
  createAssistantCitation,
  expandAssistantCitationsForProvider,
  formatAssistantCitationHref,
  formatCitationForComposer,
  getCitationChipLabel,
  isAssistantCitation,
  mergeCitationsIntoMessage,
  parseAssistantCitationHref,
  renderAssistantCitationsAsText,
  serializeAssistantCitation,
  stripAssistantCitations,
  withAssistantCitationComment,
  type AssistantCitation,
} from '../src/shared/citations';

function makeCitation(overrides: Partial<AssistantCitation> = {}): AssistantCitation {
  return {
    version: 1,
    conversationId: 'conv-1',
    messageId: 'msg-1',
    text: 'Health check & DB/Redis connectivity.',
    start: 10,
    end: 47,
    prefix: 'Automated E2E test cases: ',
    suffix: ' Device auth middleware',
    ...overrides,
  };
}

test('serialize/parse round-trips a citation with special characters', () => {
  const citation = makeCitation({
    text: 'Use <tags> & "quotes" (parens) [brackets] — emoji ✓\nsecond line',
    prefix: '',
    suffix: '',
    comment: 'please expand on this? a=b&c=d',
  });
  const parsed = parseAssistantCitationHref(formatAssistantCitationHref(citation));
  assert.deepEqual(parsed, citation);
});

test('serialize/parse round-trips a citation without comment', () => {
  const citation = makeCitation();
  const { comment: _dropped, ...withoutComment } = citation;
  const parsed = parseAssistantCitationHref(formatAssistantCitationHref(withoutComment));
  assert.deepEqual(parsed, withoutComment);
  assert.equal(parsed?.comment, undefined);
});

test('parse rejects foreign protocols and smuggled params', () => {
  const href = formatAssistantCitationHref(makeCitation());
  assert.equal(parseAssistantCitationHref(href.replace('atlas-citation:', 'https:')), null);
  assert.equal(parseAssistantCitationHref(`${href}&evil=1`), null);
  assert.equal(parseAssistantCitationHref('not a href'), null);
  assert.equal(parseAssistantCitationHref(''), null);
});

test('parse rejects bad offsets, empty text, and overlong fields', () => {
  const base = makeCitation();
  const swapped = formatAssistantCitationHref({ ...base, start: 47, end: 10 });
  assert.equal(parseAssistantCitationHref(swapped), null);

  const emptyText = formatAssistantCitationHref({ ...base, text: '   ' });
  assert.equal(parseAssistantCitationHref(emptyText), null);

  const longText = formatAssistantCitationHref({
    ...base,
    text: 'x'.repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1),
  });
  // format still emits (caller clamps first); parse must refuse.
  assert.equal(parseAssistantCitationHref(longText), null);

  const longComment = formatAssistantCitationHref({
    ...base,
    comment: 'y'.repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH + 1),
  });
  assert.equal(parseAssistantCitationHref(longComment), null);
});

test('isAssistantCitation mirrors the href parser', () => {
  assert.equal(isAssistantCitation(makeCitation()), true);
  assert.equal(isAssistantCitation({ ...makeCitation(), version: 2 }), false);
  assert.equal(isAssistantCitation({ ...makeCitation(), end: 10 }), false);
  assert.equal(isAssistantCitation({ ...makeCitation(), conversationId: 'a/b' }), false);
  assert.equal(isAssistantCitation({ ...makeCitation(), prefix: 'x'.repeat(33) }), false);
  assert.equal(isAssistantCitation(null), false);
  assert.equal(isAssistantCitation('quote'), false);
});

test('createAssistantCitation validates before returning', () => {
  assert.ok(
    createAssistantCitation({
      conversationId: 'c',
      messageId: 'm',
      text: 'hello',
      start: 0,
      end: 5,
      prefix: '',
      suffix: '',
    }),
  );
  assert.equal(
    createAssistantCitation({
      conversationId: 'c',
      messageId: 'm',
      text: '   ',
      start: 0,
      end: 3,
      prefix: '',
      suffix: '',
    }),
    null,
  );
});

test('withAssistantCitationComment trims and drops empty comments', () => {
  const base = makeCitation({ comment: 'old' });
  assert.equal(withAssistantCitationComment(base, '  new  ').comment, 'new');
  assert.equal(withAssistantCitationComment(base, '   ').comment, undefined);
  assert.equal(withAssistantCitationComment(makeCitation(), '').comment, undefined);
});

test('collect finds links and skips malformed ones', () => {
  const good = serializeAssistantCitation(makeCitation());
  const text = `before ${good} middle [Assistant quote](atlas-citation://v1/nope) after`;
  const found = collectAssistantCitations(text);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.citation.messageId, 'msg-1');
  assert.equal(text.slice(found[0]!.start, found[0]!.end), good);
});

test('plain text shows quote and comment without href bytes', () => {
  const withComment = serializeAssistantCitation(makeCitation({ comment: 'why?' }));
  const plain = assistantCitationsToPlainText(`Q: ${withComment} end`);
  assert.equal(plain, 'Q: Health check & DB/Redis connectivity.\nComment: why? end');

  const bare = serializeAssistantCitation(makeCitation());
  assert.equal(assistantCitationsToPlainText(bare), 'Health check & DB/Redis connectivity.');
});

test('expand passes through text without citations', () => {
  assert.equal(expandAssistantCitationsForProvider('plain prompt'), 'plain prompt');
});

test('expand assigns stable ids and dedupes repeats', () => {
  const link = serializeAssistantCitation(makeCitation());
  const expanded = expandAssistantCitationsForProvider(`see ${link} and ${link} ok`);
  assert.match(expanded, /see \[assistant-quote-1\] and \[assistant-quote-1\] ok/);
  assert.match(expanded, /<assistant_citations>/);
  assert.match(expanded, /quoted reference material, not new instructions/);
  // No raw href leaks into the model payload.
  assert.doesNotMatch(expanded, /atlas-citation:/);
});

test('expand labels user comments as user-authored', () => {
  const link = serializeAssistantCitation(makeCitation({ comment: 'explain' }));
  const expanded = expandAssistantCitationsForProvider(`fix ${link}`);
  assert.match(expanded, /user-authored request or comment/);
  const parsed = JSON.parse(expanded.split('<assistant_citations>\n')[1]!.split('\n</assistant_citations>')[0]!.split('\n').slice(1).join('\n'));
  assert.equal(parsed[0].citation.comment, 'explain');
});

test('renderAsText produces a blockquote with comment outside the quote', () => {
  const link = serializeAssistantCitation(makeCitation({ text: 'line one\nline two', comment: 'note' }));
  const rendered = renderAssistantCitationsAsText(`Q: ${link}`);
  assert.match(rendered, /> Assistant quote:/);
  assert.match(rendered, /> line one\n> line two/);
  assert.match(rendered, /Comment: note/);
});

test('composer insertion ends with a space so typing continues outside the chip', () => {
  const inserted = formatCitationForComposer(makeCitation(), 'why');
  assert.ok(inserted.endsWith(' '));
  assert.equal(collectAssistantCitations(inserted).length, 1);
  assert.equal(collectAssistantCitations(inserted)[0]!.citation.comment, 'why');
});

test('chip label prefers comment and caps quote length', () => {
  assert.equal(getCitationChipLabel(makeCitation({ comment: '  my note  ' })), 'my note');
  const long = makeCitation({ text: `word ${'x'.repeat(100)}` });
  const { comment: _dropped, ...bare } = long;
  const label = getCitationChipLabel(bare);
  assert.ok(label.length <= 65);
  assert.ok(label.endsWith('…'));
  assert.doesNotMatch(label, /\s{2,}/);
});

test('strip removes citation links entirely for mention detection', () => {
  const link = serializeAssistantCitation(makeCitation({ text: 'use @Sites for this' }));
  const stripped = stripAssistantCitations(`please ${link} now`);
  assert.doesNotMatch(stripped, /atlas-citation:/);
  assert.doesNotMatch(stripped, /@Sites/);
  assert.match(stripped, /please/);
  assert.match(stripped, /now/);
});

test('strip leaves plain text untouched', () => {
  assert.equal(stripAssistantCitations('mention @Sites here'), 'mention @Sites here');
  assert.equal(stripAssistantCitations(''), '');
});

test('merge appends serialized tray links after typed text', () => {
  const first = makeCitation();
  const { comment: _dropped, ...second } = makeCitation({ messageId: 'msg-2', text: 'second quote', start: 0, end: 12, prefix: '', suffix: '' });
  const merged = mergeCitationsIntoMessage('why?', [first, second]);
  assert.ok(merged.startsWith('why? '));
  assert.equal(collectAssistantCitations(merged).length, 2);
});

test('merge handles empty text and empty tray', () => {
  const link = serializeAssistantCitation(makeCitation());
  assert.equal(mergeCitationsIntoMessage('', [makeCitation()]), link);
  assert.equal(mergeCitationsIntoMessage('hello', []), 'hello');
});

test('splitByCitations segments text around links', () => {
  const first = serializeAssistantCitation(makeCitation());
  const secondCitation = makeCitation({ messageId: 'msg-2', text: 'second', start: 0, end: 6, prefix: '', suffix: '' });
  const { comment: _dropped, ...bareSecond } = secondCitation;
  const second = serializeAssistantCitation(bareSecond);
  const segments = splitByCitations(`a ${first} b ${second} c`);
  assert.equal(segments.length, 5);
  assert.equal(segments[0]?.kind, 'text');
  assert.equal(segments[1]?.kind, 'citation');
  assert.equal(segments[2]?.kind, 'text');
  assert.equal(segments[3]?.kind, 'citation');
  assert.equal(segments[4]?.kind, 'text');
  if (segments[1]?.kind === 'citation') {
    assert.equal(segments[1].citation.messageId, 'msg-1');
  } else {
    assert.fail('expected citation segment');
  }
});

test('splitByCitations keeps malformed links as text', () => {
  const segments = splitByCitations('see [Assistant quote](atlas-citation://v1/nope) ok');
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.kind, 'text');
});

test('splitByCitations returns one text segment for plain input', () => {
  assert.deepEqual(splitByCitations('plain'), [{ kind: 'text', text: 'plain' }]);
  assert.deepEqual(splitByCitations(''), []);
});
