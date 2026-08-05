import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { MarketplaceRecord } from '../src/main/plugins/MarketplaceRegistry.js';
import { MarketplaceRegistry } from '../src/main/plugins/MarketplaceRegistry.js';
import { PluginInstaller } from '../src/main/plugins/PluginInstaller.js';
import { PluginMarketplaceService } from '../src/main/plugins/PluginMarketplaceService.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { BUNDLED_MARKETPLACE_NAME } from '../src/shared/marketplace.js';

type Ctx = { after: (fn: () => void) => void };

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** A marketplace directory holding `count` plugin bundles. */
function marketplaceDir(dir: string, name: string, plugins: string[], extra: unknown[] = []) {
  const root = join(dir, name);

  for (const plugin of plugins) {
    write(
      join(root, 'plugins', plugin, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: plugin, version: '1.0.0', description: `${plugin} plugin` })
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
      plugins: [
        ...plugins.map((plugin) => ({
          name: plugin,
          source: { source: 'local', path: `./plugins/${plugin}` },
          category: 'Productivity'
        })),
        ...extra
      ]
    })
  );

  return root;
}

function setup(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-market-svc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const pluginsRoot = join(dir, 'plugins');
  mkdirSync(pluginsRoot, { recursive: true });

  let records: MarketplaceRecord[] = [];
  const marketplaces = new MarketplaceRegistry(() => records, join(dir, 'checkouts'));
  const plugins = new PluginRegistry({ root: pluginsRoot });
  const installer = new PluginInstaller(plugins);
  const service = new PluginMarketplaceService(
    marketplaces,
    plugins,
    installer,
    () => records,
    (next) => {
      records = next;
    }
  );

  return { dir, pluginsRoot, plugins, service, records: () => records };
}

test('adding a marketplace reads its catalogue', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha', 'beta']);

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });

  const [marketplace] = service.view().marketplaces;
  assert.equal(marketplace?.name, 'demo-market');
  assert.equal(marketplace?.error, null);
  assert.deepEqual(marketplace?.entries.map((entry) => entry.name), ['alpha', 'beta']);
});

test('a marketplace that cannot be read is refused at the moment it is typed', (t) => {
  const { dir, service, records } = setup(t);

  assert.throws(() => service.add({ name: 'nope', source: { kind: 'path', path: join(dir, 'missing') } }));
  // An empty directory has no catalogue.
  mkdirSync(join(dir, 'empty'), { recursive: true });
  assert.throws(() => service.add({ name: 'empty', source: { kind: 'path', path: join(dir, 'empty') } }));

  assert.deepEqual(records(), [], 'nothing unreadable is saved');
});

test('a name that could choose where Atlas clones to is refused', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'ok', ['alpha']);

  for (const name of ['../escape', 'has space', 'a/b', '', '.']) {
    assert.throws(() => service.add({ name, source: { kind: 'path', path: root } }), undefined, name);
  }
});

test('a marketplace fetched over plain http is refused', (t) => {
  const { service } = setup(t);

  assert.throws(
    () => service.add({ name: 'insecure', source: { kind: 'git', url: 'http://example.com/r.git', ref: null } }),
    /https/
  );
});

test('two marketplaces cannot share a name', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha']);

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  assert.throws(
    () => service.add({ name: 'DEMO-MARKET', source: { kind: 'path', path: root } }),
    /already added/
  );
});

test('removing a marketplace drops it from the view', (t) => {
  const { dir, service } = setup(t);
  service.add({ name: 'demo-market', source: { kind: 'path', path: marketplaceDir(dir, 'demo-market', ['alpha']) } });

  service.remove('demo-market');
  assert.deepEqual(service.view().marketplaces, []);
});

test('installing from a catalogue goes through the same validation as a folder', (t) => {
  const { dir, service, plugins } = setup(t);
  service.add({ name: 'demo-market', source: { kind: 'path', path: marketplaceDir(dir, 'demo-market', ['alpha']) } });

  service.install('demo-market', 'alpha');

  const installed = plugins.snapshot().plugins;
  assert.deepEqual(installed.map((plugin) => plugin.manifest.name), ['alpha']);
  assert.equal(installed[0]?.skills.length, 1, 'its skills load like any other bundle');
});

test('an installed plugin is marked as such in the catalogue', (t) => {
  const { dir, service } = setup(t);
  service.add({
    name: 'demo-market',
    source: { kind: 'path', path: marketplaceDir(dir, 'demo-market', ['alpha', 'beta']) }
  });

  service.install('demo-market', 'alpha');

  const entries = service.view().marketplaces[0]?.entries ?? [];
  assert.equal(entries.find((entry) => entry.name === 'alpha')?.installed, true);
  assert.equal(entries.find((entry) => entry.name === 'beta')?.installed, false);
});

