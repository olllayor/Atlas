import assert from 'node:assert/strict';
import test from 'node:test';

import { describeOpenCodeFailure } from '../src/main/ai/providers/opencode/openCodeErrors.js';
import {
  MIN_OPENCODE_VERSION,
  probeOpenCode
} from '../src/main/ai/providers/opencode/probeOpenCode.js';
import type { OpenCodeInventoryClient } from '../src/main/ai/providers/opencode/OpenCodeClient.js';
import { defaultOpenCodeSettings } from '../src/shared/opencodeSettingsSchema.js';

/* ------------------------------------------------------------------ *
 * Error taxonomy (t3 branch table)
 * ------------------------------------------------------------------ */

test('taxonomy maps auth failures on external servers', () => {
  const report = describeOpenCodeFailure(new Error('Request failed with status code 401'), {
    isExternalServer: true,
    serverUrl: 'http://oc.example.io'
  });
  assert.equal(report.installed, true);
  assert.match(report.message, /rejected authentication/);
});

test('taxonomy maps unreachable servers with their URL', () => {
  const report = describeOpenCodeFailure(
    Object.assign(new Error('fetch failed'), {}),
    { isExternalServer: true, serverUrl: 'http://127.0.0.1:4096' }
  );
  assert.equal(report.installed, true);
  assert.match(report.message, /Couldn't reach the configured OpenCode server at http:\/\/127\.0\.0\.1:4096/);
});

test('taxonomy treats ENOENT as missing CLI locally', () => {
  const err = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' });
  const report = describeOpenCodeFailure(err, { isExternalServer: false, serverUrl: '' });
  assert.equal(report.installed, false);
  assert.match(report.message, /not installed or not on PATH/);
});

test('taxonomy keeps raw detail for unknown local failures', () => {
  const report = describeOpenCodeFailure(new Error('EACCES weirdness'), {
    isExternalServer: false,
    serverUrl: ''
  });
  assert.equal(report.installed, true);
  assert.match(report.message, /EACCES weirdness/);
});

/* ------------------------------------------------------------------ *
 * Probe orchestration (fully faked IO)
 * ------------------------------------------------------------------ */

function fakeInventory(connected: string[], modelCount = 0): OpenCodeInventoryClient {
  return {
    async listProviders() {
      return {
        providers: connected.map((id) => ({ id, name: id, models: [] })),
        connected,
        defaults: {},
        modelCount
      };
    }
  };
}

const VERSION_OK = { version: '1.18.23', executableMissing: false };

test('probe reports missing binary via ENOENT', async () => {
  const result = await probeOpenCode({
    settings: defaultOpenCodeSettings(),
    directory: '/proj',
    deps: {
      readBinaryVersion: async () => ({ version: null, executableMissing: true })
    }
  });
  assert.equal(result.installed, false);
  assert.equal(result.status, 'error');
  assert.match(result.message!, /not installed or not on PATH/);
});

test('probe enforces the t3 minimum version floor', async () => {
  const oldVersion = '1.13.2';
  const result = await probeOpenCode({
    settings: defaultOpenCodeSettings(),
    directory: '/proj',
    deps: {
      readBinaryVersion: async () => ({ version: oldVersion, executableMissing: false })
    }
  });
  assert.equal(result.version, oldVersion);
  assert.equal(result.status, 'error');
  assert.match(result.message!, new RegExp(`Upgrade to v${MIN_OPENCODE_VERSION}`));
});

test('happy spawned probe: ready, authenticated, counts providers/models, passes password', async () => {
  const createCalls: Array<{ baseUrl: string; serverPassword?: string }> = [];
  const result = await probeOpenCode({
    settings: defaultOpenCodeSettings(),
    directory: '/proj',
    serverPassword: 's3cret',
    deps: {
      readBinaryVersion: async () => VERSION_OK,
      connectOwnedServer: async () => ({ baseUrl: 'http://127.0.0.1:40011' }),
      createClient: (call) => {
        createCalls.push({ baseUrl: call.baseUrl, ...(call.serverPassword ? { serverPassword: call.serverPassword } : {}) });
        return fakeInventory(['anthropic', 'openai/gateway'], 12);
      }
    }
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.auth, { status: 'authenticated' });
  assert.deepEqual(result.connectedProviders.sort(), ['anthropic', 'openai/gateway']);
  assert.equal(result.modelCount, 12);
  assert.equal(result.baseUrlUsed, 'http://127.0.0.1:40011');
  assert.match(result.message!, /2 upstream providers connected through OpenCode/);
  assert.deepEqual(createCalls[0], { baseUrl: 'http://127.0.0.1:40011', serverPassword: 's3cret' });
});

test('spawned probe without connected upstreams warns toward `opencode auth login`', async () => {
  const result = await probeOpenCode({
    settings: defaultOpenCodeSettings(),
    directory: '/proj',
    deps: {
      readBinaryVersion: async () => VERSION_OK,
      connectOwnedServer: async () => ({ baseUrl: 'http://127.0.0.1:40012' }),
      createClient: () => fakeInventory([], 0)
    }
  });

  assert.equal(result.status, 'warning');
  assert.deepEqual(result.auth, { status: 'unknown' });
  assert.match(result.message!, /Run `opencode auth login`/);
});

test('pure-external probe can skip the local binary gate and maps 401s', async () => {
  const result = await probeOpenCode({
    settings: { ...defaultOpenCodeSettings(), enabled: true, serverUrl: 'https://oc.corp' },
    directory: '/proj',
    skipBinaryVersionCheck: true,
    deps: {
      readBinaryVersion: async () => {
        throw new Error('must not run the binary at all');
      },
      createClient: () => {
        throw new Error('Request failed with status code 401 Unauthorized');
      }
    }
  });

  assert.equal(result.installed, true);
  assert.equal(result.status, 'error');
  assert.match(result.message!, /rejected authentication/);
});

test('external probe failure of transport kind names the configured URL', async () => {
  const result = await probeOpenCode({
    settings: { ...defaultOpenCodeSettings(), enabled: true, serverUrl: 'https://oc.corp' },
    directory: '/proj',
    skipBinaryVersionCheck: true,
    deps: {
      readBinaryVersion: async () => ({ version: null, executableMissing: false }),
      createClient: () => {
        throw new Error('request to https://oc.corp failed: ECONNREFUSED');
      }
    }
  });

  assert.equal(result.status, 'error');
  assert.match(result.message!, /Couldn't reach the configured OpenCode server at https:\/\/oc\.corp/);
});

test('unparsable version output fails loudly with floor guidance', async () => {
  const result = await probeOpenCode({
    settings: defaultOpenCodeSettings(),
    directory: '/proj',
    deps: {
      readBinaryVersion: async () => ({ version: null, executableMissing: false })
    }
  });
  assert.equal(result.status, 'error');
  assert.match(result.message!, /Unable to determine OpenCode version/);
});

test('a pure-external probe can skip the CLI check and still report the server', async () => {
  let versionReads = 0;
  const result = await probeOpenCode({
    settings: { ...defaultOpenCodeSettings(), serverUrl: 'http://oc.example.io' },
    directory: '/proj',
    skipBinaryVersionCheck: true,
    deps: {
      readBinaryVersion: async () => {
        versionReads += 1;
        return { version: null, executableMissing: true };
      },
      createClient: () => fakeInventory(['anthropic'], 4)
    }
  });

  assert.equal(versionReads, 0, 'the local binary was never consulted');
  assert.equal(result.status, 'ready');
  assert.equal(result.version, null, 'no version was checked, so none is claimed');
  assert.equal(result.baseUrlUsed, 'http://oc.example.io');
});

test('skipping the CLI check is refused for a spawned server', async () => {
  let versionReads = 0;
  const result = await probeOpenCode({
    settings: defaultOpenCodeSettings(),
    directory: '/proj',
    // There is no external server to stand in for the binary, so the flag must
    // not let a missing CLI through as healthy.
    skipBinaryVersionCheck: true,
    deps: {
      readBinaryVersion: async () => {
        versionReads += 1;
        return { version: null, executableMissing: true };
      }
    }
  });

  assert.equal(versionReads, 1);
  assert.equal(result.installed, false);
  assert.equal(result.status, 'error');
});

test('an unreachable external server is reported against its URL either way', async () => {
  for (const skipBinaryVersionCheck of [false, true]) {
    const result = await probeOpenCode({
      settings: { ...defaultOpenCodeSettings(), serverUrl: 'http://oc.example.io' },
      directory: '/proj',
      skipBinaryVersionCheck,
      deps: {
        readBinaryVersion: async () => VERSION_OK,
        createClient: () => ({
          async listProviders() {
            throw new Error('fetch failed');
          }
        })
      }
    });

    assert.equal(result.status, 'error');
    assert.match(result.message!, /Couldn't reach the configured OpenCode server at http:\/\/oc\.example\.io/);
  }
});
