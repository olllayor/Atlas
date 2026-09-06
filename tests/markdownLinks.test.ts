import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { Streamdown, defaultRehypePlugins } from 'streamdown';

import {
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isPublicFaviconHost,
  resolveMarkdownLinkIcon,
  faviconUrlForOrigin,
  parseExternalMarkdownUrl,
  leadingExternalLinkTextLength,
  normalizeHostname
} from '../src/shared/markdownLinks';

import {
  MarkdownAnchor,
  MarkdownLinkFavicon,
  brandLinkIcon,
  hasReactTextContent,
  hastHasText
} from '../src/renderer/components/ai-elements/chat-markdown-link';
import { ChatMarkdownImage, rehypeMarkStandaloneImages } from '../src/renderer/components/ai-elements/chat-markdown-image';
import { GitHubIcon } from '../src/renderer/components/icons/GitHubIcon';

test('resolveMarkdownLinkIcon detects GitHub hosts and rejects non-GitHub hosts (PR #10324 parity)', () => {
  // Direct domain
  assert.equal(resolveMarkdownLinkIcon('github.com'), 'github');
  // Case insensitivity
  assert.equal(resolveMarkdownLinkIcon('GitHub.com'), 'github');
  assert.equal(resolveMarkdownLinkIcon('GITHUB.COM'), 'github');
  // Subdomains
  assert.equal(resolveMarkdownLinkIcon('gist.github.com'), 'github');
  assert.equal(resolveMarkdownLinkIcon('api.github.com'), 'github');
  assert.equal(resolveMarkdownLinkIcon('raw.github.com'), 'github');
  assert.equal(resolveMarkdownLinkIcon('www.github.com'), 'github');
  // With port
  assert.equal(resolveMarkdownLinkIcon('github.com:443'), 'github');
  assert.equal(resolveMarkdownLinkIcon('gist.github.com:8443'), 'github');

  // Negative cases
  assert.equal(resolveMarkdownLinkIcon('github.community'), null);
  assert.equal(resolveMarkdownLinkIcon('notgithub.com'), null);
  assert.equal(resolveMarkdownLinkIcon('github.com.evil.com'), null);
  assert.equal(resolveMarkdownLinkIcon('example.com'), null);
  assert.equal(resolveMarkdownLinkIcon('gitlab.com'), null);
  assert.equal(resolveMarkdownLinkIcon('google.com'), null);
  assert.equal(resolveMarkdownLinkIcon(''), null);
  assert.equal(resolveMarkdownLinkIcon(null), null);
  assert.equal(resolveMarkdownLinkIcon(undefined), null);
});

test('brandLinkIcon maps github to GitHubIcon component', () => {
  assert.equal(brandLinkIcon('github.com'), GitHubIcon);
  assert.equal(brandLinkIcon('gist.github.com'), GitHubIcon);
  assert.equal(brandLinkIcon('example.com'), null);
});

test('isPublicFaviconHost correctly classifies public vs private/special hosts', () => {
  // Public hosts
  assert.equal(isPublicFaviconHost('github.com'), true);
  assert.equal(isPublicFaviconHost('example.com'), true);
  assert.equal(isPublicFaviconHost('google.com'), true);
  assert.equal(isPublicFaviconHost('example.com.'), true);
  assert.equal(isPublicFaviconHost('8.8.8.8'), true);

  // Private network / localhost hosts
  assert.equal(isPublicFaviconHost('localhost'), false);
  assert.equal(isPublicFaviconHost('sub.localhost'), false);
  assert.equal(isPublicFaviconHost('127.0.0.1'), false);
  assert.equal(isPublicFaviconHost('127.1.2.3'), false);
  assert.equal(isPublicFaviconHost('10.0.0.1'), false);
  assert.equal(isPublicFaviconHost('192.168.1.1'), false);
  assert.equal(isPublicFaviconHost('172.16.0.1'), false);
  assert.equal(isPublicFaviconHost('172.31.255.255'), false);
  assert.equal(isPublicFaviconHost('169.254.1.1'), false);
  assert.equal(isPublicFaviconHost('100.64.0.1'), false);
  assert.equal(isPublicFaviconHost('mydevice.local'), false);
  assert.equal(isPublicFaviconHost('router.home.arpa'), false);
  assert.equal(isPublicFaviconHost('node.ts.net'), false);
  assert.equal(isPublicFaviconHost('singlelabelhost'), false);

  // Special TLDs
  assert.equal(isPublicFaviconHost('test.invalid'), false);
  assert.equal(isPublicFaviconHost('my.test'), false);
  assert.equal(isPublicFaviconHost('site.onion'), false);
  assert.equal(isPublicFaviconHost('app.internal'), false);

  // Malformed
  assert.equal(isPublicFaviconHost('example.com..'), false);
});

