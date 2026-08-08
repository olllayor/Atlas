import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { MarketplaceRecord } from '../src/main/plugins/MarketplaceRegistry.js';
import { MarketplaceRegistry } from '../src/main/plugins/MarketplaceRegistry.js';
import { PluginBlocklistService } from '../src/main/plugins/PluginBlocklistService.js';
import { PluginInstaller } from '../src/main/plugins/PluginInstaller.js';
import { PluginMarketplaceService } from '../src/main/plugins/PluginMarketplaceService.js';
import type { PluginOrigin } from '../src/main/plugins/PluginOrigins.js';
import { PluginOriginStore } from '../src/main/plugins/PluginOrigins.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { buildPluginsView } from '../src/main/plugins/pluginViews.js';
import type { Blocklist } from '../src/shared/blocklist.js';
import { EMPTY_BLOCKLIST, findBlock, parseBlocklist } from '../src/shared/blocklist.js';
import { comparePluginVersions } from '../src/shared/plugins.js';

type Ctx = { after: (fn: () => void) => void };

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function marketplaceDir(dir: string, name: string, plugins: string[], version = '1.0.0') {
  const root = join(dir, name);

  for (const plugin of plugins) {
    write(
      join(root, 'plugins', plugin, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: plugin, version, description: `${plugin} plugin` })
    );
    write(
      join(root, 'plugins', plugin, 'skills', 'go', 'SKILL.md'),
      ['---', 'name: go', 'description: Do the thing.', '---', 'Body.'].join('\n')
    );
  }

  write(
    join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name,
      plugins: plugins.map((plugin) => ({
        name: plugin,
        source: { source: 'local', path: `./plugins/${plugin}` }
      }))
    })
  );

  return root;
}

function setup(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-blocklist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const pluginsRoot = join(dir, 'plugins');
  mkdirSync(pluginsRoot, { recursive: true });

  let records: MarketplaceRecord[] = [];
  let origins: Record<string, PluginOrigin> = {};
  let stored: Blocklist = EMPTY_BLOCKLIST;

  const marketplaces = new MarketplaceRegistry(() => records, join(dir, 'checkouts'));
  const originStore = new PluginOriginStore(
    () => origins,
    (next) => {
      origins = next;
    }
  );
  const blocklist = new PluginBlocklistService(
    () => stored,
    (next) => {
      stored = next;
    },
    originStore
  );
  const plugins = new PluginRegistry({
    root: pluginsRoot,
    blockedReason: (name, version) => blocklist.check(name, version)?.message ?? null
  });
  const installer = new PluginInstaller(plugins, originStore);
  const service = new PluginMarketplaceService(
    marketplaces,
    plugins,
    installer,
    () => records,
    (next) => {
      records = next;
    },
    blocklist
  );

  return {
    dir,
    plugins,
    service,
    blocklist,
    originStore,
    stored: () => stored,
    markBuiltIn: (name: string) => {
      const record = records.find((entry) => entry.name === name);

      if (record) {
        record.builtIn = true;
      }
    }
  };
}

test('a blocklist is read in either shape', () => {
  const keyed = parseBlocklist(
    JSON.stringify({ plugins: { 'alpha@some-market': { reason: 'security', detail: 'Leaked keys.' } } })
  );
  assert.equal(keyed.ok, true);
  assert.deepEqual(keyed.ok ? keyed.blocklist.entries[0] : null, {
    plugin: 'alpha',
    marketplace: 'some-market',
    reason: 'security',
    detail: 'Leaked keys.',
    maxVersion: null
  });

  const listed = parseBlocklist(
    JSON.stringify({ blocked: [{ plugin: 'beta', reason: 'broken', maxVersion: '2.0.0' }] })
  );
  assert.equal(listed.ok, true);
  assert.equal(listed.ok ? listed.blocklist.entries[0]?.marketplace : 'x', null);
  assert.equal(listed.ok ? listed.blocklist.entries[0]?.maxVersion : null, '2.0.0');
});

