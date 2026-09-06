import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import {
  NATIVE_APP_ICON_SCHEME,
  buildNativeAppIconUrl,
  parseNativeAppIconUrl,
} from '../src/shared/nativeAppIconUrl';

describe('nativeAppIconUrl', () => {
  it('builds and parses app-id URLs', () => {
    const app = { _tag: 'app-id' as const, appId: 'com.google.Chrome' };
    const url = buildNativeAppIconUrl(app);
    assert.equal(url, `${NATIVE_APP_ICON_SCHEME}://app-id/com.google.Chrome`);

    const parsed = parseNativeAppIconUrl(url);
    assert.deepEqual(parsed, app);
  });

  it('builds and parses display-name URLs with special characters', () => {
    const app = { _tag: 'display-name' as const, displayName: 'Google Chrome & Safari' };
    const url = buildNativeAppIconUrl(app);
    assert.equal(url, `${NATIVE_APP_ICON_SCHEME}://display-name/Google%20Chrome%20%26%20Safari`);

    const parsed = parseNativeAppIconUrl(url);
    assert.deepEqual(parsed, app);
  });

  it('rejects invalid schemes or paths', () => {
    assert.equal(parseNativeAppIconUrl('https://example.com'), null);
    assert.equal(parseNativeAppIconUrl(`${NATIVE_APP_ICON_SCHEME}://invalid-host/foo`), null);
    assert.equal(parseNativeAppIconUrl(`${NATIVE_APP_ICON_SCHEME}://app-id/`), null);
  });
});
