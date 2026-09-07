import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { decodeFileRefHash, encodeFileRefHref, fileRefBadge, fileUrlToPath, parseFileRef, rewriteFileRefHref } from '../src/shared/fileRef';

describe('parseFileRef', () => {
  test('splits a project-relative path into directory and name', () => {
    const ref = parseFileRef('src/renderer/components/ChatWindow.tsx');

    assert.ok(ref);
    assert.equal(ref.path, 'src/renderer/components/ChatWindow.tsx');
    assert.equal(ref.directory, 'src/renderer/components/');
    assert.equal(ref.name, 'ChatWindow.tsx');
    assert.equal(ref.extension, 'tsx');
    assert.equal(ref.line, null);
  });

  test('reads the line suffix and drops the column', () => {
    assert.equal(parseFileRef('src/main/index.ts:42')?.line, 42);
    assert.equal(parseFileRef('src/main/index.ts:42:7')?.line, 42);
    assert.equal(parseFileRef('src/main/index.ts:42')?.path, 'src/main/index.ts');
  });

  test('accepts an absolute path and a bare filename', () => {
    assert.equal(parseFileRef('/Users/me/app/src/main/index.ts')?.name, 'index.ts');

    const bare = parseFileRef('package.json');
    assert.equal(bare?.directory, '');
    assert.equal(bare?.name, 'package.json');
  });

  test('rejects anything that is a URL rather than a path', () => {
    // A host with a plausible-looking extension is the case an extension-shape
    // test would get wrong, which is why the extension list is an allowlist.
    for (const href of [
      'https://example.com/docs.md',
      'example.com',
      'mailto:me@example.com',
      '//cdn.example.com/app.js',
      '#section',
      'src/main/index.ts?raw',
      'src/main/index.ts#L4',
      'notes for later.md and more',
    ]) {
      assert.equal(parseFileRef(href), null, href);
    }
  });

  test('rejects paths with no usable extension', () => {
    assert.equal(parseFileRef('src/renderer/components'), null);
    assert.equal(parseFileRef('src/renderer/'), null);
    assert.equal(parseFileRef('.gitignore'), null);
    assert.equal(parseFileRef('v1.2'), null);
  });
});

describe('fileRefBadge', () => {
  test('collapses a family onto one mark and caps at two characters', () => {
    assert.equal(fileRefBadge('tsx'), 'TS');
    assert.equal(fileRefBadge('ts'), 'TS');
    assert.equal(fileRefBadge('jsx'), 'JS');
    assert.equal(fileRefBadge('json'), '{}');
    assert.equal(fileRefBadge('md'), 'MD');
    assert.equal(fileRefBadge('python'), 'PY');
  });
});

describe('file-ref hash round-trip (sanitizer bypass)', () => {
  test('encodes a path and line into a hash-only href', () => {
    assert.equal(
      encodeFileRefHref({ path: 'src/renderer/components/ChatWindow.tsx', line: 42 }),
      '#atlas-file:src%2Frenderer%2Fcomponents%2FChatWindow.tsx:42'
    );
    assert.equal(
      encodeFileRefHref({ path: 'package.json', line: null }),
      '#atlas-file:package.json'
    );
  });

  test('decodes back to the same ref', () => {
    const ref = decodeFileRefHash('#atlas-file:src%2Frenderer%2Fcomponents%2FChatWindow.tsx:42');
    assert.ok(ref);
    assert.equal(ref.path, 'src/renderer/components/ChatWindow.tsx');
    assert.equal(ref.line, 42);
    assert.equal(ref.name, 'ChatWindow.tsx');
  });

  test('rejects non-hash hrefs and garbage', () => {
    assert.equal(decodeFileRefHash('src/main/index.ts'), null);
    assert.equal(decodeFileRefHash('#section'), null);
    assert.equal(decodeFileRefHash('#atlas-file:'), null);
    assert.equal(decodeFileRefHash('#atlas-file:%zz'), null);
    // Decodes, then re-validates: not a project file, no chip.
    assert.equal(decodeFileRefHash('#atlas-file:notes.com'), null);
  });

  test('unwraps file:// URLs the model sometimes emits', () => {
    assert.equal(fileUrlToPath('file:///Users/me/app/src/main/index.ts'), '/Users/me/app/src/main/index.ts');
    assert.equal(fileUrlToPath('file://localhost/Users/me/app/src/main.ts'), '/Users/me/app/src/main.ts');
    assert.equal(fileUrlToPath('https://example.com/a.ts'), null);
    assert.equal(fileUrlToPath('src/main/index.ts'), null);
  });

  test('rewriteFileRefHref keeps chips for file shapes, leaves the rest', () => {
    // Bare-relative and line-suffixed: the shapes rehype-harden blocks.
    assert.ok(rewriteFileRefHref('src/components/ClipboardCard.tsx')?.startsWith('#atlas-file:'));
    assert.ok(rewriteFileRefHref('src/main/index.ts:42')?.endsWith(':42'));
    assert.ok(rewriteFileRefHref('file:///Users/me/app/src/main/index.ts')?.startsWith('#atlas-file:'));
    // Citations, external links, anchors, queries: not files, untouched.
    for (const href of [
      'atlas://cite/abc',
      'https://github.com/x/y',
      '#section',
      'src/main/index.ts?raw',
      'example.com',
    ]) {
      assert.equal(rewriteFileRefHref(href), null, href);
    }
  });
});