test('one malformed entry does not disarm the rest of the file', () => {
  const parsed = parseBlocklist(
    JSON.stringify({ blocked: [{ nothing: true }, 'gamma@market', { plugin: '../escape' }] })
  );

  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.ok ? parsed.blocklist.entries.map((entry) => entry.plugin) : [],
    ['gamma'],
    'the usable entry still applies'
  );
});

test('a version ceiling exempts the release that carries the fix', () => {
  const blocklist: Blocklist = {
    entries: [
      { plugin: 'alpha', marketplace: null, reason: 'security', detail: null, maxVersion: '1.5.0' }
    ]
  };

  const at = (version: string) =>
    findBlock(blocklist, { name: 'alpha', version, origin: null }, comparePluginVersions);

  assert.ok(at('1.4.0'), 'an older version is covered');
  assert.ok(at('1.5.0'), 'the ceiling itself is covered');
  assert.equal(at('1.5.1'), null, 'the fixed release is not');
});

test('a revoked plugin stops running and cannot be switched back on', (t) => {
  const { dir, service, plugins, blocklist, markBuiltIn } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha', 'beta']);

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  markBuiltIn('demo-market');
  service.install('demo-market', 'alpha');
  service.install('demo-market', 'beta');

  assert.equal(plugins.snapshot().plugins.length, 2);

  write(
    join(root, '.agents', 'plugins', 'blocklist.json'),
    JSON.stringify({
      plugins: { 'alpha@demo-market': { reason: 'security', detail: 'Exfiltrates tokens.' } }
    })
  );

  // The page load is what picks a revocation up; nothing polls for one.
  service.view();
  plugins.invalidate();

  const snapshot = plugins.snapshot();
  assert.deepEqual(
    snapshot.plugins.map((plugin) => plugin.manifest.name),
    ['beta'],
    'a revoked plugin contributes no skills or tools'
  );
  assert.equal(snapshot.blocked.length, 1);
  assert.match(snapshot.blocked[0]?.reason ?? '', /Withdrawn for security/);
  assert.match(snapshot.blocked[0]?.reason ?? '', /Exfiltrates tokens/, 'the publisher’s words are kept');

  const view = buildPluginsView(plugins);
  const row = view.plugins.find((plugin) => plugin.name === 'alpha');
  assert.equal(row?.enabled, false, 'and it is still listed, so it can be found and removed');
  assert.ok(row?.blockedReason);

  // Reinstalling is the obvious way around a revocation, so it is closed too.
  assert.throws(() => service.install('demo-market', 'alpha'), /Withdrawn for security/);
  assert.equal(blocklist.check('beta', '1.0.0'), null, 'and nothing else is affected');
});

test('a marketplace may not revoke a plugin it did not publish', (t) => {
  const { dir, service, plugins } = setup(t);
  const mine = marketplaceDir(dir, 'mine', ['alpha']);
  const rival = marketplaceDir(dir, 'rival', ['beta']);

  write(
    join(rival, '.agents', 'plugins', 'blocklist.json'),
    JSON.stringify({ plugins: { 'alpha@mine': { reason: 'security' } } })
  );

  service.add({ name: 'mine', source: { kind: 'path', path: mine } });
  service.add({ name: 'rival', source: { kind: 'path', path: rival } });
  service.install('mine', 'alpha');

  service.view();
  plugins.invalidate();

  assert.deepEqual(
    plugins.snapshot().plugins.map((plugin) => plugin.manifest.name),
    ['alpha'],
    'a third party naming someone else’s marketplace is ignored'
  );
});

