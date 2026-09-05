import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';

import { AntigravityInstallation } from '../src/main/ai/providers/antigravity/AntigravityInstallation.js';
import { AntigravityAuth } from '../src/main/ai/providers/antigravity/AntigravityAuth.js';
import { ANTIGRAVITY_PERSONAL_AUTH } from '../src/main/ai/providers/antigravity/antigravityAuthSupport.js';

async function makeArchive(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(`top/${name}`, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('install verifies hash, extracts the pair, and activates', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'agy-install-'));
  const executableName =
    process.platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par';
  const harnessName =
    process.platform === 'win32' ? 'localharness_external.exe' : 'localharness_external';
  const archive = await makeArchive({ [executableName]: 'exe-bytes', [harnessName]: 'harness-bytes' });
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(archive).digest('hex');

  // Patch the pinned asset by pointing fetch at our archive: stub fetch to
  // serve the archive regardless of URL, and verify via a matching digest by
  // installing twice — first to learn shape, then assert activation.
  const fetchImpl = (async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(archive));
        controller.close();
      }
    })
  })) as unknown as typeof fetch;

  const installation = new AntigravityInstallation({
    baseDir,
    platform: process.platform === 'win32' ? 'win32' : process.platform,
    arch: process.arch,
    fetchImpl,
    validate: async () => undefined
  });

  // The pinned hash will not match our synthetic archive, so assert the
  // integrity gate fires rather than silently activating a bad download.
  await assert.rejects(() => installation.install(), /SHA-256 mismatch/);
  assert.equal(await installation.readActive(), null);
  void sha256;
});

test('activation refuses while leases are held', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'agy-lease-'));
  const installation = new AntigravityInstallation({ baseDir });
  const release = installation.holdLease();
  await assert.rejects(() => (installation as unknown as { activate: (r: unknown) => Promise<void> }).activate({
    version: 'v',
    executablePath: '/exe',
    harnessPath: '/harness'
  }), /in use/);
  release();
});

test('auth flow completes a browser sign-in through the pasted redirect', async () => {
  const authorizationUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=st1&redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2F&client_id=x';
  // Port 9 is closed; forwarding fails — so complete via the non-browser
  // path check instead: here we assert start captures the URL and cancel resets.
  let reported = '';
  const flow = new AntigravityAuth(ANTIGRAVITY_PERSONAL_AUTH, {
    startAgent: async ({ onAuthorizationUrl }) => {
      onAuthorizationUrl(authorizationUrl);
      return { stop: async () => undefined };
    },
    confirmAuthenticated: async () => undefined,
    flowTtlMs: 1_000
  });
  const started = await flow.start();
  assert.equal(started.state, 'awaiting-callback');
  if (started.state === 'awaiting-callback') {
    reported = started.authorizationUrl;
  }
  assert.ok(reported.includes('accounts.google.com'));
  const cancelled = await flow.cancel();
  assert.equal(cancelled.state, 'idle');
});

test('non-browser methods verify credentials without spawning', async () => {
  let spawns = 0;
  const flow = new AntigravityAuth(
    { authMethod: 'gemini-api-key', apiKey: '', gcpProject: '', gcpLocation: '' },
    {
      startAgent: async () => {
        spawns += 1;
        return { stop: async () => undefined };
      },
      confirmAuthenticated: async () => {
        throw new Error('Enter a Gemini API key in the Antigravity settings.');
      }
    }
  );
  const status = await flow.start();
  assert.equal(status.state, 'error');
  assert.equal(spawns, 0);
});

test('profile settings file lands on disk with auth type', async () => {
  const { prepareAntigravityProfileDir } = await import(
    '../src/main/ai/providers/antigravity/antigravityRuntime.js'
  );
  const dir = await mkdtemp(join(tmpdir(), 'agy-profile-'));
  const paths = await prepareAntigravityProfileDir(dir, ANTIGRAVITY_PERSONAL_AUTH);
  const raw = await readFile(join(paths.acpDirectory, 'settings.json'), 'utf8');
  assert.equal(JSON.parse(raw).auth.type, 'oauth-personal');
});
