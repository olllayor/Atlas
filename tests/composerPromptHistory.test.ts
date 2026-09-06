import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistantCitation } from '../src/shared/citations.js';
import { mergeCitationsIntoMessage } from '../src/shared/citations.js';
import {
  buildComposerPromptHistoryEntries,
  recallableComposerPrompt,
  stepComposerPromptHistory,
  type ComposerPromptHistoryPosition,
} from '../src/shared/composerPromptHistory.js';

const CITATION: AssistantCitation = {
  version: 1,
  conversationId: 'conv-1',
  messageId: 'msg-1',
  text: 'quoted assistant text',
  start: 0,
  end: 21,
  prefix: '',
  suffix: '',
};

const ENTRIES = buildComposerPromptHistoryEntries([
  { id: 'm1', role: 'user', text: 'first' },
  { id: 'a1', role: 'assistant', text: 'reply' },
  { id: 'm2', role: 'user', text: 'second' },
  { id: 'm3', role: 'user', text: 'third' },
]);

function backward(position: ComposerPromptHistoryPosition | null, currentPrompt: string) {
  return stepComposerPromptHistory({ direction: 'backward', entries: ENTRIES, position, currentPrompt });
}

function forward(position: ComposerPromptHistoryPosition | null, currentPrompt: string) {
  return stepComposerPromptHistory({ direction: 'forward', entries: ENTRIES, position, currentPrompt });
}

test('recallableComposerPrompt strips send-time citation links', () => {
  const sent = mergeCitationsIntoMessage('Please update this.', [CITATION]);
  assert.notEqual(sent, 'Please update this.');
  assert.equal(recallableComposerPrompt(sent), 'Please update this.');
});

test('recallableComposerPrompt keeps a citation link typed mid-prompt', () => {
  const sent = mergeCitationsIntoMessage('Please update this.', [CITATION]);
  const link = sent.slice('Please update this.'.length).trim();
  const midPrompt = `Before ${link} after`;
  assert.equal(recallableComposerPrompt(midPrompt), midPrompt);
});

test('recallableComposerPrompt returns empty for blank sends', () => {
  assert.equal(recallableComposerPrompt('   '), '');
});

test('buildComposerPromptHistoryEntries keeps user messages with text, oldest first', () => {
  assert.deepEqual(
    ENTRIES.map((entry) => entry.prompt),
    ['first', 'second', 'third'],
  );
});

test('buildComposerPromptHistoryEntries skips assistant and attachment-only sends', () => {
  const entries = buildComposerPromptHistoryEntries([
    { id: 'a1', role: 'assistant', text: 'reply' },
    { id: 'm1', role: 'user', text: '   ' },
    { id: 'm2', role: 'user', text: 'real prompt' },
  ]);
  assert.deepEqual(entries, [{ id: 'm2', prompt: 'real prompt' }]);
});

test('buildComposerPromptHistoryEntries collapses consecutive duplicates onto the newest id', () => {
  const collapsed = buildComposerPromptHistoryEntries([
    { id: 'm1', role: 'user', text: 'same' },
    { id: 'm2', role: 'user', text: 'same' },
    { id: 'm3', role: 'user', text: 'other' },
    { id: 'm4', role: 'user', text: 'same' },
  ]);
  assert.deepEqual(collapsed, [
    { id: 'm2', prompt: 'same' },
    { id: 'm3', prompt: 'other' },
    { id: 'm4', prompt: 'same' },
  ]);
});

test('stepComposerPromptHistory does not start browsing from a non-empty draft', () => {
  assert.equal(backward(null, 'typing'), null);
});

test('stepComposerPromptHistory walks back from the newest entry', () => {
  const first = backward(null, '');
  assert.deepEqual(first, { position: { entryId: 'm3', recalled: 'third' }, prompt: 'third' });
  assert.equal(backward(first!.position, 'third')?.prompt, 'second');
});

test('stepComposerPromptHistory is a no-op at the oldest entry so the caret keeps moving', () => {
  assert.equal(backward({ entryId: 'm1', recalled: 'first' }, 'first'), null);
});

test('stepComposerPromptHistory walks forward and empties the composer past the newest entry', () => {
  const newer = forward({ entryId: 'm2', recalled: 'second' }, 'second');
  assert.equal(newer?.prompt, 'third');
  assert.deepEqual(forward(newer!.position, 'third'), { position: null, prompt: '' });
});

test('stepComposerPromptHistory treats an edited recall as a fresh draft', () => {
  const position: ComposerPromptHistoryPosition = { entryId: 'm3', recalled: 'third' };
  assert.equal(backward(position, 'third edited'), null);
  assert.equal(forward(position, 'third edited'), null);
  // Sent and cleared: ArrowUp starts over from the newest entry.
  assert.deepEqual(backward(position, '')?.position, { entryId: 'm3', recalled: 'third' });
});

test('stepComposerPromptHistory does nothing on forward when not browsing', () => {
  assert.equal(forward(null, ''), null);
});

test('stepComposerPromptHistory follows the entry by id when the list changes under it', () => {
  const grown = buildComposerPromptHistoryEntries([
    { id: 'm0', role: 'user', text: 'zeroth' },
    { id: 'm1', role: 'user', text: 'A' },
    { id: 'm2', role: 'user', text: 'B' },
    { id: 'm3', role: 'user', text: 'A' },
  ]);
  const older = stepComposerPromptHistory({
    direction: 'backward',
    entries: grown,
    position: { entryId: 'm1', recalled: 'A' },
    currentPrompt: 'A',
  });
  assert.equal(older?.prompt, 'zeroth');
  // Unknown id with no matching text: browsing is over.
  const missing = stepComposerPromptHistory({
    direction: 'forward',
    entries: grown,
    position: { entryId: 'gone', recalled: 'not sent' },
    currentPrompt: 'not sent',
  });
  assert.equal(missing, null);
});

test('stepComposerPromptHistory falls back to matching text when a duplicate collapse retires the id', () => {
  const collapsed = buildComposerPromptHistoryEntries([
    { id: 'm1', role: 'user', text: 'first' },
    { id: 'm3', role: 'user', text: 'A' },
  ]);
  const step = stepComposerPromptHistory({
    direction: 'backward',
    entries: collapsed,
    position: { entryId: 'm2', recalled: 'A' },
    currentPrompt: 'A',
  });
  assert.equal(step?.prompt, 'first');
});
