import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import {
  extractToolActivityPresentation,
  summarizeToolGroup,
} from '../src/shared/toolPresentation';

describe('extractToolActivityPresentation', () => {
  it('reads provider-neutral presentation fields', () => {
    assert.deepEqual(
      extractToolActivityPresentation({
        toolSurface: 'browser',
        toolIcon: {
          _tag: 'website',
          pageUrl: 'https://example.com/docs',
          faviconUrl: 'https://example.com/favicon.png',
          faviconUrlDark: 'https://example.com/favicon-dark.png',
        },
        toolSource: {
          key: 'integration:example',
          name: 'Example',
          kind: 'integration',
          icon: {
            _tag: 'themed-logo',
            logoUrl: 'https://example.com/logo-light.png',
            logoUrlDark: 'https://example.com/logo-dark.png',
          },
        },
      }),
      {
        toolSurface: 'browser',
        toolIcon: {
          _tag: 'website',
          pageUrl: 'https://example.com/docs',
          faviconUrl: 'https://example.com/favicon.png',
          faviconUrlDark: 'https://example.com/favicon-dark.png',
        },
        toolSource: {
          key: 'integration:example',
          name: 'Example',
          kind: 'integration',
          icon: {
            _tag: 'themed-logo',
            logoUrl: 'https://example.com/logo-light.png',
            logoUrlDark: 'https://example.com/logo-dark.png',
          },
        },
      }
    );
  });

  it('reads provider-neutral native app icons', () => {
    assert.deepEqual(
      extractToolActivityPresentation({
        toolSurface: 'computer',
        toolIcon: {
          _tag: 'native-app',
          app: { _tag: 'app-id', appId: 'com.example.Editor' },
        },
        toolSource: {
          key: 'native-app:com.example.editor',
          name: 'Editor',
          kind: 'computer',
        },
      }),
      {
        toolSurface: 'computer',
        toolIcon: {
          _tag: 'native-app',
          app: { _tag: 'app-id', appId: 'com.example.Editor' },
        },
        toolSource: {
          key: 'native-app:com.example.editor',
          name: 'Editor',
          kind: 'computer',
        },
      }
    );
  });

  it('does not infer presentation from provider-specific payload data', () => {
    assert.deepEqual(
      extractToolActivityPresentation({
        data: {
          item: {
            arguments: { code: 'await sky.click({ app: "Finder" })' },
            result: {
              _meta: {
                'codex/toolSurface': {
                  kind: 'computerUse',
                  app: { kind: 'displayName', displayName: 'Finder' },
                },
              },
            },
          },
        },
      }),
      {}
    );
  });
});

describe('summarizeToolGroup', () => {
  it('deduplicates named sources ahead of ordinary actions', () => {
    const source = { key: 'browser-use:chrome', name: 'Chrome', kind: 'integration' as const };
    assert.equal(
      summarizeToolGroup([
        { label: 'Open page', tone: 'tool', toolSource: source },
        { label: 'Inspect page', tone: 'tool', toolSource: source },
        {
          label: 'Ran command',
          tone: 'tool',
          itemType: 'command_execution',
          command: 'git status',
        },
      ]),
      'Used Chrome integration and ran 1 command'
    );
  });

  it('omits the integration suffix for special browser and computer sources', () => {
    assert.equal(
      summarizeToolGroup([
        {
          label: 'Inspect page',
          tone: 'tool',
          toolSource: { key: 'browser-use', name: 'Browser', kind: 'browser' },
        },
        {
          label: 'Click',
          tone: 'tool',
          toolSource: { key: 'computer-use', name: 'Computer Use', kind: 'computer' },
        },
      ]),
      'Used Browser and Computer Use'
    );
  });
});