test('faviconUrlForOrigin generates google favicon URL for public hosts only', () => {
  assert.equal(
    faviconUrlForOrigin('https://example.com/path'),
    'https://www.google.com/s2/favicons?domain=example.com&sz=32'
  );
  assert.equal(
    faviconUrlForOrigin('https://example.com:8080/path', 16),
    'https://www.google.com/s2/favicons?domain=example.com%3A8080&sz=16'
  );

  // Private / internal URLs return null
  assert.equal(faviconUrlForOrigin('http://localhost:3000/test'), null);
  assert.equal(faviconUrlForOrigin('http://127.0.0.1:8080'), null);
  assert.equal(faviconUrlForOrigin('http://192.168.1.5'), null);
  assert.equal(faviconUrlForOrigin('http://mydevice.local'), null);
  assert.equal(faviconUrlForOrigin('ftp://example.com'), null);
  assert.equal(faviconUrlForOrigin('not-a-url'), null);
  assert.equal(faviconUrlForOrigin(null), null);
});

test('parseExternalMarkdownUrl extracts valid http/https URLs and rejects others', () => {
  const gh = parseExternalMarkdownUrl('https://github.com/pingdotgg/t3code');
  assert.ok(gh);
  assert.equal(gh.host, 'github.com');
  assert.equal(gh.hostname, 'github.com');

  const customPort = parseExternalMarkdownUrl('http://example.com:8080/test');
  assert.ok(customPort);
  assert.equal(customPort.host, 'example.com:8080');
  assert.equal(customPort.hostname, 'example.com');

  assert.equal(parseExternalMarkdownUrl('file:///path/to/file'), null);
  assert.equal(parseExternalMarkdownUrl('javascript:alert(1)'), null);
  assert.equal(parseExternalMarkdownUrl('assistant-cite:turn-1#p1'), null);
  assert.equal(parseExternalMarkdownUrl('src/main/index.ts'), null);
  assert.equal(parseExternalMarkdownUrl(''), null);
  assert.equal(parseExternalMarkdownUrl(null), null);
});

test('leadingExternalLinkTextLength handles protocols and text', () => {
  assert.equal(leadingExternalLinkTextLength('https://github.com'), 8);
  assert.equal(leadingExternalLinkTextLength('http://example.com'), 7);
  assert.equal(leadingExternalLinkTextLength('PR #10324'), 1);
  assert.equal(leadingExternalLinkTextLength('Atlas'), 1);
  assert.equal(leadingExternalLinkTextLength(''), 0);
});

test('hastHasText and hasReactTextContent identify whether content carries text', () => {
  // hastHasText
  assert.equal(hastHasText({ type: 'text', value: 'hello' }), true);
  assert.equal(hastHasText({ type: 'text', value: '   ' }), false);
  assert.equal(hastHasText({ type: 'element', tagName: 'span', children: [{ type: 'text', value: 'link' }] }), true);
  assert.equal(hastHasText({ type: 'element', tagName: 'img' }), false);

  // hasReactTextContent
  assert.equal(hasReactTextContent('hello'), true);
  assert.equal(hasReactTextContent('   '), false);
  assert.equal(hasReactTextContent(React.createElement('span', null, 'hello')), true);
  assert.equal(hasReactTextContent(React.createElement('img', { src: 'pic.png' })), false);
  assert.equal(hasReactTextContent(React.createElement(ChatMarkdownImage, { src: 'pic.png' })), false);
});

