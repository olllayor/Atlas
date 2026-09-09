/**
 * KaTeX equation rendering (port of t3code PR #10698
 * `apps/web/src/mathRendering.ts`).
 *
 * Only generated KaTeX markup reaches `dangerouslySetInnerHTML` — authored
 * HTML never enters this path. Malformed or unsupported expressions return
 * `null` so callers fall back to readable, copyable TeX source.
 */

import katex from 'katex';

import { markdownMath } from '../shared/markdownMath.js';

const CACHE_LIMIT = 128;
const CACHE_BYTES = 2 * 1024 * 1024;

const cache = new Map<string, string | null>();
let cacheBytes = 0;

function remember(source: string, html: string | null) {
  const size = (source.length + (html?.length ?? 0)) * 2;
  cache.delete(source);
  while ((cache.size >= CACHE_LIMIT || cacheBytes + size > CACHE_BYTES) && cache.size > 0) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const key = oldest.value;
    cacheBytes -= ((key.length + (cache.get(key)?.length ?? 0)) * 2);
    cache.delete(key);
  }
  cache.set(source, html);
  cacheBytes += size;
}

export function renderMathHtml(source: string): string | null {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  const math = markdownMath(source);
  if (!math) return null;
  let html: string | null = null;
  try {
    html = katex.renderToString(math.tex, {
      displayMode: math.display,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: 'error',
      trust: false,
      maxExpand: 1000,
      maxSize: 20,
    });
  } catch {
    // Malformed and unsupported expressions remain readable and copyable TeX.
  }
  remember(source, html);
  return html;
}
