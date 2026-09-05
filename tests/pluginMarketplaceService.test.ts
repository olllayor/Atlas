import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { MarketplaceRecord } from '../src/main/plugins/MarketplaceRegistry.js';
import { MarketplaceRegistry, fetchRepository } from '../src/main/plugins/MarketplaceRegistry.js';
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

  return { dir, pluginsRoot, plugins, marketplaces, installer, service, records: () => records };
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

test('checkouts nothing refers to any more are collected', (t) => {
  const { dir, marketplaces } = setup(t);
  const checkouts = join(dir, 'checkouts');

  // What a machine accumulates: a clone for a marketplace the user removed, and
  // a temporary from an install that never finished. Neither was ever swept.
  mkdirSync(join(checkouts, 'long-gone-market', '.git'), { recursive: true });
  mkdirSync(join(checkouts, 'fetch-abc123'), { recursive: true });

  assert.equal(marketplaces.sweepCheckouts(), 2);
  assert.deepEqual(readdirSync(checkouts), []);
});

test('the checkout of a marketplace still added is kept', (t) => {
  const { dir, marketplaces, records } = setup(t);
  const checkouts = join(dir, 'checkouts');

  records().push({ name: 'live-market', source: { kind: 'git', url: 'https://example.test/r.git', ref: null } });
  mkdirSync(join(checkouts, 'live-market'), { recursive: true });
  mkdirSync(join(checkouts, 'dead-market'), { recursive: true });

  assert.equal(marketplaces.sweepCheckouts(), 1);
  assert.deepEqual(readdirSync(checkouts), ['live-market']);
});

test('sweeping when nothing has ever been checked out is a no-op', (t) => {
  const { marketplaces } = setup(t);
  assert.equal(marketplaces.sweepCheckouts(), 0);
});

/** A git repo holding a one-plugin marketplace, committed so it can be cloned. */
function gitMarketplaceFixture(root: string, version: string) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, '.agents', 'plugins'), { recursive: true });
  mkdirSync(join(root, 'plugins', 'solo', '.codex-plugin'), { recursive: true });
  write(
    join(root, 'plugins', 'solo', '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'solo', version, description: 'd' })
  );
  write(join(root, 'plugins', 'solo', 'skills', 'go', 'SKILL.md'), ['---', 'name: go', 'description: Do the thing.', '---', 'Body.'].join('\n'));
  write(
    join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'catalogue',
      plugins: [{ name: 'solo', version, source: { source: 'local', path: './plugins/solo' } }]
    })
  );

  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', version],
    { cwd: root, stdio: 'pipe' }
  );
}

test('a built-in git marketplace is cached between resolves; a user one is not', (t) => {
  const { dir, marketplaces } = setup(t);
  const repoDir = join(dir, 'fixture-repo');
  gitMarketplaceFixture(repoDir, '1.0.0');

  const builtIn = {
    name: 'openai-curated',
    source: { kind: 'git' as const, url: repoDir, ref: null },
    builtIn: true
  };

  const first = marketplaces.resolve(builtIn);
  assert.equal(first.error, null);
  assert.equal(first.catalog?.entries[0]?.version, '1.0.0');

  // The remote moves. A cached built-in keeps serving what it cloned; a
  // user-added marketplace over the same URL sees the move, because its
  // freshness model is re-clone-on-every-resolve.
  gitMarketplaceFixture(repoDir, '2.0.0');

  const cached = marketplaces.resolve(builtIn);
  assert.equal(catalogVersion(cached), '1.0.0', 'built-in serves its checkout');

  const live = marketplaces.resolve({ name: 'live-market', source: { kind: 'git', url: repoDir, ref: null } });
  assert.equal(catalogVersion(live), '2.0.0', 'user marketplace re-clones');
});

function catalogVersion(resolved: ReturnType<MarketplaceRegistry['resolve']>): string | null {
  return resolved.catalog?.entries[0]?.version ?? null;
}

test('expiring built-in checkouts removes only those', (t) => {
  const { dir, marketplaces, records } = setup(t);
  const checkouts = join(dir, 'checkouts');

  records().push({ name: 'live-market', source: { kind: 'git', url: 'https://example.test/r.git', ref: null } });
  const lister = () => [
    { name: 'openai-curated', source: { kind: 'git' as const, url: 'https://example.test/o.git', ref: null }, builtIn: true },
    ...records()
  ];
  const scoped = new MarketplaceRegistry(lister, checkouts);

  mkdirSync(join(checkouts, 'openai-curated', '.git'), { recursive: true });
  mkdirSync(join(checkouts, 'live-market', '.git'), { recursive: true });

  assert.equal(scoped.expireBuiltInCheckouts(), 1);
  assert.deepEqual(readdirSync(checkouts), ['live-market']);
  assert.equal(scoped.expireBuiltInCheckouts(), 0, 'already gone');
});

