import assert from 'node:assert/strict';
import test from 'node:test';

import { getToastDuration, hasToastAction } from '../src/renderer/lib/toastConfig.js';

test('getToastDuration keeps errors visible longer than other tones', () => {
  assert.equal(getToastDuration('success'), 2500);
  assert.equal(getToastDuration('info'), 2500);
  assert.equal(getToastDuration('error'), 4500);
});

test('hasToastAction only returns true when both label and handler exist', () => {
  assert.equal(hasToastAction({ actionLabel: 'Retry', onAction: () => undefined }), true);
  assert.equal(hasToastAction({ actionLabel: 'Retry' }), false);
  assert.equal(hasToastAction({ actionLabel: '   ', onAction: () => undefined }), false);
});

/**
 * A guard for the copy rules in `toastConfig.ts`.
 *
 * The rules were written down because the app had drifted into two voices —
 * "Theme imported" beside "Model catalog refreshed." — and the same event
 * disagreed with itself across two files. Prose in a doc comment does not stop
 * that coming back; reading the call sites does.
 */
test('toast titles are labels: sentence case, no trailing period', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry) ? [full] : [];
    });

  // Matches `title: '...'` / `title: "..."` / `title: \`...\`` on one line,
  // and the same for the first argument of notifyError.
  const titlePattern = /title:\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  const notifyErrorPattern = /notifyError\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

  const offenders: string[] = [];

  for (const file of walk('src/renderer')) {
    const source = readFileSync(file, 'utf8');
    // Only files that actually raise toasts; `title:` is a common prop name.
    if (!source.includes('notify')) continue;

    for (const pattern of [titlePattern, notifyErrorPattern]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const title = match[2] ?? '';
        // Ellipses are progress, not sentences, and are allowed.
        if (title.endsWith('.') && !title.endsWith('…') && !title.endsWith('...')) {
          offenders.push(`${file}: ${title}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, []);
});
