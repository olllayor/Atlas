import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_DEFAULT_MODEL,
  getAntigravitySendBlockReason,
  type ServerProvider
} from '../src/renderer/components/chat/ChatView.logic.js';

const catalogModels = [
  { id: 'gemini-pro', name: 'Gemini Pro' },
  { id: ANTIGRAVITY_DEFAULT_MODEL, name: 'Gemini 3.8 Flash (High)' }
];

function entry(
  driver: string,
  instanceId: string,
  overrides: Partial<ServerProvider> = {}
): ServerProvider {
  return {
    driver,
    instanceId,
    installed: true,
    status: 'ready',
    auth: { status: 'authenticated' },
    models: catalogModels,
    message: null,
    ...overrides
  };
}

test('lets Antigravity check saved credentials when resuming after a restart', () => {
  const provider = entry('antigravity', 'google_work', {
    status: 'warning',
    auth: { status: 'unknown' },
    models: []
  });

  assert.equal(getAntigravitySendBlockReason(provider, 'gemini-pro'), null);
  assert.equal(getAntigravitySendBlockReason(provider, ANTIGRAVITY_DEFAULT_MODEL), null);
  assert.equal(
    getAntigravitySendBlockReason({ ...provider, models: catalogModels }, 'gemini-pro'),
    null
  );
  assert.equal(
    getAntigravitySendBlockReason(provider, ''),
    'Choose an Antigravity model before sending.'
  );
  assert.equal(
    getAntigravitySendBlockReason(provider, '   '),
    'Choose an Antigravity model before sending.'
  );
});

test('blocks sends when Antigravity is not installed', () => {
  const provider = entry('antigravity', 'google_work', {
    installed: false,
    auth: { status: 'unknown' },
    models: []
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-pro'),
    'Install Antigravity in provider settings before sending.'
  );
});

test('blocks sends when Antigravity confirms unauthenticated status', () => {
  const provider = entry('antigravity', 'google_work', {
    status: 'warning',
    auth: { status: 'unauthenticated' },
    models: []
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-pro'),
    'Sign in to Antigravity in provider settings before sending.'
  );
});

test('blocks sends when Antigravity model catalog is empty after authentication', () => {
  const provider = entry('antigravity', 'google_work', {
    status: 'ready',
    auth: { status: 'authenticated' },
    models: []
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-pro'),
    'Refresh Antigravity models in provider settings before sending.'
  );
});

test('blocks sends when chosen model is not in Antigravity catalog unless in error state', () => {
  const provider = entry('antigravity', 'google_work', {
    status: 'ready',
    auth: { status: 'authenticated' },
    models: [{ id: 'gemini-3.8-flash-high' }]
  });

  assert.equal(
    getAntigravitySendBlockReason(provider, 'gemini-3.8-flash-high'),
    null
  );
  assert.equal(
    getAntigravitySendBlockReason(provider, 'unknown-gemini-model'),
    'Model "unknown-gemini-model" is not available. Choose another model before sending.'
  );

  // In error state, keep it non-blocking because a refresh or turn startup might resolve it
  const providerInError = { ...provider, status: 'error' };
  assert.equal(getAntigravitySendBlockReason(providerInError, 'unknown-gemini-model'), null);
});
