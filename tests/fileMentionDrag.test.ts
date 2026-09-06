import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FILE_MENTION_DRAG_TYPE,
  composerFileMentionFromPath,
  createFileTreeDragController,
  dataTransferHasFileMention,
  makeComposerFileMentionDragHandlers,
  type FileMentionDropHost,
} from '../src/shared/fileMentionDrag';

const makeDragEvent = (options?: { mention?: string; types?: ReadonlyArray<string> }) => {
  const mention = options?.mention ?? '`docs/index.md`';
  const calls: Array<string> = [];
  const event = {
    dataTransfer: {
      types: options?.types ?? [FILE_MENTION_DRAG_TYPE, 'text/plain'],
      getData: (format: string) => (format === FILE_MENTION_DRAG_TYPE ? mention : ''),
      dropEffect: 'none',
    },
    nativeEvent: {
      stopPropagation: () => void calls.push('nativeStopPropagation'),
    },
    preventDefault: () => void calls.push('preventDefault'),
    stopPropagation: () => void calls.push('stopPropagation'),
  };
  return { event, calls };
};

const makeHost = (insertResult = true) => {
  const log: Array<string> = [];
  const host: FileMentionDropHost = {
    insertMentionAtEnd: (text) => {
      log.push(`insert:${text}`);
      return insertResult;
    },
    setDragActive: (active) => void log.push(`active:${active}`),
    onInsertRejected: () => void log.push('rejected'),
  };
  return { host, log };
};

test('composerFileMentionFromPath serializes a path as inline code', () => {
  assert.equal(composerFileMentionFromPath('docs/index.md'), '`docs/index.md`');
});

test('composerFileMentionFromPath strips the trailing slash directory rows carry', () => {
  assert.equal(composerFileMentionFromPath('docs/architecture/'), '`docs/architecture`');
});

test('composerFileMentionFromPath rejects drags that carry no path', () => {
  assert.equal(composerFileMentionFromPath(''), null);
  assert.equal(composerFileMentionFromPath('/'), null);
});

test('dataTransferHasFileMention detects the mention payload among drag types', () => {
  assert.equal(dataTransferHasFileMention([FILE_MENTION_DRAG_TYPE, 'text/plain']), true);
  assert.equal(dataTransferHasFileMention(['Files']), false);
  assert.equal(dataTransferHasFileMention([]), false);
});

test('mention handlers leave drags without the payload alone', () => {
  const { host, log } = makeHost();
  const handlers = makeComposerFileMentionDragHandlers(host);
  const { event, calls } = makeDragEvent({ types: ['Files'] });
  handlers.onDragEnter(event);
  handlers.onDragOver(event);
  handlers.onDrop(event);
  assert.deepEqual(calls, []);
  assert.deepEqual(log, []);
});

test('mention drop stops the native event too, not just the synthetic one', () => {
  // React's stopPropagation only halts synthetic dispatch; without the
  // native stop, the textarea's own DOM listeners still process the drop.
  const { host } = makeHost();
  const handlers = makeComposerFileMentionDragHandlers(host);
  const { event, calls } = makeDragEvent();
  handlers.onDrop(event);
  assert.ok(calls.includes('preventDefault'));
  assert.ok(calls.includes('stopPropagation'));
  assert.ok(calls.includes('nativeStopPropagation'));
});

test('mention dragover answers with the "move" effect the tree allows', () => {
  // Naming an effect outside the source's effectAllowed makes the browser
  // cancel the drop without ever firing it.
  const { host } = makeHost();
  const handlers = makeComposerFileMentionDragHandlers(host);
  const { event } = makeDragEvent();
  handlers.onDragOver(event);
  assert.equal(event.dataTransfer.dropEffect, 'move');
});

test('mention drop inserts with trailing space and clears the highlight', () => {
  const { host, log } = makeHost();
  const handlers = makeComposerFileMentionDragHandlers(host);
  handlers.onDragEnter(makeDragEvent().event);
  handlers.onDrop(makeDragEvent().event);
  assert.deepEqual(log, ['active:true', 'active:false', 'insert:`docs/index.md` ']);
});

test('mention drop reports a rejected insert instead of failing silently', () => {
  const { host, log } = makeHost(false);
  const handlers = makeComposerFileMentionDragHandlers(host);
  handlers.onDrop(makeDragEvent().event);
  assert.ok(log.includes('rejected'));
});

test('mention drop ignores a payload that is empty', () => {
  const { host, log } = makeHost();
  const handlers = makeComposerFileMentionDragHandlers(host);
  handlers.onDrop(makeDragEvent({ mention: '' }).event);
  assert.deepEqual(log, ['active:false']);
});

const makeTransfer = (plainText = '') => {
  const data = new Map<string, string>([['text/plain', plainText]]);
  return {
    setData: (format: string, value: string) => void data.set(format, value),
    getData: (format: string) => data.get(format) ?? '',
    data,
  };
};

const rowNode = (path: string) => ({
  getAttribute: (name: string) => (name === 'data-file-path' ? path : null),
});

test('tree controller tags a row drag with the mention payload and flags the drag', () => {
  const controller = createFileTreeDragController();
  const transfer = makeTransfer();
  controller.handleDragStart({
    dataTransfer: transfer,
    composedPath: () => [{}, rowNode('docs/index.md'), {}],
  });
  assert.equal(transfer.getData(FILE_MENTION_DRAG_TYPE), '`docs/index.md`');
  assert.equal(controller.isDragInProgress(), true);
  controller.handleDragEnd();
  assert.equal(controller.isDragInProgress(), false);
});

test('tree controller does not tag drags of selected text from the panel chrome', () => {
  // Only a drag that originates on a row is a mention; dragging a text
  // selection also carries text/plain, and tagging it would drop a broken
  // reference into the composer.
  const controller = createFileTreeDragController();
  const transfer = makeTransfer('selected text');
  controller.handleDragStart({ dataTransfer: transfer, composedPath: () => [{}] });
  assert.equal(transfer.data.has(FILE_MENTION_DRAG_TYPE), false);
  assert.equal(controller.isDragInProgress(), false);
});

test('tree controller ignores drags that carry no row path or no payload', () => {
  const controller = createFileTreeDragController();
  const transfer = makeTransfer();
  controller.handleDragStart({ dataTransfer: transfer, composedPath: () => [{}] });
  assert.equal(transfer.data.has(FILE_MENTION_DRAG_TYPE), false);
  controller.handleDragStart({ dataTransfer: null, composedPath: () => [rowNode('a.ts')] });
  assert.equal(controller.isDragInProgress(), false);
});

test('tree controller dragend without a drag is a no-op', () => {
  const controller = createFileTreeDragController();
  controller.handleDragEnd();
  assert.equal(controller.isDragInProgress(), false);
});
