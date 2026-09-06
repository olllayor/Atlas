import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderStatusBannerKey,
  shouldShowProviderStatusBanner
} from '../src/renderer/components/chat/ProviderStatusBanner.js';
import type { ServerProvider } from '../src/renderer/components/chat/ChatView.logic.js';

function warningProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: 'google_work',
    driver: 'antigravity',
    installed: true,
    status: 'warning',
    auth: { status: 'unknown' },
    models: [],
    message: 'Antigravity is installed. Google account access is not checked yet.',
    ...overrides
  };
}

test('waits for an Antigravity auth result before showing a sign-in warning', () => {
  const status = warningProvider();

  assert.equal(shouldShowProviderStatusBanner(status, null), false);
  assert.equal(getProviderStatusBannerKey(status), null);
  assert.equal(
    shouldShowProviderStatusBanner(
      {
        ...status,
        auth: { status: 'unauthenticated' },
        message: 'Sign in with Google to use Antigravity.'
      },
      null
    ),
    true
  );
});

test('shows Antigravity installation and startup failures before auth is checked', () => {
  const status = warningProvider();

  assert.equal(shouldShowProviderStatusBanner({ ...status, installed: false }, null), true);
  assert.equal(shouldShowProviderStatusBanner({ ...status, status: 'error' }, null), true);
  assert.equal(
    shouldShowProviderStatusBanner({ ...status, driver: 'codex' }, null),
    true
  );
});

test('stays hidden after its current warning is dismissed', () => {
  const status = warningProvider({
    auth: { status: 'unauthenticated' },
    message: 'Sign in with Google to use Antigravity.'
  });

  const key = getProviderStatusBannerKey(status);
  assert.ok(key, 'generates a banner key');
  assert.equal(shouldShowProviderStatusBanner(status, null), true);
  assert.equal(shouldShowProviderStatusBanner(status, key), false);
  assert.equal(shouldShowProviderStatusBanner(status, 'different-key'), true);
});

test('hides banner when provider status is ready or disabled', () => {
  const ready = warningProvider({ status: 'ready' });
  const disabled = warningProvider({ status: 'disabled' });

  assert.equal(shouldShowProviderStatusBanner(ready, null), false);
  assert.equal(shouldShowProviderStatusBanner(disabled, null), false);
  assert.equal(getProviderStatusBannerKey(ready), null);
  assert.equal(getProviderStatusBannerKey(disabled), null);
});