test('a startup resolve skips a built-in git marketplace with no checkout', (t) => {
  const { dir, marketplaces, records } = setup(t);

  records().push({ name: 'live-market', source: { kind: 'git', url: 'https://example.test/r.git', ref: null } });
  mkdirSync(join(dir, 'checkouts', 'live-market', '.git'), { recursive: true });
  // The built-in has never been cloned: resolving it would be the 77 MB first
  // fetch, and startup must not pay that.
  const lister = () => [
    { name: 'openai-curated', source: { kind: 'git' as const, url: 'https://example.test/o.git', ref: null }, builtIn: true },
    ...records()
  ];
  const scoped = new MarketplaceRegistry(lister, join(dir, 'checkouts'));

  const resolved = scoped.resolveAvailable();
  assert.deepEqual(resolved.map((entry) => entry.record.name), ['live-market']);
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

test('a connector-only entry is refused at install, not just in its card', (t) => {
  // The card's judgement cannot see a git entry's bundle before it is fetched,
  // so the install itself must carry the refusal — the button being disabled
  // is presentation, and presentation is exactly what a service caller skips.
  const { dir, service, plugins } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha']);

  write(
    join(root, 'plugins', 'connector-only', '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'connector-only', version: '1.0.0', description: 'Connector' })
  );
  write(join(root, 'plugins', 'connector-only', '.app.json'), JSON.stringify({ apps: {} }));
  write(
    join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'demo-market',
      plugins: [
        { name: 'alpha', source: { source: 'local', path: './plugins/alpha' } },
        { name: 'connector-only', source: { source: 'local', path: './plugins/connector-only' } }
      ]
    })
  );

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });

  assert.throws(() => service.install('demo-market', 'connector-only'), /no skills or tools/);
  const snapshot = plugins.snapshot();
  assert.equal(snapshot.plugins.length + snapshot.disabled.length, 0, 'nothing landed');
});

test('what the app ships installs itself, once, and only from a built-in source', (t) => {
  const { dir, service, plugins, records } = setup(t);

  const shipped = marketplaceDir(dir, 'shipped', ['bundled']);
  write(
    join(shipped, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'shipped',
      plugins: [
        {
          name: 'bundled',
          source: { source: 'local', path: './plugins/bundled' },
          policy: { installation: 'INSTALLED_BY_DEFAULT' }
        }
      ]
    })
  );

  const pushy = marketplaceDir(dir, 'pushy-market', ['pushy']);
  write(
    join(pushy, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'pushy-market',
      plugins: [
        {
          name: 'pushy',
          source: { source: 'local', path: './plugins/pushy' },
          policy: { installation: 'INSTALLED_BY_DEFAULT' }
        }
      ]
    })
  );

  service.add({ name: 'shipped', source: { kind: 'path', path: shipped } });
  service.add({ name: 'pushy-market', source: { kind: 'path', path: pushy } });
  // Only the first is something Atlas ships.
  records()[0]!.builtIn = true;

  service.installDefaults();
  plugins.invalidate();

  assert.deepEqual(
    plugins.snapshot().plugins.map((plugin) => plugin.manifest.name),
    ['bundled'],
    'a third-party catalogue cannot ask to be installed without being asked'
  );

  // A second launch must not reinstall, and must not resurrect a removal.
  service.installDefaults();
  plugins.invalidate();
  assert.equal(plugins.snapshot().plugins.length, 1);
});

test('a catalogue at Atlas\u2019s own location wins over one written for another agent', (t) => {
  const { dir, service } = setup(t);
  const root = marketplaceDir(dir, 'demo-market', ['alpha']);

  // The same repository carrying two catalogues is real — one surveyed checkout
  // ships both. Atlas reads its own first so a bundle can tailor what it offers
  // here without changing what it offers elsewhere.
  write(
    join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'demo-market',
      plugins: [{ name: 'for-someone-else', source: { source: 'local', path: './plugins/alpha' } }]
    })
  );
  write(
    join(root, '.atlas', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'demo-market',
      plugins: [{ name: 'for-atlas', source: { source: 'local', path: './plugins/alpha' } }]
    })
  );

  service.add({ name: 'demo-market', source: { kind: 'path', path: root } });

  assert.deepEqual(
    service.view().marketplaces[0]?.entries.map((entry) => entry.name),
    ['for-atlas']
  );
});

