import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenCodeController } from '../src/main/ai/providers/opencode/openCodeController.js';
import type { OpenCodeSessionsRepo } from '../src/main/db/repositories/opencodeSessionsRepo.js';
import type { ProviderRegistry } from '../src/main/ai/core/providerRegistry.js';
import type { OpenCodeSettings } from '../src/shared/opencodeSettings.js';
import {
  defaultOpenCodeSettings,
  parseOpenCodeSettings
} from '../src/shared/opencodeSettingsSchema.js';

function fakeSettingsRepo(initial: OpenCodeSettings = defaultOpenCodeSettings()) {
  let stored = initial;
  return {
    getOpenCodeSettings: () => parseOpenCodeSettings(stored),
    setOpenCodeSettings: (settings: OpenCodeSettings) => {
      stored = settings;
    },
    read: () => stored
  };
}

function fakeKeychain(initial: string | null = null) {
  const accounts = new Map<string, string>();
  if (initial) accounts.set('opencode-server-password', initial);
  return {
    accounts,
    getSecretByAccount: async (account: string) => accounts.get(account) ?? null,
    setSecretByAccount: async (account: string, secret: string) => {
      accounts.set(account, secret);
    },
    deleteSecretByAccount: async (account: string) => {
      accounts.delete(account);
    }
  };
}

const NOOP_SESSIONS = {
  get: () => null,
  set: () => undefined,
  clear: () => undefined
} as unknown as OpenCodeSessionsRepo;

function buildController(settings?: OpenCodeSettings) {
  const settingsRepo = fakeSettingsRepo(settings);
  const keychain = fakeKeychain();
  const registry: ProviderRegistry = new Map();
  const shutdowns: number[] = [];
  const changes: number[] = [];
  const leases = { taken: 0, returned: 0 };

  const controller = new OpenCodeController({
    settingsRepo,
    keychain,
    sessions: NOOP_SESSIONS,
    registry,
    defaultDirectory: () => '/proj',
    onRegistryChanged: () => {
      changes.push(1);
    },
    createRuntime: () =>
      ({
        connect: async () => {
          leases.taken += 1;
          return {
            baseUrl: 'http://127.0.0.1:4096',
            owned: true,
            release: () => {
              leases.returned += 1;
            }
          };
        },
        shutdown: async () => {
          shutdowns.push(1);
        },
        setUnexpectedExitHandler: () => undefined
      }) as never
  });

  return { controller, settingsRepo, keychain, registry, shutdowns, changes, leases };
}

test('a disabled integration registers nothing and never touches a server', async () => {
  const { controller, registry, changes } = buildController();

  await controller.syncRegistry();

  assert.equal(registry.size, 0);
  assert.deepEqual(changes, []);
});

test('enabling registers the adapter and announces the catalog change', async () => {
  const { controller, registry, changes } = buildController();

  const view = await controller.updateSettings({ enabled: true });

  assert.equal(view.enabled, true);
  assert.equal(registry.get('opencode')?.providerId, 'opencode');
  assert.equal(changes.length, 1);

  // Idempotent: a second sync must not re-register or re-announce.
  await controller.syncRegistry();
  assert.equal(changes.length, 1);
});

test('disabling unregisters the adapter and shuts the server down', async () => {
  const { controller, registry, shutdowns } = buildController();

  await controller.updateSettings({ enabled: true });
  await controller.probe().catch(() => undefined);
  await controller.updateSettings({ enabled: false });

  assert.equal(registry.has('opencode'), false);
  assert.equal(shutdowns.length, 1);
});

test('an invalid patch is rejected whole, leaving settings untouched', async () => {
  const { controller, settingsRepo } = buildController();

  await assert.rejects(controller.updateSettings({ serverUrl: 'ftp://nope' }), /http\(s\) URL/);
  assert.equal(settingsRepo.read().serverUrl, '');
});

test('the password lives in the keychain and is only ever reported as present', async () => {
  const { controller, keychain, settingsRepo } = buildController();

  await controller.setServerPassword('  hunter2  ');
  assert.equal(keychain.accounts.get('opencode-server-password'), 'hunter2');

  const view = await controller.getStatusView();
  assert.equal(view.hasServerPassword, true);
  assert.equal('serverPassword' in view, false);
  assert.equal(JSON.stringify(settingsRepo.read()).includes('hunter2'), false);

  await controller.setServerPassword('');
  assert.equal(keychain.accounts.has('opencode-server-password'), false);
  assert.equal((await controller.getStatusView()).hasServerPassword, false);
});

test('probe failures surface as a probe result, not an exception', async () => {
  const { controller } = buildController({
    ...defaultOpenCodeSettings(),
    enabled: true,
    binaryPath: '/definitely/not/here/opencode'
  });

  const result = await controller.probe();
  assert.equal(result.installed, false);
  assert.equal(result.status, 'error');
  assert.match(result.message!, /not installed or not on PATH/);
});

test('a probe returns its lease, so repeated tests cannot pin the server', async () => {
  const { controller, leases } = buildController({
    ...defaultOpenCodeSettings(),
    enabled: true,
    // Pretend the CLI is fine so the probe reaches the connect step.
    binaryPath: process.execPath
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await controller.probe();
  }

  assert.equal(leases.taken, 3, 'each probe connected');
  // The fake base URL is not listening, so these probes also fail mid-flight:
  // the lease must come back either way.
  assert.equal(leases.returned, 3, 'every lease came back');
});
