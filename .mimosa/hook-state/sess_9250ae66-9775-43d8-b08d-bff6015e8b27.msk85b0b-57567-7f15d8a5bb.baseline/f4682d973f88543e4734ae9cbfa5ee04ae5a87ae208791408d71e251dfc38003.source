import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { PluginUpdateService } from '../src/main/plugins/PluginUpdateService.js';
import type { Blocklist } from '../src/shared/blocklist.js';
import { EMPTY_BLOCKLIST } from '../src/shared/blocklist.js';

type Ctx = { after: (fn: () => void) => void };

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** A marketplace holding one bundle, at whatever version it is told. */
function marketplaceDir(dir: string, name: string, plugin: string, version: string) {
  const root = join(dir, name);

  write(
    join(root, 'plugins', plugin, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: plugin, version, description: `${plugin} plugin` })
  );
  write(
    join(root, 'plugins', plugin, 'skills', 'go', 'SKILL.md'),
    ['---', 'name: go', `description: Version ${version}.`, '---', `Body ${version}.`].join('\n')
  );
  write(
    join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name,
      plugins: [{ name: plugin, source: { source: 'local', path: `./plugins/${plugin}` } }]
    })
  );

  return root;
}

function setup(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-plugin-updates-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const pluginsRoot = join(dir, 'plugins');
  mkdirSync(pluginsRoot, { recursive: true });

  let records: MarketplaceRecord[] = [];
  let origins: Record<string, PluginOrigin> = {};
  let blocklist: Blocklist = EMPTY_BLOCKLIST;

  const marketplaces = new MarketplaceRegistry(() => records, join(dir, 'checkouts'));
  const originStore = new PluginOriginStore(
    () => origins,
    (next) => {
      origins = next;
    }
  );
  const blocklistService = new PluginBlocklistService(
    () => blocklist,
    (next) => {
      blocklist = next;
    },
    originStore
  );
  const plugins = new PluginRegistry({
    root: pluginsRoot,
    blockedReason: (name, version) => blocklistService.check(name, version)?.message ?? null
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
    blocklistService
  );
  const updates = new PluginUpdateService(
    marketplaces,
    plugins,
    installer,
    originStore,
    blocklistService
  );

  return {
    dir,
    pluginsRoot,
    plugins,
    installer,
    service,
    updates,
    originStore,
    records: () => records,
    setRecordBuiltIn: (name: string) => {
      const record = records.find((entry) => entry.name === name);

      if (record) {
        record.builtIn = true;
      }
    }
  };
}

/** Rewrites a marketplace's bundle to a new version, as a publisher would. */
function publish(root: string, plugin: string, version: string) {
  write(
    join(root, 'plugins', plugin, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: plugin, version, description: `${plugin} plugin` })
  );
  write(
    join(root, 'plugins', plugin, 'skills', 'go', 'SKILL.md'),
    ['---', 'name: go', `description: Version ${version}.`, '---', `Body ${version}.`].join('\n')
  );
}

test('installing from a marketplace records where the bundle came from', (t) => {
  const { dir, service, originStore } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  const origin = originStore.get('alpha');
  assert.equal(origin?.marketplace, 'demo-market');
  assert.equal(origin?.entry, 'alpha');
  assert.equal(origin?.version, '1.0.0');
});

test('a newer version in the catalogue is offered, and applying it replaces the bundle', (t) => {
  const { dir, service, updates, plugins, pluginsRoot } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  assert.equal(updates.check()[0]?.status, 'up-to-date', 'nothing to do before the publisher moves');

  publish(root, 'alpha', '1.4.0');

  const [available] = updates.check();
  assert.equal(available?.status, 'update-available');
  assert.equal(available?.installed, '1.0.0');
  assert.equal(available?.available, '1.4.0');

  updates.update('alpha');
  plugins.invalidate();

  const installed = plugins.snapshot().plugins;
  assert.equal(installed[0]?.manifest.version, '1.4.0', 'the bundle on disk is the new one');
  assert.equal(installed.length, 1, 'and there is still only one of it');
  assert.match(
    readFileSync(join(pluginsRoot, 'alpha', 'skills', 'go', 'SKILL.md'), 'utf8'),
    /Body 1\.4\.0/,
    'its files were replaced, not merged'
  );
  assert.equal(updates.check()[0]?.status, 'up-to-date');
});

test('an older catalogue version is not offered as an update', (t) => {
  const { dir, service, updates } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '2.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  publish(root, 'alpha', '1.9.0');

  assert.equal(updates.check()[0]?.status, 'up-to-date', 'a downgrade is not an update');
});

test('a plugin installed from a folder says it cannot be checked', (t) => {
  const { dir, installer, updates } = setup(t);
  const bundle = join(dir, 'src', 'sideloaded');
  write(
    join(bundle, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'sideloaded', version: '1.0.0', description: 'A folder install' })
  );
  write(
    join(bundle, 'skills', 'go', 'SKILL.md'),
    ['---', 'name: go', 'description: Do it.', '---', 'Body.'].join('\n')
  );

  assert.equal(installer.install(bundle).ok, true);

  const [entry] = updates.check();
  assert.equal(entry?.status, 'unknown');
  assert.equal(entry?.marketplace, null);
  assert.throws(() => updates.update('sideloaded'), /does not know where/);
});

