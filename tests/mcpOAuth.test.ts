import assert from 'node:assert/strict';
import { get } from 'node:http';
import test from 'node:test';

import { completeAuthorization, McpOAuthProvider, type OAuthStateStore } from '../src/main/ai/mcp/mcpOAuth.js';

/**
 * The OAuth provider, driven against a real loopback server with an in-memory
 * store and a no-op browser. No network beyond 127.0.0.1.
 */

function memoryStore(): OAuthStateStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    }
  };
}

function fetchLoopback(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    }).on('error', reject);
  });
}

test('the provider persists every kind of state and can invalidate it', async () => {
  const provider = new McpOAuthProvider({
    serverId: 'plugin:acme:api',
    serverName: 'acme',
    store: memoryStore(),
    openExternal: () => undefined
  });

  await provider.saveTokens({ access_token: 'at' } as never);
  await provider.saveClientInformation({ client_id: 'cid' } as never);
  await provider.saveCodeVerifier('verifier');
  assert.equal((await provider.tokens())?.access_token, 'at');
  assert.equal((await provider.clientInformation())?.client_id, 'cid');
  assert.equal(await provider.codeVerifier(), 'verifier');

  await provider.invalidateCredentials('tokens');
  assert.equal(await provider.tokens(), undefined);
  assert.equal((await provider.clientInformation())?.client_id, 'cid', 'only the asked kind is dropped');

  await provider.invalidateCredentials('all');
  assert.equal(await provider.clientInformation(), undefined);
  await assert.rejects(provider.codeVerifier(), /missing/);
});

test('a consent round trip lands on the loopback port and resolves with the code', async () => {
  const provider = new McpOAuthProvider({
    serverId: 'plugin:acme:api',
    serverName: 'acme',
    store: memoryStore(),
    openExternal: () => undefined
  });
  try {
    const landing = provider.waitForCallback();

    // The redirect binds the listener, so the redirect URL only now carries a
    // real port — the port a consent page must be built to return to.
    await provider.redirectToAuthorization(new URL('https://auth.example/consent'));
    const redirect = provider.redirectUrl;
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const status = await fetchLoopback(`${redirect}?code=the-code&state=ignored`);
    assert.equal(status, 200);

    const resolved = await landing;
    assert.equal(resolved.searchParams.get('code'), 'the-code');
  } finally {
    provider.close();
  }
});

test('a state mismatch is refused, and nothing resolves', async () => {
  const provider = new McpOAuthProvider({
    serverId: 'plugin:acme:api',
    serverName: 'acme',
    store: memoryStore(),
    openExternal: () => undefined
  });
  try {
    const landing = provider.waitForCallback();
    const rejection = assert.rejects(landing, /does not match/);

    // The SDK generates the state through `state()` before building the
    // authorization URL; the landing must carry the same value.
    const state = provider.state();
    await provider.redirectToAuthorization(new URL(`https://auth.example/consent?state=${state}`));
    const redirect = provider.redirectUrl;

    await fetchLoopback(`${redirect}?code=x&state=forged`);
    await rejection;
  } finally {
    provider.close();
  }
});

test('completeAuthorization: REDIRECT, consent, code, tokens', async () => {
  const provider = new McpOAuthProvider({
    serverId: 'plugin:acme:api',
    serverName: 'acme',
    store: memoryStore(),
    openExternal: () => undefined
  });

  const calls: string[] = [];
  const result = await completeAuthorization(provider, async (options) => {
    calls.push(options.authorizationCode ?? 'initial');

    if (options.authorizationCode) {
      // The SDK's exchange writes the tokens it received.
      await provider.saveTokens({ access_token: 'fresh' } as never);
      return 'AUTHORIZED' as const;
    }

    // The first pass is what opens the browser; this fake plays both sides —
    // generate the state the way the SDK does, land on the loopback port.
    const state = provider.state();
    await provider.redirectToAuthorization(new URL(`https://auth.example/consent?state=${state}`));
    const status = await fetchLoopback(`${provider.redirectUrl}?code=real-code&state=${state}`);
    assert.equal(status, 200);
    return 'REDIRECT' as const;
  });

  assert.equal(result, 'ready');
  assert.deepEqual(calls, ['initial', 'real-code']);
  assert.equal((await provider.tokens())?.access_token, 'fresh');
  provider.close();
});

test('completeAuthorization returns ready immediately when already authorized', async () => {
  const provider = new McpOAuthProvider({
    serverId: 'plugin:acme:api',
    serverName: 'acme',
    store: memoryStore(),
    openExternal: () => undefined,
    callbackTimeoutMs: 250
  });

  const result = await completeAuthorization(provider, () => Promise.resolve('AUTHORIZED' as const));

  assert.equal(result, 'ready');
  provider.close();
});