test('a checkout under a symlinked temp root still resolves its subdirectory', (t) => {
  // Regression. `containedPath` compared a realpath-resolved candidate against
  // an *unresolved* root, and on macOS `/var` is a symlink to `/private/var` —
  // so a git entry with a `subdir` refused to install with "points outside its
  // marketplace" for a path that had never left it. Every checkout lives under
  // a temporary directory, so this was every subdir entry on that platform.
  const dir = mkdtempSync(join(tmpdir(), 'atlas-contained-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'plugins', 'demo'), { recursive: true });
  writeFileSync(
    join(repo, 'plugins', 'demo', 'plugin.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0', description: 'd' })
  );
  mkdirSync(join(repo, 'plugins', 'demo', 'skills', 'greet'), { recursive: true });
  writeFileSync(
    join(repo, 'plugins', 'demo', 'skills', 'greet', 'SKILL.md'),
    ['---', 'name: greet', 'description: Say hello.', '---', 'Body.'].join('\n')
  );

  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init'],
    { cwd: repo, stdio: 'pipe' }
  );

  const fetched = fetchRepository(join(dir, 'checkouts'), {
    url: repo,
    ref: null,
    subdir: 'plugins/demo'
  });

  try {
    assert.ok(fetched.path.endsWith(join('plugins', 'demo')), fetched.path);
    // The resolved commit is what makes a URL install provenance-bearing.
    assert.match(fetched.sha ?? '', /^[0-9a-f]{40}$/);
  } finally {
    rmSync(fetched.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Commit changed between check and install
 * ------------------------------------------------------------------ */

/** A bare-enough local git repo whose HEAD `write()` moves. */
function gitFixture(root: string, version: string) {
  mkdirSync(join(root, 'skills', 'greet'), { recursive: true });
  write(join(root, 'plugin.json'), JSON.stringify({ name: 'moving-target', version, description: 'd' }));
  write(
    join(root, 'skills', 'greet', 'SKILL.md'),
    ['---', 'name: greet', `description: Version ${version}.`, '---', `Body ${version}.`].join('\n')
  );

  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', version],
    { cwd: root, stdio: 'pipe' }
  );

  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
}

test('a commit landing between preview and install is what gets installed, not what was previewed', (t) => {
  // The scenario the acceptance criteria name: the user reviews a plugin's
  // capabilities, and — before they press Install — the publisher pushes a
  // new commit. `previewUrl` and `installFromUrl` each call `fetchRepository`
  // independently rather than one reusing the other's checkout, precisely so
  // installing cannot silently reuse bytes a *different* fetch reviewed.
  //
  // Driven at the `fetchRepository` layer rather than through
  // `previewUrl`/`installFromUrl` themselves: those validate the URL as
  // `https://` first (correctly — a local path must never be readable through
  // the paste-a-link surface), which a filesystem fixture cannot satisfy. This
  // exercises the exact sequence both methods run once past that check.
  const { pluginsRoot, plugins, marketplaces, installer } = setup(t);
  const repoDir = mkdtempSync(join(tmpdir(), 'atlas-race-repo-'));
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));

  const firstSha = gitFixture(repoDir, '1.0.0');

  const previewed = fetchRepository(marketplaces.checkoutDirectory, { url: repoDir, ref: null, subdir: null });
  assert.equal(previewed.sha, firstSha);
  rmSync(previewed.root, { recursive: true, force: true }); // previewUrl discards its checkout

  // The publisher moves HEAD before Install is pressed.
  const secondSha = gitFixture(repoDir, '2.0.0');
  assert.notEqual(secondSha, firstSha);

  const installFetch = fetchRepository(marketplaces.checkoutDirectory, { url: repoDir, ref: null, subdir: null });

  try {
    assert.equal(installFetch.sha, secondSha, 'install re-fetched HEAD rather than reusing the preview');

    const result = installer.install(installFetch.path, {
      origin: { marketplace: null, entry: null, sha: installFetch.sha, url: repoDir, ref: null, subdir: null, connectors: null }
    });

    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(result.ok && result.version, '2.0.0');
  } finally {
    rmSync(installFetch.root, { recursive: true, force: true });
  }

  plugins.invalidate();
  const [onDisk] = plugins.snapshot().plugins;
  assert.equal(onDisk?.manifest.version, '2.0.0');
  assert.match(
    readFileSync(join(pluginsRoot, 'moving-target', 'skills', 'greet', 'SKILL.md'), 'utf8'),
    /Body 2\.0\.0/
  );
});

test('two independent fetches of a moving repository each see their own HEAD', (t) => {
  // The other half of the same property, without an install: neither fetch
  // is cached, so asking twice always answers against the world as it is at
  // that moment.
  const { marketplaces } = setup(t);
  const repoDir = mkdtempSync(join(tmpdir(), 'atlas-race-repo2-'));
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));

  gitFixture(repoDir, '1.0.0');
  const first = fetchRepository(marketplaces.checkoutDirectory, { url: repoDir, ref: null, subdir: null });
  rmSync(first.root, { recursive: true, force: true });

  gitFixture(repoDir, '1.1.0');
  const second = fetchRepository(marketplaces.checkoutDirectory, { url: repoDir, ref: null, subdir: null });
  rmSync(second.root, { recursive: true, force: true });

  assert.notEqual(first.sha, second.sha);
});