test('Markdown link rendering: GitHub links render GitHub mark in currentColor without favicon img', () => {
  function renderMarkdown(markdown: string) {
    return ReactDOMServer.renderToStaticMarkup(
      React.createElement(Streamdown, {
        rehypePlugins: [...Object.values(defaultRehypePlugins), rehypeMarkStandaloneImages],
        components: { a: MarkdownAnchor, img: ChatMarkdownImage },
        children: markdown
      })
    );
  }

  // 1. GitHub link: renders monochrome SVG with viewBox "0 0 24 24" and fill="currentColor", NO img
  const ghHtml = renderMarkdown('[GitHub Repo](https://github.com/pingdotgg/t3code)');
  assert.ok(ghHtml.includes('viewBox="0 0 24 24"'), 'Must render GitHub SVG mark');
  assert.ok(ghHtml.includes('fill="currentColor"'), 'GitHub mark must draw with currentColor to follow theme');
  assert.ok(!ghHtml.includes('<img'), 'GitHub link must not render img or request favicon');
  assert.ok(ghHtml.includes('target="_blank"'), 'External link must have target="_blank"');
  assert.ok(ghHtml.includes('rel="noreferrer noopener"') || ghHtml.includes('rel="noopener noreferrer"'), 'External link must have rel noopener/noreferrer');
  assert.ok(ghHtml.includes('whitespace-nowrap'), 'Must keep icon glued to leading text');

  // 2. Gist link: also renders GitHub mark without img
  const gistHtml = renderMarkdown('[Gist Snippet](https://gist.github.com/user/12345)');
  assert.ok(gistHtml.includes('viewBox="0 0 24 24"'), 'Gist must render GitHub SVG mark');
  assert.ok(!gistHtml.includes('<img'), 'Gist must not request favicon');

  // 3. Non-GitHub public link: renders favicon img
  const googleHtml = renderMarkdown('[Google](https://google.com)');
  assert.ok(googleHtml.includes('<img'), 'Non-GitHub public host must render favicon img');
  assert.ok(googleHtml.includes('https://www.google.com/s2/favicons?domain=google.com&amp;sz=32'), 'Must point to google favicon endpoint');
  assert.ok(!googleHtml.includes('d="M12 0C5.37'), 'Non-GitHub host must not render GitHub mark');

  // 4. Localhost link: renders Globe icon without img
  const localHtml = renderMarkdown('[Localhost](http://localhost:3000)');
  assert.ok(!localHtml.includes('<img'), 'Private host must not fetch favicon');
  assert.ok(!localHtml.includes('d="M12 0C5.37'), 'Private host must not render GitHub mark');
  // Globe icon from lucide-react renders svg with circle / path
  assert.ok(localHtml.includes('<svg'), 'Private host must render fallback Globe icon');

  // 5. Image badge sole child: does not prepend stray icon
  const badgeHtml = renderMarkdown('[![Badge](https://img.shields.io/badge.svg)](https://github.com/pingdotgg/t3code)');
  assert.ok(!badgeHtml.includes('whitespace-nowrap'), 'Badge-only link must not prepend icon');
  assert.ok(badgeHtml.includes('href="https://github.com/pingdotgg/t3code"'), 'Badge link must preserve href');

  // 6. File reference link: stays FileRefChip, no external icon
  const fileHtml = renderMarkdown('[index.ts](src/main/index.ts:25)');
  assert.ok(!fileHtml.includes('viewBox="0 0 24 24"'), 'File ref must not render GitHub icon');
  assert.ok(!fileHtml.includes('<img'), 'File ref must not render favicon img');
});
