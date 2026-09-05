import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { Streamdown, defaultRehypePlugins } from 'streamdown';

import {
  authoredImageSizeStyle,
  decodedSrcFromImage,
  meaningfulHastChildren,
  resolveImageStatus,
  soleImageDescendant,
  rehypeMarkStandaloneImages,
  ChatMarkdownImage,
  type ChatMarkdownImageProps,
  type HastNode
} from '../src/renderer/components/ai-elements/chat-markdown-image';

/** Render the image component directly so a source state can be forced. */
function renderImage(props: ChatMarkdownImageProps): string {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChatMarkdownImage, props)
  );
}

const STANDALONE = { 'data-standalone': 'true' } as const;

/** Class list of the outermost span, i.e. the reserved media slot. */
function slotClasses(html: string): string[] {
  return /<span[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
}

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

test('resolveImageStatus settles a standalone image only once its own URL decoded (PR #9938)', () => {
  const A = 'https://example.com/a.png';
  const B = 'https://example.com/b.png';

  // Initial mount: slot, nothing settled.
  assert.deepEqual(resolveImageStatus({ src: A, loadedSrc: null, failedSrc: null, standalone: true }), {
    effectiveSrc: A,
    failed: false,
    settled: false
  });

  // Same URL decoded: settled, renders bare.
  assert.equal(
    resolveImageStatus({ src: A, loadedSrc: A, failedSrc: null, standalone: true }).settled,
    true
  );

  // Different file before it decodes: back behind the slot, not bare.
  assert.equal(
    resolveImageStatus({ src: B, loadedSrc: A, failedSrc: null, standalone: true }).settled,
    false
  );

  // Null src during re-resolution: keeps the last decoded image up.
  assert.deepEqual(
    resolveImageStatus({ src: null, loadedSrc: A, failedSrc: null, standalone: true }),
    { effectiveSrc: A, failed: false, settled: true }
  );

  // Failure: slot shows the error, never the bare image.
  const failed = resolveImageStatus({ src: B, loadedSrc: null, failedSrc: B, standalone: true });
  assert.equal(failed.failed, true);
  assert.equal(failed.settled, false);

  // Retry with a fresh URL loads behind the slot again.
  const C = 'https://example.com/c.png';
  assert.deepEqual(
    resolveImageStatus({ src: C, loadedSrc: null, failedSrc: B, standalone: true }),
    { effectiveSrc: C, failed: false, settled: false }
  );

  // Inline images skip the slot: any non-failed src renders immediately.
  assert.equal(
    resolveImageStatus({ src: B, loadedSrc: null, failedSrc: null, standalone: false }).settled,
    true
  );
});

test('decodedSrcFromImage records the requested URL, not the browser-resolved one (PR #9938)', () => {
  const decoded = { complete: true, naturalWidth: 120 } as unknown as HTMLImageElement;

  // A relative src resolves to an absolute currentSrc. Settling on that would
  // never satisfy `loadedSrc === effectiveSrc`, and an image already complete
  // at mount never fires onLoad, so it would sit behind the slot forever.
  assert.equal(decodedSrcFromImage(decoded, './shots/relative.png'), './shots/relative.png');

  // Not decoded yet, no node, or nothing requested: record nothing.
  assert.equal(
    decodedSrcFromImage({ complete: false, naturalWidth: 0 } as unknown as HTMLImageElement, './a.png'),
    null
  );
  assert.equal(decodedSrcFromImage(null, './a.png'), null);
  assert.equal(decodedSrcFromImage(decoded, null), null);
});

test('a standalone image holds the identical slot while loading, loading bytes, and failing (PR #9938)', () => {
  const src = 'https://example.com/shot.png';
  const loading = renderImage({ src, alt: 'shot', ...STANDALONE });
  const failure = renderImage({ src, alt: 'shot', sourceFailed: true, ...STANDALONE });

  // The slot is a static 16:9 box: no pulse, so nothing animates the row.
  assert.ok(loading.includes('aspect-video'), 'Standalone slot must reserve 16:9');
  assert.ok(loading.includes('w-full'), 'Standalone slot must span the column');
  assert.ok(!loading.includes('animate-pulse'), 'Slot must not animate');
  assert.ok(loading.includes('role="status"'), 'Loading slot reports status');

  // A failure reuses the exact same frame, so a broken image moves nothing.
  // Guard the comparison against a vacuous pass on an unparsed regex.
  assert.ok(slotClasses(loading).length > 3, 'Expected to parse the slot class list');
  assert.deepEqual(slotClasses(failure), slotClasses(loading));
  assert.ok(failure.includes('role="alert"'), 'Failed slot reports an alert');
  assert.ok(failure.includes('Image unavailable'), 'Failed slot names the failure');

  // Bytes are requested inside the frame but never paint at an unknown size.
  assert.match(loading, /<img[^>]*class="invisible absolute inset-0/);
  assert.ok(loading.includes('decoding="async"'), 'Images decode async');
  assert.ok(!loading.includes('loading="lazy"'), 'Virtualized rows must not lazy-load');
});

test('an authored id lands on the slot so fragment links resolve before the image decodes (PR #9938)', () => {
  const html = renderImage({
    src: 'https://example.com/diagram.png',
    alt: 'diagram',
    id: 'diagram',
    ...STANDALONE
  });
  assert.ok(html.includes('<span id="diagram"'), html);
});

test('an image with no source fails instead of holding an open-ended loading slot (PR #9938)', () => {
  const standalone = renderImage({ alt: 'gone', ...STANDALONE });
  assert.ok(standalone.includes('role="alert"'), standalone);
  assert.ok(standalone.includes('Image unavailable'), standalone);
  assert.ok(standalone.includes('aspect-video'), 'Failure keeps the reserved slot');
  assert.ok(!standalone.includes('Loading image'), 'Must not claim to still be loading');

  const inline = renderImage({ alt: 'gone' });
  assert.ok(inline.includes('Image unavailable'), inline);
  assert.ok(!inline.includes('aspect-video'), 'Inline failures stay a chip');
});