test('an entry Atlas refuses is listed with its reason rather than hidden', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha'], [
    { name: 'unmanifested', source: { source: 'local', path: './plugins/alpha' }, strict: false },
    { name: 'withheld', source: { source: 'local', path: './plugins/alpha' }, policy: { installation: 'NOT_AVAILABLE' } }
  ]);
  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });

  const entries = service.view().marketplaces[0]?.entries ?? [];

  assert.equal(entries.length, 3, 'refused entries stay in the list');
  assert.match(entries.find((e) => e.name === 'unmanifested')?.blocked ?? '', /no manifest of its own/);
  assert.match(entries.find((e) => e.name === 'withheld')?.blocked ?? '', /unavailable/);
  assert.equal(entries.find((e) => e.name === 'alpha')?.blocked, null);
});

test('installing a refused entry is rejected by the service, not just the button', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha'], [
    { name: 'unmanifested', source: { source: 'local', path: './plugins/alpha' }, strict: false }
  ]);
  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });

  assert.throws(() => service.install('demo-market', 'unmanifested'), /no manifest of its own/);
  assert.throws(() => service.install('demo-market', 'not-listed'), /not listed/);
  assert.throws(() => service.install('no-such-market', 'alpha'), /not an added marketplace/);
});

test('an entry says whether the code it installs is pinned', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha'], [
    {
      name: 'pinned',
      source: {
        source: 'git-subdir',
        url: 'https://github.com/o/r.git',
        path: 'plugins/x',
        sha: '17ef6fb53d2eb23158dec11823ff569258b7a26e'
      }
    },
    { name: 'floating', source: { source: 'git', url: 'https://github.com/o/r.git' } }
  ]);
  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });

  const entries = service.view().marketplaces[0]?.entries ?? [];

  assert.match(entries.find((e) => e.name === 'pinned')?.origin ?? '', /github\.com, pinned/);
  assert.match(entries.find((e) => e.name === 'floating')?.origin ?? '', /github\.com, unpinned/);
  assert.equal(entries.find((e) => e.name === 'alpha')?.origin, 'this marketplace');
});

test('the marketplace Atlas ships with cannot be removed or shadowed', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, BUNDLED_MARKETPLACE_NAME, ['alpha']);

  // Reserved even before anything is registered under it: a user marketplace
  // taking the name would make the app's own plugins disappear.
  assert.throws(
    () => service.add({ name: BUNDLED_MARKETPLACE_NAME, source: { kind: 'path', path: root } }),
    /reserved/
  );

  assert.throws(() => service.remove(BUNDLED_MARKETPLACE_NAME), /cannot be removed/);
});

test('a built-in record is marked as such in the view', (t) => {
  const { dir, service, records } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha']);

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  // Prepended by the caller in production; simulated here by marking the record.
  records()[0]!.builtIn = true;

  assert.equal(service.view().marketplaces[0]?.builtIn, true);
});

test('the plugins shipped with Atlas parse and install like any other bundle', (t) => {
  // Reads the real resources/plugins directory, so a broken bundled manifest
  // fails here rather than at somebody's first launch.
  const { service, plugins } = setup(t);
  const shipped = join(import.meta.dirname, '..', 'resources', 'plugins');

  service.add({ name: 'shipped', source: { kind: 'path', path: shipped } });

  const view = service.view().marketplaces[0]!;
  assert.equal(view.error, null, 'the bundled catalogue must be readable');
  assert.ok(view.entries.length > 0, 'and must list something');
  assert.deepEqual(
    view.entries.filter((entry) => entry.blocked),
    [],
    'nothing Atlas ships may be something Atlas refuses'
  );

  for (const entry of view.entries) {
    service.install('shipped', entry.name);
  }

  const installed = plugins.snapshot().plugins;
  assert.equal(installed.length, view.entries.length);
  assert.ok(
    installed.every((plugin) => plugin.warnings.length === 0),
    `bundled plugins must load cleanly: ${installed.flatMap((p) => p.warnings).join('; ')}`
  );
});

test('an entry that would install and do nothing says so instead', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha']);

  // A connector-only bundle: a valid manifest, no skills, no servers. Atlas has
  // no connector broker, so installing it would be a no-op the user pays for.
  write(
    join(root, 'plugins', 'connector-only', '.plugin', 'plugin.json'),
    JSON.stringify({ name: 'connector-only', version: '1.0.0', description: 'Connector' })
  );
  write(join(root, 'plugins', 'connector-only', '.app.json'), JSON.stringify({ apps: {} }));
  write(
    join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'demo-market',
      plugins: [
        { name: 'alpha', source: { source: 'local', path: './plugins/alpha' } },
        { name: 'connector-only', source: { source: 'local', path: './plugins/connector-only' } },
        // Not fetched yet, so not judged: guessing would be worse than waiting.
        { name: 'remote', source: { source: 'git', url: 'https://example.com/r.git' } }
      ]
    })
  );

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  const entries = service.view().marketplaces[0]?.entries ?? [];

  assert.equal(entries.find((e) => e.name === 'alpha')?.blocked, null);
  assert.match(
    entries.find((e) => e.name === 'connector-only')?.blocked ?? '',
    /no skills or tools/
  );
  assert.equal(entries.find((e) => e.name === 'remote')?.blocked, null, 'unfetched is not judged');
});