test('a marketplace that has dropped the entry says so rather than staying silent', (t) => {
  const { dir, service, updates } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  write(
    join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({ name: 'demo-market', plugins: [] })
  );

  const [entry] = updates.check();
  assert.equal(entry?.status, 'unavailable');
  assert.match(entry?.detail ?? '', /no longer listed/);
  assert.throws(() => updates.update('alpha'), /no longer listed/);
});

test('an entry that now ships a different plugin is refused rather than installed beside it', (t) => {
  const { dir, service, updates, plugins } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  // The entry keeps its catalogue name, but the bundle behind it is renamed.
  // Without the name check this installs a second plugin and leaves the first.
  write(
    join(root, 'plugins', 'alpha', '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'something-else', version: '2.0.0', description: 'Not alpha' })
  );

  assert.throws(() => updates.update('alpha'), /now called "something-else"/);
  plugins.invalidate();
  assert.deepEqual(
    plugins.snapshot().plugins.map((plugin) => plugin.manifest.name),
    ['alpha'],
    'the installed plugin is untouched'
  );
});

test('a failed update leaves the installed bundle in place', (t) => {
  const { dir, service, updates, plugins } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  // A manifest that will not parse: the staged copy is rejected before it can
  // replace anything.
  write(join(root, 'plugins', 'alpha', '.codex-plugin', 'plugin.json'), '{ not json');

  assert.throws(() => updates.update('alpha'));
  plugins.invalidate();

  const installed = plugins.snapshot().plugins;
  assert.equal(installed.length, 1, 'the working copy survives a failed update');
  assert.equal(installed[0]?.manifest.version, '1.0.0');
});

test('uninstalling forgets where the plugin came from', (t) => {
  const { dir, service, installer, originStore } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');
  assert.ok(originStore.get('alpha'));

  installer.uninstall('alpha');

  assert.equal(
    originStore.get('alpha'),
    null,
    'or a later folder install would inherit this marketplace'
  );
});

/** Repoints a catalogue entry at a git source pinned to `sha`, keeping its name. */
function pinCatalogueTo(root: string, name: string, plugin: string, version: string, sha: string) {
  write(
    join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name,
      plugins: [
        {
          name: plugin,
          version,
          source: { source: 'url', url: 'https://example.com/acme/alpha.git', sha }
        }
      ]
    })
  );
}

test('the same version at a different commit is reported, not silently called up-to-date', (t) => {
  const { dir, service, updates, originStore } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  // The install came from a local source, so it carries no commit. Give it the
  // one it would have had from a pinned git entry.
  originStore.record('alpha', {
    marketplace: 'demo-market',
    entry: 'alpha',
    version: '1.0.0',
    sha: 'a'.repeat(40),
    url: null,
    ref: null,
    subdir: null
  });

  // Same version, different commit: either the publisher shipped new code
  // without bumping, or the tag was moved under it. Atlas cannot tell those
  // apart — but reporting it as up-to-date meant nobody got the chance to look.
  pinCatalogueTo(root, 'demo-market', 'alpha', '1.0.0', 'b'.repeat(40));

  const [entry] = updates.check();

  assert.equal(entry?.status, 'republished');
  assert.equal(entry?.installed, '1.0.0');
  assert.equal(entry?.available, '1.0.0');
  assert.equal(entry?.installedSha, 'a'.repeat(40));
  assert.equal(entry?.availableSha, 'b'.repeat(40));
  assert.match(entry?.detail ?? '', /republished at a different commit/);
});

test('the same version at the same commit is still up-to-date', (t) => {
  const { dir, service, updates, originStore } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  originStore.record('alpha', {
    marketplace: 'demo-market',
    entry: 'alpha',
    version: '1.0.0',
    sha: 'a'.repeat(40),
    url: null,
    ref: null,
    subdir: null
  });

  pinCatalogueTo(root, 'demo-market', 'alpha', '1.0.0', 'a'.repeat(40));

  // The check must not cry wolf, or the one time it fires nobody will read it.
  assert.equal(updates.check()[0]?.status, 'up-to-date');
});

test('a newer version at a different commit is an ordinary update, not a republish', (t) => {
  const { dir, service, updates, originStore } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', 'alpha', '1.0.0');

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });
  service.install('demo-market', 'alpha');

  originStore.record('alpha', {
    marketplace: 'demo-market',
    entry: 'alpha',
    version: '1.0.0',
    sha: 'a'.repeat(40),
    url: null,
    ref: null,
    subdir: null
  });

  pinCatalogueTo(root, 'demo-market', 'alpha', '2.0.0', 'b'.repeat(40));

  const [entry] = updates.check();
  assert.equal(entry?.status, 'update-available', 'a bumped version moving commits is expected');
  assert.equal(entry?.availableSha, 'b'.repeat(40));
});
