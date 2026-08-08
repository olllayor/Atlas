import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { fileRefBadge, parseFileRef } from '../src/shared/fileRef';

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
