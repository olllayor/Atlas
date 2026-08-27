import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  OPENCODE_PROVIDER_ID,
  defaultOpenCodeSettings,
  isOpenCodeIntegrationMode,
  openCodeServerMode,
  parseOpenCodeSettings
} from '../src/shared/opencodeSettings.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import type { SqliteDatabase } from '../src/main/db/client.js';

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-opencode-settings-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql)
  } as unknown as SqliteDatabase;

  applySchema(database);
  return { tempDir, repo: new SettingsRepo(database) };
}

test('opencode settings schema defaults an empty blob', () => {
  const parsed = parseOpenCodeSettings({});
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.settings, {
    enabled: false,
    integrationMode: 'server',
    binaryPath: '',
    serverUrl: '',
    customModels: []
  });
  assert.equal(defaultOpenCodeSettings().enabled, false);
});

test('integration mode accepts only server|acp (D7 dual options)', () => {
  for (const mode of ['server', 'acp']) {
    const parsed = parseOpenCodeSettings({ integrationMode: mode });
    assert.ok(parsed.ok);
    assert.equal(parsed.settings.integrationMode, mode);
  }

  const rejected = parseOpenCodeSettings({ integrationMode: 'webhook' });
  assert.ok(!rejected.ok);
  assert.match(rejected.error, /integrationMode/);

  assert.ok(isOpenCodeIntegrationMode('acp'));
  assert.equal(isOpenCodeIntegrationMode('stdio'), false);
});

test('opencode provider id is the fixed "opencode" slug', () => {
  assert.equal(OPENCODE_PROVIDER_ID, 'opencode');
});

test('serverUrl accepts empty and http(s), rejects everything else', () => {
  for (const good of ['', 'http://127.0.0.1:4096', 'https://oc.internal.example.com']) {
    const parsed = parseOpenCodeSettings({ serverUrl: good });
    assert.ok(parsed.ok, `expected ${JSON.stringify(good)} to pass`);
    assert.equal(parsed.settings.serverUrl, good);
  }

  for (const bad of ['127.0.0.1:4096', 'ftp://x', 'not a url', 'http://ok then spaces']) {
    const parsed = parseOpenCodeSettings({ serverUrl: bad });
    assert.ok(!parsed.ok, `expected ${JSON.stringify(bad)} to fail`);
    assert.match(parsed.error, /http\(s\)|Server URL/);
  }
});

test('customModels must be provider/model slugs', () => {
  const ok = parseOpenCodeSettings({ customModels: ['openai/gpt-5.2', 'qwen/qwen3-coder+'] });
  assert.ok(ok.ok);

  const notSlug = parseOpenCodeSettings({ customModels: ['gpt5-no-slash'] });
  assert.ok(!notSlug.ok);
  assert.match(notSlug.error, /<provider>\/<model>/);

  const tooLong = parseOpenCodeSettings({ customModels: [`${'a'.repeat(120)}/${'b'.repeat(200)}`] });
  assert.ok(!tooLong.ok);
});

test('unknown keys are stripped, not round-tripped', () => {
  const parsed = parseOpenCodeSettings({
    enabled: true,
    mysteryField: { nested: true },
    serverPassword: 'must-not-persist-here'
  });

  assert.ok(parsed.ok);
  assert.deepEqual(Object.keys(parsed.settings).sort(), [
    'binaryPath',
    'customModels',
    'enabled',
    'integrationMode',
    'serverUrl'
  ]);
});

test('server mode derivation matches t3 semantics', () => {
  assert.equal(openCodeServerMode(parseOpenCodeSettings({}).ok ? { serverUrl: '' } : { serverUrl: '' }), 'spawned');
  assert.equal(openCodeServerMode({ serverUrl: 'http://127.0.0.1:4096' }), 'external');
});

test('settings repo persists and re-reads opencode settings as JSON', () => {
  const { tempDir, repo } = createDatabase();
  try {
    const first = repo.getOpenCodeSettings();
    assert.ok(first.ok);
    // Absent row parses to defaults via the null fallback.
    assert.deepEqual(first.settings, defaultOpenCodeSettings());

    repo.setOpenCodeSettings({
      enabled: true,
      binaryPath: '/usr/local/bin/opencode',
      serverUrl: '',
      customModels: ['openai/o4-mini']
    });

    const second = repo.getOpenCodeSettings();
    assert.ok(second.ok);
    assert.equal(second.settings.enabled, true);
    assert.equal(second.settings.binaryPath, '/usr/local/bin/opencode');
    assert.deepEqual(second.settings.customModels, ['openai/o4-mini']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('settings repo reports corrupt blobs as parse failures without throwing', () => {
  const { tempDir, repo } = createDatabase();
  try {
    // Bypass the typed setter to simulate legacy/corrupt storage.
    repo.setKeybindings([]);
    // Directly write garbage through the underlying JSON channel:
    (repo as unknown as { setJsonSetting(key: string, value: unknown): void }).setJsonSetting(
      'providers.opencode',
      { serverUrl: 'javascript:alert(1)' }
    );

    const parsed = repo.getOpenCodeSettings();
    assert.ok(!parsed.ok);
    assert.match(parsed.error, /Server URL/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
