import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { remarkRewriteFileRefLinks } from '../src/shared/fileRefLinks';

type TestNode = {
  type: string;
  url?: string;
  value?: string;
  children?: TestNode[];
};

function paragraph(...children: TestNode[]): TestNode {
  return { type: 'paragraph', children };
}

function link(url: string, text: string): TestNode {
  return { type: 'link', url, children: [{ type: 'text', value: text }] };
}

describe('remarkRewriteFileRefLinks', () => {
  test('rewrites file hrefs to hash fragments so the sanitizer keeps them', () => {
    const tree: TestNode = {
      type: 'root',
      children: [
        paragraph(
          link('src/components/ClipboardCard.tsx', 'ClipboardCard.tsx'),
          link('src/main/index.ts:42', 'index'),
        ),
      ],
    };

    remarkRewriteFileRefLinks()(tree);

    const links = tree.children![0]!.children!;
    assert.ok(links[0]!.url!.startsWith('#atlas-file:src%2Fcomponents%2FClipboardCard.tsx'));
    assert.ok(links[1]!.url!.endsWith('index.ts:42'));
    // Link text is untouched: the chip shows the model's own words.
    assert.equal(links[0]!.children![0]!.value, 'ClipboardCard.tsx');
  });

  test('rewrites reference definitions too, leaves everything else alone', () => {
    const tree: TestNode = {
      type: 'root',
      children: [
        { type: 'definition', url: 'src/main/index.ts' } as TestNode,
        paragraph(
          link('https://github.com/x/y', 'docs'),
          link('atlas://cite/abc', 'quote'),
          link('#section', 'jump'),
          link('file:///Users/me/app/src/main/index.ts', 'abs'),
        ),
      ],
    };

    remarkRewriteFileRefLinks()(tree);

    assert.ok((tree.children![0] as TestNode).url!.startsWith('#atlas-file:'));
    const links = tree.children![1]!.children!;
    assert.equal(links[0]!.url, 'https://github.com/x/y');
    assert.equal(links[1]!.url, 'atlas://cite/abc');
    assert.equal(links[2]!.url, '#section');
    assert.ok(links[3]!.url!.startsWith('#atlas-file:'));
  });

  test('ignores non-link nodes and malformed urls without throwing', () => {
    const tree: TestNode = {
      type: 'root',
      children: [
        { type: 'image', url: 'src/shot.png' } as TestNode,
        { type: 'link', url: 42 } as unknown as TestNode,
        paragraph({ type: 'text', value: 'plain' }),
      ],
    };

    assert.doesNotThrow(() => remarkRewriteFileRefLinks()(tree));
    assert.equal((tree.children![0] as TestNode).url, 'src/shot.png');
  });
});
