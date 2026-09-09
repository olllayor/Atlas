/**
 * KaTeX equation rendering (port of t3code PR #10698 `mathRendering.test.ts`,
 * adapted to bare `node --test`; `renderToString` needs no DOM).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMathHtml } from '../src/renderer/mathRendering.js';

describe('renderMathHtml', () => {
  it('renders inline and display equations to KaTeX markup', () => {
    for (const source of [String.raw`$x_i^2+\alpha$`, String.raw`\[\frac{a}{b}\]`, '$$x^2$$']) {
      const html = renderMathHtml(source);
      assert.ok(html?.includes('katex'), `missing katex markup for ${source}`);
      assert.ok(!html?.includes('merror'), `error node for ${source}`);
    }
  });

  it('returns null for malformed expressions and non-math', () => {
    assert.equal(renderMathHtml(String.raw`$\frac{$`), null);
    assert.equal(renderMathHtml('plain prose'), null);
  });

  it('returns a stable result across calls', () => {
    const source = String.raw`\(x\)`;
    assert.equal(renderMathHtml(source), renderMathHtml(source));
  });
});