test('a third party’s unscoped revocation is confined to its own storefront', (t) => {
  const { dir, service, plugins } = setup(t);
  const mine = marketplaceDir(dir, 'mine', ['alpha']);
  const rival = marketplaceDir(dir, 'rival', ['beta']);

  // No `@marketplace`, so it reads as "this plugin anywhere" — which a
  // third-party catalogue does not get to say.
  write(
    join(rival, '.agents', 'plugins', 'blocklist.json'),
    JSON.stringify({ blocked: ['alpha'] })
  );

  service.add({ name: 'mine', source: { kind: 'path', path: mine } });
  service.add({ name: 'rival', source: { kind: 'path', path: rival } });
  service.install('mine', 'alpha');

  service.view();
  plugins.invalidate();

  assert.equal(plugins.snapshot().plugins.length, 1, 'the copy installed from elsewhere still runs');
});

test('what Atlas ships may revoke a bundle installed from a folder', (t) => {
  const { dir, service, plugins, markBuiltIn } = setup(t);
  const shipped = marketplaceDir(dir, 'shipped', ['ignored']);
  const other = marketplaceDir(dir, 'other', ['alpha']);

  write(
    join(shipped, '.agents', 'plugins', 'blocklist.json'),
    JSON.stringify({ blocked: [{ plugin: 'alpha', reason: 'malware' }] })
  );

  service.add({ name: 'shipped', source: { kind: 'path', path: shipped } });
  service.add({ name: 'other', source: { kind: 'path', path: other } });
  markBuiltIn('shipped');
  service.install('other', 'alpha');

  service.view();
  plugins.invalidate();

  assert.equal(plugins.snapshot().plugins.length, 0, 'the app’s own list is not scoped to itself');
  assert.equal(plugins.snapshot().blocked.length, 1);
});

test('a revocation survives being offline, because it is stored rather than fetched', (t) => {
  const { dir, service, plugins, stored, markBuiltIn } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha']);

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  markBuiltIn('demo-market');
  service.install('demo-market', 'alpha');

  write(
    join(root, '.agents', 'plugins', 'blocklist.json'),
    JSON.stringify({ plugins: { 'alpha@demo-market': { reason: 'security' } } })
  );
  service.view();

  assert.equal(stored().entries.length, 1, 'the answer is persisted');

  // The marketplace disappears entirely — a deleted folder, an unreachable
  // remote. The revocation must not disappear with it.
  rmSync(root, { recursive: true, force: true });

  const offline = new PluginBlocklistService(stored, () => {}, new PluginOriginStore(() => ({}), () => {}));
  assert.ok(offline.check('alpha', '1.0.0'), 'and still applies when nothing can be fetched');
  assert.equal(plugins.snapshot().blocked.length, 1);
});

test('a scoped revocation still covers a copy whose origin was never recorded', (t) => {
  const { dir, service, plugins, originStore, markBuiltIn } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha']);

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  markBuiltIn('demo-market');
  service.install('demo-market', 'alpha');

  // Every plugin installed before provenance existed looks like this. If an
  // unknown origin were treated as "not this marketplace", revocation would
  // arrive unable to reach a single already-installed bundle.
  originStore.forget('alpha');

  write(
    join(root, '.agents', 'plugins', 'blocklist.json'),
    JSON.stringify({ plugins: { 'alpha@demo-market': { reason: 'security' } } })
  );
  service.view();
  plugins.invalidate();

  assert.equal(plugins.snapshot().blocked.length, 1);
});

test('a catalogue row says when its entry has been withdrawn', (t) => {
  const { dir, service, markBuiltIn } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha', 'beta']);

  write(
    join(root, '.agents', 'plugins', 'blocklist.json'),
    JSON.stringify({ plugins: { 'alpha@demo-market': { reason: 'security' } } })
  );

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  markBuiltIn('demo-market');

  const entries = service.view().marketplaces[0]?.entries ?? [];
  assert.match(entries.find((entry) => entry.name === 'alpha')?.blocked ?? '', /Withdrawn for security/);
  assert.equal(entries.find((entry) => entry.name === 'beta')?.blocked, null);
});
