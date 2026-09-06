import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import { explicitFaviconUrl, faviconUrlForPage, toolActivityFaviconUrl } from '../src/shared/favicon';

describe('faviconUrlForPage', () => {
  it('uses the page origin instead of a third-party favicon service', () => {
    assert.equal(
      faviconUrlForPage('https://example.com/docs/page?q=1'),
      'https://example.com/favicon.ico'
    );
    assert.equal(
      faviconUrlForPage('http://localhost:5173/app'),
      'http://localhost:5173/favicon.ico'
    );
  });

  it('selects site-owned light and dark variants without filtering full-color icons', () => {
    assert.equal(
      toolActivityFaviconUrl({ pageUrl: 'https://github.com/openai/codex' }, 'light'),
      'https://github.githubassets.com/favicons/favicon.svg'
    );
    assert.equal(
      toolActivityFaviconUrl({ pageUrl: 'https://github.com/openai/codex' }, 'dark'),
      'https://github.githubassets.com/favicons/favicon-dark.svg'
    );

    const fullColorIcon = {
      pageUrl: 'https://example.com/docs',
      faviconUrl: 'https://cdn.example.com/full-color.png',
    };
    assert.equal(toolActivityFaviconUrl(fullColorIcon, 'light'), fullColorIcon.faviconUrl);
    assert.equal(toolActivityFaviconUrl(fullColorIcon, 'dark'), fullColorIcon.faviconUrl);
  });

  it('prefers a provider-supplied dark favicon', () => {
    assert.equal(
      toolActivityFaviconUrl(
        {
          pageUrl: 'https://example.com/docs',
          faviconUrl: 'https://example.com/light.svg',
          faviconUrlDark: 'https://example.com/dark.svg',
        },
        'dark'
      ),
      'https://example.com/dark.svg'
    );
  });

  it('accepts provider-supplied image URLs but rejects extension URLs', () => {
    assert.equal(explicitFaviconUrl('https://example.com/icon.png'), 'https://example.com/icon.png');
    assert.equal(explicitFaviconUrl('chrome-extension://example/_favicon/'), null);
  });
});
