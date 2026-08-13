import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadPlugin } from '../src/main/plugins/PluginLoader.js';
import { createPluginMcpSource } from '../src/main/plugins/PluginMcpSource.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';

type Ctx = { after: (fn: () => void) => void };

function pluginsRoot(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-plugin-mcp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function installPlugin(root: string, name: string, servers: Record<string, unknown>) {
  const bundle = join(root, name);
  write(
    join(bundle, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} plugin` })
  );
  write(join(bundle, '.mcp.json'), JSON.stringify({ mcpServers: servers }));
  return bundle;
}

function shipBinary(bundle: string, relative: string) {
  write(join(bundle, relative), '#!/bin/sh\nexec cat\n');
  chmodSync(join(bundle, relative), 0o755);
}

function servers(root: string) {
  return createPluginMcpSource(new PluginRegistry({ root }))();
}

test('a bundle with no MCP configuration contributes no servers', (t) => {
  const root = pluginsRoot(t);
  const bundle = join(root, 'demo');
  write(
    join(bundle, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0', description: 'Demo' })
  );

  assert.deepEqual(servers(root), []);
});

test('an http server maps onto the runtime config', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'cloudflare', {
    'cloudflare-api': { type: 'http', url: 'https://mcp.cloudflare.com/mcp', note: 'ignored' }
  });

  const [server] = servers(root);

  assert.equal(server?.transport, 'http');
  assert.equal(server?.url, 'https://mcp.cloudflare.com/mcp');
  assert.equal(server?.command, null);
  assert.equal(server?.enabled, true);
  assert.equal(server?.approvalMode, 'auto', 'third-party tools must default to asking');
});

test('a server name is qualified so two bundles can both ship "github"', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'acme', { github: { type: 'http', url: 'https://acme.test/mcp' } });
  installPlugin(root, 'openai', { github: { type: 'http', url: 'https://openai.test/mcp' } });

  const names = servers(root).map((server) => server.name).sort();
  assert.deepEqual(names, ['acme/github', 'openai/github']);
});

test('server ids are stable across rescans so live connections survive', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'demo', { s: { type: 'http', url: 'https://example.test/mcp' } });

  const registry = new PluginRegistry({ root });
  const source = createPluginMcpSource(registry);

  const first = source().map((server) => server.id);
  registry.invalidate();
  const second = source().map((server) => server.id);

  assert.deepEqual(first, second);
  assert.deepEqual(first, ['plugin:demo:s']);
});

test('a bundle-shipped command is resolved to an absolute path', (t) => {
  const root = pluginsRoot(t);
  const bundle = installPlugin(root, 'demo', {
    local: { command: './bin/server', args: ['mcp'], cwd: '.', env_vars: ['HOME'] }
  });
  shipBinary(bundle, join('bin', 'server'));

  const [server] = servers(root);
  // Compared against the realpath: the loader resolves symlinks so containment
  // can be proven, and on macOS /var is itself a link to /private/var.
  const real = realpathSync(bundle);

  assert.equal(server?.command, join(real, 'bin', 'server'));
  assert.equal(server?.cwd, real, '"." means the bundle root');
  assert.deepEqual(server?.args, ['mcp']);
  assert.deepEqual(server?.envVars, ['HOME'], 'env_vars maps onto envVars');
});

test('a command resolved through PATH is passed through untouched', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'demo', { npx: { command: 'npx', args: ['-y', 'some-server'] } });

  assert.equal(servers(root)[0]?.command, 'npx');
});

test('a stdio server with no declared cwd still runs inside its own bundle', (t) => {
  // Regression from the real corpus: codex-security and episodic-memory both
  // ship `node ./some/script.js` with no cwd. Those relative arguments are
  // written against the bundle root, so inheriting Atlas's working directory
  // would point them at nothing.
  const root = pluginsRoot(t);
  const bundle = installPlugin(root, 'demo', {
    s: { command: 'node', args: ['./cli/server.js'] }
  });

  assert.equal(servers(root)[0]?.cwd, realpathSync(bundle));
});

test('an http server gets no working directory, because nothing is spawned', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'demo', { s: { type: 'http', url: 'https://example.test/mcp' } });

  assert.equal(servers(root)[0]?.cwd, null);
});

test('a command symlinked outside the bundle is refused', (t) => {
  const root = pluginsRoot(t);
  const bundle = installPlugin(root, 'demo', { evil: { command: './bin/server' } });
  mkdirSync(join(bundle, 'bin'), { recursive: true });
  symlinkSync('/bin/sh', join(bundle, 'bin', 'server'));

  assert.deepEqual(servers(root), [], 'a symlinked escape must contribute no server');

  const loaded = loadPlugin(bundle);
  assert.ok(loaded.ok && loaded.plugin.warnings.some((w) => /outside the plugin/.test(w)));
});

test('a command the bundle does not actually ship is refused', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'demo', { missing: { command: './bin/not-there' } });

  assert.deepEqual(servers(root), []);
});

test('a working directory outside the bundle is refused', (t) => {
  const root = pluginsRoot(t);
  const bundle = installPlugin(root, 'demo', { s: { command: 'node', cwd: './out' } });
  mkdirSync(join(bundle, 'elsewhere'), { recursive: true });
  symlinkSync(tmpdir(), join(bundle, 'out'));

  assert.deepEqual(servers(root), []);
});

test('a bearer token travels as a variable name, never a value', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'github', {
    github: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      bearer_token_env_var: 'GITHUB_PAT_TOKEN'
    }
  });

  const [server] = servers(root);

  assert.equal(server?.bearerTokenEnvVar, 'GITHUB_PAT_TOKEN');
  assert.doesNotMatch(JSON.stringify(server), /ghp_|token"\s*:\s*"[^"]/i);
});

test('a malformed .mcp.json costs the bundle its servers and nothing else', (t) => {
  const root = pluginsRoot(t);
  const bundle = join(root, 'demo');
  write(
    join(bundle, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0', description: 'Demo' })
  );
  write(join(bundle, '.mcp.json'), '{ not json');
  write(
    join(bundle, 'skills', 'yeet', 'SKILL.md'),
    ['---', 'name: yeet', 'description: Ship it.', '---', 'body'].join('\n')
  );

  const loaded = loadPlugin(bundle);

  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.ok ? loaded.plugin.mcpServers : null, []);
  assert.equal(loaded.ok ? loaded.plugin.skills.length : 0, 1, 'the skills still load');
  assert.match(loaded.ok ? loaded.plugin.warnings.join(' ') : '', /Ignored/);
});

test('one bundle with a bad server does not cost another bundle its servers', (t) => {
  const root = pluginsRoot(t);
  installPlugin(root, 'broken', { s: { command: './bin/not-there' } });
  installPlugin(root, 'fine', { s: { type: 'http', url: 'https://example.test/mcp' } });

  assert.deepEqual(servers(root).map((server) => server.name), ['fine/s']);
});
