import assert from 'node:assert/strict';
import test from 'node:test';

import { applyStreamEventToParts } from '../src/shared/messageParts.js';
import { VisualStreamParser } from '../src/shared/visualParser.js';

test('VisualStreamParser preserves partial <visual starts at chunk boundaries and emits complete events', () => {
  const parser = new VisualStreamParser();

  assert.deepEqual(parser.feed('Before <vis', 'request-1'), [
    { type: 'text', content: 'Before ' },
  ]);

  const parsed = parser.feed(
    'ual title="Architecture"><svg xmlns="http://www.w3.org/2000/svg"><text>1 < 2 &amp; 3 > 1</text></svg></visual> After',
    'request-1'
  );

  assert.deepEqual(parsed, [
    {
      type: 'visual_start',
      content: '',
      title: 'Architecture',
      visualId: 'visual-request-1-0',
    },
    {
      type: 'visual_complete',
      content: '<svg xmlns="http://www.w3.org/2000/svg"><text>1 < 2 &amp; 3 > 1</text></svg>',
      title: 'Architecture',
      visualId: 'visual-request-1-0',
    },
    {
      type: 'text',
      content: ' After',
    },
  ]);
});

test('raw <div style= fallback tolerates > inside quoted attributes', () => {
  const parser = new VisualStreamParser();
  const divOnly = '<div style="font-size: 1>2px"></div>';
  const html = `${divOnly}<p>ok</p>`;

  assert.deepEqual(parser.feed(`Intro\n${html}`, 'request-div'), [
    { type: 'text', content: 'Intro\n' },
    { type: 'visual_start', content: '', visualId: 'visual-request-div-0' },
    {
      type: 'visual_complete',
      content: divOnly,
      visualId: 'visual-request-div-0',
    },
    { type: 'text', content: '<p>ok</p>' },
  ]);
});

test('VisualStreamParser captures raw SVG fallback blocks outside <visual> tags', () => {
  const parser = new VisualStreamParser();

  assert.deepEqual(parser.feed('Overview first.\n<svg viewBox="0 0 10 10"><text>hi', 'request-2'), [
    { type: 'text', content: 'Overview first.\n' },
    { type: 'visual_start', content: '', visualId: 'visual-request-2-0' },
  ]);

  assert.deepEqual(parser.feed('</text></svg>', 'request-2'), [
    {
      type: 'visual_complete',
      content: '<svg viewBox="0 0 10 10"><text>hi</text></svg>',
      visualId: 'visual-request-2-0',
    },
  ]);
});

test('VisualStreamParser splits </visual> safely across chunk boundaries', () => {
  const parser = new VisualStreamParser();

  assert.deepEqual(parser.feed('<visual><svg xmlns="http://www.w3.org/2000/svg"></svg></vis', 'r1'), [
    {
      type: 'visual_start',
      content: '',
      title: undefined,
      visualId: 'visual-r1-0',
    },
  ]);

  assert.deepEqual(parser.feed('ual> tail', 'r1'), [
    {
      type: 'visual_complete',
      content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      title: undefined,
      visualId: 'visual-r1-0',
    },
    { type: 'text', content: ' tail' },
  ]);
});

test('VisualStreamParser flushes incomplete visuals as completed visual payloads instead of raw text', () => {
  const parser = new VisualStreamParser();

  assert.deepEqual(parser.feed('Lead text <visual title="Fallback"><div style="padding:8px">Hello', 'request-3'), [
    { type: 'text', content: 'Lead text ' },
    {
      type: 'visual_start',
      content: '',
      title: 'Fallback',
      visualId: 'visual-request-3-0',
    },
  ]);

  assert.deepEqual(parser.flush('request-3'), [
    {
      type: 'visual_complete',
      content: '<div style="padding:8px">Hello',
      title: 'Fallback',
      visualId: 'visual-request-3-0',
    },
  ]);
});

test('a disabled parser passes the stream through untouched', () => {
  const parser = new VisualStreamParser({ enabled: false });

  assert.deepEqual(parser.feed('Here is the markup: <svg viewBox="0 0 4 4">', 'request-off'), [
    { type: 'text', content: 'Here is the markup: <svg viewBox="0 0 4 4">' },
  ]);
  assert.deepEqual(parser.feed('<circle r="1"/></svg> done', 'request-off'), [
    { type: 'text', content: '<circle r="1"/></svg> done' },
  ]);
  assert.deepEqual(parser.flush('request-off'), []);
});

test('markup inside a code fence stays a code sample', () => {
  const parser = new VisualStreamParser();
  const reply = 'Try this:\n\n```html\n<div style="color:red">hi</div>\n```\n\nThat is all.';

  const parsed = parser.feed(reply, 'request-fence');
  assert.deepEqual([...parsed, ...parser.flush('request-fence')], [
    { type: 'text', content: 'Try this:\n\n' },
    { type: 'text', content: '```' },
    { type: 'text', content: 'html\n<div style="color:red">hi</div>\n```' },
    { type: 'text', content: '\n\nThat is all.' },
  ]);
});

test('a fence wrapped around a visual is removed on both sides', () => {
  const parser = new VisualStreamParser();
  const reply = 'Here:\n\n```html\n<visual title="Flow"><svg xmlns="http://www.w3.org/2000/svg"></svg></visual>\n```\n\nDone.';

  const parsed = [...parser.feed(reply, 'request-wrap'), ...parser.flush('request-wrap')];

  assert.deepEqual(parsed, [
    { type: 'text', content: 'Here:\n\n' },
    { type: 'visual_start', content: '', title: 'Flow', visualId: 'visual-request-wrap-0' },
    {
      type: 'visual_complete',
      content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      title: 'Flow',
      visualId: 'visual-request-wrap-0',
    },
    { type: 'text', content: '\nDone.' },
  ]);
});

test('a fence split across chunks still resolves to a visual', () => {
  const parser = new VisualStreamParser();

  assert.deepEqual(parser.feed('Here:\n```html\n', 'request-split'), [
    { type: 'text', content: 'Here:\n' },
  ]);

  assert.deepEqual(parser.feed('<visual><svg></svg></visual>', 'request-split'), [
    { type: 'visual_start', content: '', title: undefined, visualId: 'visual-request-split-0' },
    {
      type: 'visual_complete',
      content: '<svg></svg>',
      title: undefined,
      visualId: 'visual-request-split-0',
    },
  ]);
});

test('the raw fallback can be turned off without disabling <visual> blocks', () => {
  const parser = new VisualStreamParser({ allowRawFallback: false });

  assert.deepEqual(parser.feed('<svg viewBox="0 0 4 4"></svg>', 'request-raw'), [
    { type: 'text', content: '<svg viewBox="0 0 4 4"></svg>' },
  ]);

  assert.deepEqual(parser.feed('<visual><b>ok</b></visual>', 'request-raw'), [
    { type: 'visual_start', content: '', title: undefined, visualId: 'visual-request-raw-0' },
    {
      type: 'visual_complete',
      content: '<b>ok</b>',
      title: undefined,
      visualId: 'visual-request-raw-0',
    },
  ]);
});

test('visual-complete creates a finished visual part even if visual-start was missed', () => {
  const parts = applyStreamEventToParts([], {
    type: 'visual-complete',
    requestId: 'request-4',
    visualId: 'visual-request-4-0',
    title: 'Recovered visual',
    content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  });

  assert.deepEqual(parts, [
    {
      id: 'visual-request-4-0',
      type: 'visual',
      title: 'Recovered visual',
      state: 'done',
      content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    },
  ]);
});
