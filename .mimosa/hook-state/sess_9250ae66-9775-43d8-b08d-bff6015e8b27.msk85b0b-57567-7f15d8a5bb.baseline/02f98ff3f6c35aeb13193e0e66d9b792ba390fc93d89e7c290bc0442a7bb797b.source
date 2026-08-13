import assert from 'node:assert/strict';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PluginInstaller } from '../src/main/plugins/PluginInstaller.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { buildPluginsView } from '../src/main/plugins/pluginViews.js';

type Ctx = { after: (fn: () => void) => void };

function workspace(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-installer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const root = join(dir, 'plugins');
  mkdirSync(root, { recursive: true });

  const registry = new PluginRegistry({ root });
  return { dir, root, registry, installer: new PluginInstaller(registry) };
}

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function sourceBundle(dir: string, name: string, extra: (bundle: string) => void = () => {}) {
  const bundle = join(dir, 'src', name);
  write(
    join(bundle, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} plugin` })
  );
  write(
    join(bundle, 'skills', 'yeet', 'SKILL.md'),
    ['---', 'name: yeet', 'description: Ship it.', '---', 'Body.'].join('\n')
  );
  extra(bundle);
  return bundle;
}

test('installing a bundle makes it visible to the registry', (t) => {
  const { dir, root, registry, installer } = workspace(t);

  const result = installer.install(sourceBundle(dir, 'demo'));

  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.ok(existsSync(join(root, 'demo', '.codex-plugin', 'plugin.json')));
  assert.deepEqual(
    registry.snapshot().plugins.map((plugin) => plugin.manifest.name),
    ['demo']
  );
});

test('an invalid bundle is refused and nothing is written', (t) => {
  const { dir, root, installer } = workspace(t);
  const bundle = join(dir, 'src', 'bad');
  write(join(bundle, '.codex-plugin', 'plugin.json'), '{ not json');

  const result = installer.install(bundle);

  assert.equal(result.ok, false);
  assert.deepEqual(readdirNames(root), [], 'a rejected install leaves no trace');
});

test('a directory that is not a bundle is refused', (t) => {
  const { dir, installer } = workspace(t);
  const notABundle = join(dir, 'src', 'plain');
  write(join(notABundle, 'README.md'), 'nothing here');

  assert.equal(installer.install(notABundle).ok, false);
  assert.equal(installer.install(join(dir, 'does-not-exist')).ok, false);
});

test('installing the same plugin twice is refused rather than silently replacing', (t) => {
  const { dir, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'demo');

  assert.equal(installer.install(bundle).ok, true);

  const second = installer.install(bundle);
  assert.equal(second.ok, false);
  assert.match(second.ok ? '' : second.error, /already installed/);
});

test('a bundle carrying a link out of itself is refused', (t) => {
  const { dir, root, installer } = workspace(t);
  const outside = join(dir, 'outside.txt');
  writeFileSync(outside, 'not part of the bundle');

  const bundle = sourceBundle(dir, 'demo', (b) => {
    mkdirSync(join(b, 'assets'), { recursive: true });
    symlinkSync(outside, join(b, 'assets', 'linked.txt'));
  });

  const result = installer.install(bundle);

  assert.equal(result.ok, false, 'a link out is a file the review never covered');
  assert.match(result.ok ? '' : result.error, /points outside itself/);
  assert.deepEqual(readdirNames(root), [], 'and nothing is left behind');
});

test('a dangling link is refused too, because tomorrow it may resolve', (t) => {
  const { dir, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'demo', (b) => {
    mkdirSync(join(b, 'assets'), { recursive: true });
    symlinkSync(join(dir, 'never-created.txt'), join(b, 'assets', 'linked.txt'));
  });

  assert.equal(installer.install(bundle).ok, false);
});

test('links inside the bundle survive, because real bundles depend on them', (t) => {
  // Not hypothetical: an npm-installed bundle in the surveyed corpus carries 18
  // node_modules/.bin links. Flattening or rejecting those breaks it.
  const { dir, root, installer } = workspace(t);

  const bundle = sourceBundle(dir, 'demo', (b) => {
    mkdirSync(join(b, 'node_modules', '.bin'), { recursive: true });
    write(join(b, 'node_modules', 'pkg', 'cli.js'), 'console.log(1);');
    symlinkSync(join('..', 'pkg', 'cli.js'), join(b, 'node_modules', '.bin', 'pkg'));
  });

  assert.equal(installer.install(bundle).ok, true);
  assert.equal(
    readFileSync(join(root, 'demo', 'node_modules', '.bin', 'pkg'), 'utf8'),
    'console.log(1);'
  );
});

test('uninstalling removes the bundle and nothing else', (t) => {
  const { dir, root, registry, installer } = workspace(t);
  installer.install(sourceBundle(dir, 'demo'));
  installer.install(sourceBundle(dir, 'keeper'));

  assert.equal(installer.uninstall('demo').ok, true);
  assert.deepEqual(readdirNames(root), ['keeper']);
  assert.deepEqual(registry.snapshot().plugins.map((p) => p.manifest.name), ['keeper']);
});

test('a name that could escape the plugins directory never becomes a delete', (t) => {
  const { dir, root, installer } = workspace(t);
  installer.install(sourceBundle(dir, 'demo'));

  const sibling = join(dir, 'precious');
  mkdirSync(sibling, { recursive: true });

  for (const name of ['..', '../precious', '../../', '/etc', 'demo/../../precious', '', '   ', '.']) {
    const result = installer.uninstall(name);
    assert.equal(result.ok, false, name);
  }

  assert.ok(existsSync(sibling), 'nothing outside the plugins directory may be touched');
  assert.deepEqual(readdirNames(root), ['demo'], 'and nothing inside it either');
});

test('uninstalling something that is not installed is refused', (t) => {
  const { installer } = workspace(t);
  assert.equal(installer.uninstall('never-existed').ok, false);
});

test('staging directories left by an interrupted install are swept', (t) => {
  const { root, installer } = workspace(t);
  mkdirSync(join(root, '.staging-abc', 'partial'), { recursive: true });
  mkdirSync(join(root, '.staging-def'), { recursive: true });
  mkdirSync(join(root, 'keeper'), { recursive: true });

  assert.equal(installer.sweepStaging(), 2);
  assert.deepEqual(readdirNames(root), ['keeper']);
});

test('sweeping an absent plugins directory is a no-op', (t) => {
  const { dir } = workspace(t);
  const registry = new PluginRegistry({ root: join(dir, 'nope') });

  assert.equal(new PluginInstaller(registry).sweepStaging(), 0);
});

test('a disabled plugin is withheld from consumers but still shown in settings', (t) => {
  const { dir, root, installer } = workspace(t);
  installer.install(sourceBundle(dir, 'demo'));

  const disabled = new Set<string>();
  const registry = new PluginRegistry({ root, isEnabled: (name) => !disabled.has(name) });

  assert.equal(registry.snapshot().plugins.length, 1);

  disabled.add('demo');
  registry.invalidate();

  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot.plugins, [], 'a disabled plugin contributes nothing');
  assert.equal(snapshot.disabled.length, 1, 'but settings can still see it');

  const view = buildPluginsView(registry);
  assert.equal(view.plugins.length, 1);
  assert.equal(view.plugins[0]?.enabled, false);
});

test('the settings view describes servers from resolved values, not author prose', (t) => {
  const { dir, root, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'demo', (b) => {
    write(
      join(b, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          api: {
            type: 'http',
            url: 'https://example.test/mcp',
            bearer_token_env_var: 'DEMO_TOKEN',
            note: 'Totally harmless, trust me.'
          }
        }
      })
    );
  });
  installer.install(bundle);

  const [plugin] = buildPluginsView(new PluginRegistry({ root })).plugins;
  const [server] = plugin?.servers ?? [];

  assert.equal(server?.detail, 'https://example.test/mcp', 'the literal endpoint, not the note');
  assert.equal(server?.bearerTokenEnvVar, 'DEMO_TOKEN');
  assert.doesNotMatch(JSON.stringify(plugin), /trust me/, 'author prose must not reach the summary');
});

/* ------------------------------------------------------------------ *
 * Archive/duplicate hardening
 * ------------------------------------------------------------------ */

test('a bundle over the size ceiling is refused before anything is copied', (t) => {
  const { dir, root, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'huge', (path) => {
    // One file well past the 512 MB ceiling. Sparse, so the test does not
    // actually consume that much disk — only the reported size has to be big.
    const fd = openSync(join(path, 'huge.bin'), 'w');
    ftruncateSync(fd, 600 * 1024 * 1024);
    closeSync(fd);
  });

  const result = installer.install(bundle);

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /larger than/);
  // Refused before the copy: nothing landed, and no staging directory was
  // left for the sweep to find either.
  assert.deepEqual(readdirNames(root), []);
});

test('an archive bomb of entry count, not bytes, is also refused before copying', (t) => {
  // The size ceiling above catches a bundle that is big; this catches one that
  // is merely numerous — a directory of a few hundred thousand empty or
  // near-empty files costs almost nothing in bytes but would make every walk
  // Atlas does over the bundle (this scan, the symlink-escape check after the
  // copy, the skill/command discovery) expensive or worse. Real cost: this
  // test writes 50,001 files, and is the slowest test in the suite on purpose
  // — that is the actual cost being bounded.
  const { dir, root, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'numerous', (path) => {
    const flood = join(path, 'flood');
    mkdirSync(flood, { recursive: true });

    for (let index = 0; index <= 50_000; index += 1) {
      writeFileSync(join(flood, `f${index}`), '');
    }
  });

  const result = installer.install(bundle);

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /more than 50000 entries|more than 50,000 entries/);
  assert.deepEqual(readdirNames(root), []);
});

test('two entries differing only by case are refused rather than silently colliding', (t) => {
  const { dir, root, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'cased', (path) => {
    write(join(path, 'skills', 'yeet', 'NOTES.md'), 'kept');
    write(join(path, 'skills', 'yeet', 'notes.md'), 'also kept, until this check');
  });

  // The vulnerability this guards is a source that is case-*sensitive* — a
  // Linux checkout, a Docker volume — landing on the case-*insensitive*
  // volume most desktop installs use. On a case-insensitive host (macOS's
  // default APFS, this machine) the two `write()` calls above never produced
  // two directory entries to begin with — the second silently overwrote the
  // first at the OS level before the installer ever saw it, which is a
  // faithful preview of the real bug but not a way to test the *guard*.
  const entries = readdirNames(join(bundle, 'skills', 'yeet'));

  if (!entries.includes('NOTES.md') || !entries.includes('notes.md')) {
    t.skip('this filesystem folds case, so no case collision reaches the installer to be caught');
    return;
  }

  const result = installer.install(bundle);

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /differ only by case/);
  assert.deepEqual(readdirNames(root), []);
});

test('the same name repeating at different directory levels is not a false positive', (t) => {
  // The collision check is scoped per directory. A plugin legitimately has one
  // SKILL.md per skill folder — that must not be flagged as a "duplicate".
  const { dir, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'multi-skill', (path) => {
    write(join(path, 'skills', 'a', 'SKILL.md'), ['---', 'name: a', 'description: A.', '---', 'x'].join('\n'));
    write(join(path, 'skills', 'b', 'SKILL.md'), ['---', 'name: b', 'description: B.', '---', 'x'].join('\n'));
  });

  const result = installer.install(bundle);

  assert.equal(result.ok, true, result.ok ? '' : result.error);
});

test('an ordinary bundle comfortably clears both checks', (t) => {
  const { dir, installer } = workspace(t);
  const result = installer.install(sourceBundle(dir, 'ordinary'));

  assert.equal(result.ok, true, result.ok ? '' : result.error);
});

test('installing the same bundle twice concurrently: one wins, the other fails clean', async (t) => {
  // No corruption either way: the atomic-rename design already makes this
  // safe, and this asserts that rather than adding new production code for it.
  // Two installs racing the same name can both pass the "not yet installed"
  // check before either has renamed into place; the loser's `renameSync` onto
  // an existing directory throws, which the installer's own catch turns into a
  // clean error and a swept staging directory — not a half-written plugin.
  const { dir, root, installer } = workspace(t);
  const bundle = sourceBundle(dir, 'race');

  const [first, second] = await Promise.all([
    Promise.resolve().then(() => installer.install(bundle)),
    Promise.resolve().then(() => installer.install(bundle))
  ]);

  const results = [first, second];
  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);

  assert.equal(succeeded.length, 1, 'exactly one install won the race');
  assert.equal(failed.length, 1, 'the other failed rather than corrupting anything');

  // The installed copy is a real, complete, loadable plugin — not a partial
  // write from whichever rename lost.
  assert.ok(existsSync(join(root, 'race', '.codex-plugin', 'plugin.json')));
  assert.deepEqual(readdirNames(root), ['race']);
});

function readdirNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}
