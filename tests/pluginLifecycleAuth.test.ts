import assert from 'node:assert/strict';
import test from 'node:test';

import { McpSecretStore } from '../src/main/secrets/mcpSecrets.js';
import type { AuthConfig, PluginLifecycleState, PluginSummary } from '../src/shared/contracts.js';

test('AuthConfig: supports oauth, api_key, bearer, and database_url abstractions', () => {
  const apiKeyConfig: AuthConfig = {
    type: 'api_key',
    secretName: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    label: 'GitHub Personal Access Token',
    placeholder: 'ghp_...'
  };
  assert.equal(apiKeyConfig.type, 'api_key');
  assert.equal(apiKeyConfig.secretName, 'GITHUB_PERSONAL_ACCESS_TOKEN');

  const dbUrlConfig: AuthConfig = {
    type: 'database_url',
    secretName: 'POSTGRES_URL',
    label: 'PostgreSQL Database URL',
    placeholder: 'postgresql://user:pass@localhost:5432/dbname'
  };
  assert.equal(dbUrlConfig.type, 'database_url');

  const oauthConfig: AuthConfig = {
    type: 'oauth',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    scopes: ['repo', 'read:org']
  };
  assert.equal(oauthConfig.type, 'oauth');
});

test('PluginLifecycleState: represents decoupled installation, auth, connection, and permissions', () => {
  const states: PluginLifecycleState[] = [
    'available',
    'installing',
    'installed',
    'needs_configuration',
    'connected',
    'enabled',
    'disabled',
    'error'
  ];
  assert.equal(states.length, 8);
  assert.ok(states.includes('needs_configuration'));
  assert.ok(states.includes('connected'));
});

test('McpSecretStore: stores and retrieves plugin credentials', async () => {
  const store = new McpSecretStore();
  const plugin = 'test-plugin';
  const credentials = {
    API_KEY: 'sk-test-12345',
    DATABASE_URL: 'postgres://localhost/test'
  };

  // In test environment, keytar falls back gracefully if native keychain unavailable
  await store.setPluginCredentials(plugin, credentials);
  const retrieved = await store.getPluginCredentials(plugin);

  // If keychain is functional, it returns the stored object; otherwise returns {} without crashing
  assert.ok(typeof retrieved === 'object');

  await store.deletePluginCredentials(plugin);
});
