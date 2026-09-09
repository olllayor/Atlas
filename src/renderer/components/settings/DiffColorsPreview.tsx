/**
 * Live diff-palette preview for Settings → Appearance (port of t3code
 * PR #10671's `DiffColorsPreview`, adapted).
 *
 * Renders a two-line sample patch through the transcript's own `DiffBlock`,
 * so the preview follows every `--diff-*` token by construction — including
 * the blue-orange override and any theme's count colors. Upstream prerenders
 * static HTML in a shadow root to avoid starting a syntax-highlighter worker
 * pool from settings; Atlas's `DiffBlock` is plain React with no workers, so
 * the live component is cheap enough to mount directly.
 *
 * Non-interactive by design: the copy/comment affordances inside would
 * otherwise steal focus in a form that previews color, not behavior.
 */

import { useMemo } from 'react';

import { parseUnifiedDiff } from '../../../shared/toolCellGrammar';
import { DiffBlock } from '../transcript/DiffBlock';

const PREVIEW_PATCH = [
  '--- a/greeting.ts',
  '+++ b/greeting.ts',
  '@@ -1,3 +1,3 @@',
  ' function greet(name) {',
  '-  return "Hi, " + name;',
  '+  return "Hello, " + name;',
  ' }',
].join('\n');

export function DiffColorsPreview() {
  const file = useMemo(() => parseUnifiedDiff(PREVIEW_PATCH)?.[0] ?? null, []);

  return (
    <div
      role="img"
      aria-label="Diff color preview"
      inert
      className="pointer-events-none max-h-28 overflow-hidden rounded-md border border-[var(--border-subtle)]"
    >
      {file ? <DiffBlock file={file} /> : null}
    </div>
  );
}
