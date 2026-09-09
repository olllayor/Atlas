/**
 * Shared math grammar recognition (port of t3code PR #10698
 * `markdownMath.test.ts`, adapted to bare `node --test`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { markdownMathRanges, remarkMath } from '../src/shared/markdownMath.js';

const parser = unified().use(remarkParse).use(remarkMath);

describe('markdownMathRanges', () => {
  const recognized: Array<[source: string, tex: string, display: boolean]> = [
    ['$x_i^2$', 'x_i^2', false],
    ['$$x_i^2$$', 'x_i^2', true],
    [String.raw`\(\frac{a}{b}\)`, String.raw`\frac{a}{b}`, false],
    [String.raw`\[\sum_i x_i\]`, String.raw`\sum_i x_i`, true],
    ['$$\nx_i + y\n$$', 'x_i + y', true],
    [
      '\\[\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n\\]',
      '\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}',
      true,
    ],
  ];

  for (const [source, tex, display] of recognized) {
    it(`recognizes ${source}`, () => {
      assert.deepEqual(markdownMathRanges(source), [
        { source, math: { source, tex, display }, start: 0, end: source.length },
      ]);
    });
  }

  const literal = [
    'Costs $20 today and $30 tomorrow.',
    '$20.00, $30.00, and $40.00',
    '`$x$` and `\\(x\\)`',
    '```tex\n$$x$$\n```',
    '    \\[x\\]',
    String.raw`\$x\$ and \\(x\\)`,
    '[link](https://example.com/$x$)',
    '$$\nunfinished\n\nNext paragraph $5',
    '$ incomplete$ and $incomplete $',
    '$$$x$$$',
  ];

  for (const source of literal) {
    it(`leaves literal content unchanged: ${source}`, () => {
      assert.deepEqual(markdownMathRanges(source), []);
    });
  }

  it('keeps exact source offsets alongside emoji, lists and emphasis', () => {
    const source = '🙂 **Fit** $x_i$\n\n- [ ] Verify \\(y\\)';
    const ranges = markdownMathRanges(source);
    assert.deepEqual(
      ranges.map((range) => source.slice(range.start, range.end)),
      ['$x_i$', '\\(y\\)']
    );
    assert.deepEqual(
      ranges.map((range) => range.math?.tex),
      ['x_i', 'y']
    );
  });

  it('preserves incomplete backslash openers during streaming', () => {
    const paragraph = parser.parse(String.raw`Use \(x`).children[0];
    assert.equal(
      paragraph?.type === 'paragraph' &&
        paragraph.children.map((node) => ('value' in node ? node.value : '')).join(''),
      String.raw`Use \(x`
    );
  });

  it('does not interpret escaped dollar signs inside an expression as its end', () => {
    assert.equal(markdownMathRanges(String.raw`$x + \$5$`)[0]?.math?.tex, String.raw`x + \$5`);
  });

  it('does not let a candidate eat a code span (Atlas guard)', () => {
    // The tokenizer commits at the earlier `$` before the code-span
    // construct is tried; aborting re-scans so the code span parses normally
    // and later math still matches.
    const source = 'Pay $30 for `$x$` and $y$ today';
    const ranges = markdownMathRanges(source);
    assert.equal(ranges.length, 1, 'only the real equation matches');
    assert.equal(ranges[0]?.math?.tex, 'y');
    assert.equal(source.slice(ranges[0]?.start, ranges[0]?.end), '$y$');
  });

  it('ends unfinished backslash math at a paragraph boundary and preserves following Markdown', () => {
    const tree = parser.parse('\\(unfinished\n\n## Heading\n\n[link](https://example.com)');
    assert.equal(tree.children[1]?.type, 'heading');
    const tail = tree.children[2];
    assert.equal(tail?.type, 'paragraph');
    assert.ok(
      tail?.type === 'paragraph' &&
        tail.children.some((node) => node.type === 'link'),
      'the link after the boundary still parses as a link'
    );
  });
});
