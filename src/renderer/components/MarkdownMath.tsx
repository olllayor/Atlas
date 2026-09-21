/**
 * Rendered chat math (port of t3code PR #10698
 * `apps/web/src/components/MarkdownMath.tsx`).
 *
 * Display equations carry Copy TeX + TeX-source controls; inline math
 * renders bare. KaTeX (and its fonts) loads only when a message actually
 * contains math. Anything KaTeX rejects falls back to the mono source span,
 * never red error text — a half-streamed equation is unreadable enough
 * without being alarming.
 *
 * `data-markdown-copy` is the copy contract: selection handling copies the
 * original TeX, never flattened glyphs (see `mathSelection.ts`).
 */

import { lazy, memo, Suspense, useState } from 'react';

import { markdownMath } from '../../shared/markdownMath.js';
import { notify } from '../lib/notify';
import { RendererErrorBoundary } from './RendererErrorBoundary';

// The renderer and its fonts are loaded only when a message contains math.
const MathTypeset = lazy(() => import('./MathTypeset'));

export const MarkdownMath = memo(function MarkdownMath({ source }: { source: string }) {
  const math = markdownMath(source);
  const [showSource, setShowSource] = useState(false);
  if (!math) return <>{source}</>;
  const fallback = <span className="whitespace-pre-wrap font-mono text-xs">{source}</span>;
  return (
    <span
      className={math.display ? 'markdown-math markdown-math-display' : 'markdown-math'}
      data-markdown-math=""
      data-markdown-copy={source}
    >
      {math.display ? (
        <span className="markdown-math-actions select-none">
          <button
            type="button"
            onClick={() => {
              if (!navigator.clipboard) {
                notify({ tone: 'error', title: 'Could not copy TeX' });
                return;
              }
              void navigator.clipboard.writeText(source).then(
                () => notify({ tone: 'success', title: 'TeX copied' }),
                () => notify({ tone: 'error', title: 'Could not copy TeX' })
              );
            }}
          >
            Copy TeX
          </button>
          <button
            type="button"
            aria-expanded={showSource}
            onClick={() => setShowSource(!showSource)}
          >
            {showSource ? 'Hide source' : 'TeX source'}
          </button>
        </span>
      ) : null}
      <span
        className="markdown-math-viewport"
        tabIndex={math.display ? 0 : undefined}
        role={math.display ? 'region' : undefined}
        aria-label={math.display ? 'Equation' : undefined}
      >
        <RendererErrorBoundary fallback={fallback} resetKey={source}>
          <Suspense fallback={fallback}>
            <MathTypeset source={source} />
          </Suspense>
        </RendererErrorBoundary>
      </span>
      {showSource && math.display ? <span className="markdown-math-source">{source}</span> : null}
    </span>
  );
});
