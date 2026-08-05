import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NODE_CHARS_PER_LINE,
  NODE_LINE_HEIGHT,
  NODE_MIN_HEIGHT,
  NODE_PADDING_Y,
  estimateLabelLines,
  estimateNodeHeight,
} from '../src/shared/diagramLayout';

test('diagram node sizing', async (t) => {
  await t.test('a label that fits the measure is one line', () => {
    assert.equal(estimateLabelLines('P1: Search relevance tuning'.slice(0, 20)), 1);
    assert.equal(estimateLabelLines('Green build'), 1);
  });

  await t.test('wraps at word boundaries, never mid-word', () => {
    /*
      The regression this file exists for. Three words that each nearly fill
      the measure waste most of a line apiece, so dividing the length by the
      measure calls this two lines (35 / 22 = 2) while the browser breaks it
      at spaces into three. The old estimate handed dagre the short number
      and the node rendered ~18px taller than the lane reserved for it.
    */
    const label = 'Deployment configuration validation';
    assert.equal(Math.ceil(label.length / NODE_CHARS_PER_LINE), 2);
    assert.equal(estimateLabelLines(label), 3);
  });

  await t.test('never under-counts a naive character division', () => {
    const labels = [
      'P0: Commit 180+ files & merge feature/test-ui',
      'Parallel: 20 founding sellers + buyer marketing',
      'P2: Boost + Click.uz (apply for merchant NOW)',
      'P1: Moderation admin UI',
      'P2: Featured auction (or defer)',
    ];

    for (const label of labels) {
      assert.ok(
        estimateLabelLines(label) >= Math.ceil(label.length / NODE_CHARS_PER_LINE),
        `${label} was counted short`
      );
    }
  });

  await t.test('a word wider than the node breaks inside itself', () => {
    const word = 'x'.repeat(NODE_CHARS_PER_LINE * 3);
    assert.equal(estimateLabelLines(word), 3);
    assert.equal(estimateLabelLines(`lead ${word}`), 4);
  });

  await t.test('explicit newlines start a new line', () => {
    assert.equal(estimateLabelLines('one\ntwo\nthree'), 3);
    assert.equal(estimateLabelLines(''), 1);
  });

  await t.test('height follows the line count and floors at the minimum', () => {
    // One line is 18px + 24px of padding, so the 56px minimum is what wins.
    assert.equal(estimateNodeHeight('short'), NODE_MIN_HEIGHT);
    assert.equal(
      estimateNodeHeight('P0: Deploy to Hetzner staging→prod'),
      2 * NODE_LINE_HEIGHT + NODE_PADDING_Y * 2
    );
    assert.equal(
      estimateNodeHeight('Deployment configuration validation'),
      3 * NODE_LINE_HEIGHT + NODE_PADDING_Y * 2
    );
  });
});
