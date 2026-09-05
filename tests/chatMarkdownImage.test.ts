import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { Streamdown, defaultRehypePlugins } from 'streamdown';

import {
  authoredImageSizeStyle,
  meaningfulHastChildren,
  soleImageDescendant,
  rehypeMarkStandaloneImages,
  ChatMarkdownImage,
  type HastNode
} from '../src/renderer/components/ai-elements/chat-markdown-image';

test('meaningfulHastChildren filters out empty and whitespace-only text nodes', () => {
  const node: HastNode = {
    children: [
      { type: 'text', value: '   \n  \t' },
      { type: 'element', tagName: 'img' },
      { type: 'text', value: '' },
      { type: 'element', tagName: 'span' }
    ]
  };
  const filtered = meaningfulHastChildren(node);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0]?.tagName, 'img');
  assert.equal(filtered[1]?.tagName, 'span');
});

test('soleImageDescendant detects sole images and looks through inline wrappers', () => {
  // Bare image
  const bare: HastNode = {
    children: [{ type: 'element', tagName: 'img' }]
  };
  assert.equal(soleImageDescendant(bare)?.tagName, 'img');

  // Wrapped in link
  const linked: HastNode = {
    children: [
      {
        type: 'element',
        tagName: 'a',
        children: [{ type: 'element', tagName: 'img' }]
      }
    ]
  };
  assert.equal(soleImageDescendant(linked)?.tagName, 'img');

  // Wrapped in strong
  const strong: HastNode = {
    children: [
      {
        type: 'element',
        tagName: 'strong',
        children: [{ type: 'element', tagName: 'img' }]
      }
    ]
  };
  assert.equal(soleImageDescendant(strong)?.tagName, 'img');

  // Multiple children: image + text -> not sole
  const mixed: HastNode = {
    children: [
      { type: 'text', value: 'Figure 1: ' },
      { type: 'element', tagName: 'img' }
    ]
  };
  assert.equal(soleImageDescendant(mixed), undefined);

  // Multiple images -> not sole
  const badges: HastNode = {
    children: [
      { type: 'element', tagName: 'img' },
      { type: 'element', tagName: 'img' }
    ]
  };
  assert.equal(soleImageDescendant(badges), undefined);
});

test('authoredImageSizeStyle formats dimensions correctly', () => {
  assert.deepEqual(authoredImageSizeStyle(400, 300), { width: '400px', height: '300px' });
  assert.deepEqual(authoredImageSizeStyle('50%', 'auto'), { width: '50%', height: 'auto' });
  assert.deepEqual(authoredImageSizeStyle(undefined, 250), { height: '250px' });
  assert.deepEqual(authoredImageSizeStyle(undefined, undefined), undefined);
});

test('rehypeMarkStandaloneImages identifies standalone images vs inline badges (PR #9938)', () => {
  function renderMarkdown(markdown: string) {
    return ReactDOMServer.renderToStaticMarkup(
      React.createElement(Streamdown, {
        rehypePlugins: [...Object.values(defaultRehypePlugins), rehypeMarkStandaloneImages],
        components: { img: ChatMarkdownImage },
        children: markdown
      })
    );
  }

  // 1. Standalone screenshot in paragraph: reserves 16:9 slot
  const standaloneHtml = renderMarkdown('![shot](https://example.com/shot.png)');
  assert.ok(standaloneHtml.includes('aspect-video'), 'Standalone image must reserve 16:9 slot');
  assert.ok(standaloneHtml.includes('role="status"'), 'Loading standalone image must carry role="status"');
  assert.ok(standaloneHtml.includes('aria-label="Loading image"'), 'Must have aria-label for loading');
  assert.ok(standaloneHtml.includes('invisible absolute inset-0 size-full'), 'Image loads invisibly inside frame');

  // 2. Standalone image in link: reserves 16:9 slot
  const linkedHtml = renderMarkdown('[![shot](https://example.com/shot.png)](https://example.com)');
  assert.ok(linkedHtml.includes('aspect-video'), 'Image that is sole child of link must reserve 16:9 slot');

  // 3. Standalone image in list item: reserves 16:9 slot
  const listHtml = renderMarkdown('- ![shot](https://example.com/shot.png)');
  assert.ok(listHtml.includes('aspect-video'), 'Image alone in list item must reserve 16:9 slot');

  // 4. Multiple images in one line (badge row): inline, NO aspect-video
  const badgeHtml = renderMarkdown('![badge1](https://example.com/b1.png) ![badge2](https://example.com/b2.png)');
  assert.ok(!badgeHtml.includes('aspect-video'), 'Badge row images must stay inline without 16:9 slot');

  // 5. Image with text in same paragraph: inline, NO aspect-video
  const captionHtml = renderMarkdown('Figure: [![shot](https://example.com/shot.png)](https://example.com)');
  assert.ok(!captionHtml.includes('aspect-video'), 'Image beside text must stay inline without 16:9 slot');

  // 6. Image wrapped in emphasis beside text: inline, NO aspect-video
  const emphasisHtml = renderMarkdown('**![shot](https://example.com/shot.png)** caption');
  assert.ok(!emphasisHtml.includes('aspect-video'), 'Emphasized image with caption must stay inline without 16:9 slot');
});
