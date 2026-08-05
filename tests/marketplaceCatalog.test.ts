import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARKETPLACE_CATALOG_PATHS,
  marketplaceEntryBlocker,
  parseMarketplaceCatalog
} from '../src/shared/marketplace.js';

function catalog(plugins: unknown[], extra: Record<string, unknown> = {}) {
  const result = parseMarketplaceCatalog(JSON.stringify({ name: 'demo-market', plugins, ...extra }));
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.catalog : null!;
}

function sourceOf(source: unknown) {
  return catalog([{ name: 'p', source }]).entries[0]?.source;
}

test('both catalogue conventions are probed, vendor-neutral first', () => {
  assert.deepEqual(
    [...MARKETPLACE_CATALOG_PATHS],
    ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json']
  );
});

test('a catalogue needs a usable name and a plugins array', () => {
  assert.equal(parseMarketplaceCatalog('{ not json').ok, false);
  assert.equal(parseMarketplaceCatalog('[]').ok, false);
  assert.equal(parseMarketplaceCatalog(JSON.stringify({ plugins: [] })).ok, false);
  assert.equal(parseMarketplaceCatalog(JSON.stringify({ name: 'has space', plugins: [] })).ok, false);
});

test('the four real-world source kinds all resolve', () => {
  // Verbatim shapes from the 664 catalogue entries on this machine.
  assert.deepEqual(sourceOf({ source: 'local', path: './plugins/linear' }), {
    kind: 'local',
    path: './plugins/linear'
  });

  assert.deepEqual(
    sourceOf({
      source: 'git-subdir',
      url: 'https://github.com/adobe/skills.git',
      path: 'plugins/creative-cloud/adobe-for-creativity',
      ref: 'main',
      sha: '17ef6fb53d2eb23158dec11823ff569258b7a26e'
    }),
    {
      kind: 'git',
      url: 'https://github.com/adobe/skills.git',
      subdir: 'plugins/creative-cloud/adobe-for-creativity',
      ref: 'main',
      sha: '17ef6fb53d2eb23158dec11823ff569258b7a26e'
    }
  );

  assert.deepEqual(
    sourceOf({
      source: 'github',
      repo: 'jfrog/claude-plugin',
      commit: '259c8e718266c16e99b4f30ae9b1ed0f9f00d98d',
      sha: '5525279d72af8e1982acfc8dabd1058d55b8b167'
    }),
    {
      kind: 'git',
      url: 'https://github.com/jfrog/claude-plugin.git',
      subdir: null,
      ref: null,
      // `commit` is the revision to fetch; the sibling `sha` identifies the
      // catalogue entry, not the code.
      sha: '259c8e718266c16e99b4f30ae9b1ed0f9f00d98d'
    }
  );
});

test('a relative "url" is the repo-is-the-plugin shorthand, not an address', () => {
  // Real catalogues ship `{"source": "url", "url": "./"}` and a bare `"./"`.
  assert.deepEqual(sourceOf({ source: 'url', url: './' }), { kind: 'local', path: './' });
  assert.deepEqual(sourceOf('./'), { kind: 'local', path: './' });
});

test('a source that could fetch over an unauthenticated channel is refused', () => {
  for (const source of [
    { source: 'git', url: 'http://example.com/repo.git' },
    { source: 'git', url: 'git://example.com/repo.git' },
    { source: 'git' },
    { source: 'github', repo: 'not-a-repo' },
    { source: 'github', repo: 'evil/../../x' },
    { source: 'nfs', path: '/mnt/x' },
    null
  ]) {
    assert.equal(sourceOf(source)?.kind, 'unsupported', JSON.stringify(source));
  }
});

test('a git source cannot escape its repository through the subdirectory', () => {
  assert.equal(
    sourceOf({ source: 'git-subdir', url: 'https://example.com/r.git', path: '../../etc' })?.kind,
    'unsupported'
  );
});

test('a sha that is not a git object name is discarded rather than passed along', () => {
  const source = sourceOf({
    source: 'git',
    url: 'https://example.com/r.git',
    sha: '$(rm -rf /)'
  });

  assert.equal(source?.kind, 'git');
  assert.equal(source?.kind === 'git' ? source.sha : 'x', null);
});

test('one malformed entry does not cost the catalogue its other plugins', () => {
  const parsed = catalog([
    { name: 'good', source: { source: 'local', path: './a' } },
    { name: 'has space', source: { source: 'local', path: './b' } },
    'not an object',
    { source: { source: 'local', path: './c' } },
    { name: 'good', source: { source: 'local', path: './dupe' } }
  ]);

  assert.deepEqual(parsed.entries.map((entry) => entry.name), ['good']);
});

test('policy defaults match what real catalogues rely on', () => {
  const [bare] = catalog([{ name: 'p', source: './' }]).entries;

  assert.equal(bare?.installPolicy, 'AVAILABLE');
  assert.equal(bare?.authPolicy, 'ON_INSTALL');
  assert.equal(bare?.strict, true, 'absent means strict');

  const [onUse] = catalog([
    { name: 'p', source: './', policy: { authentication: 'ON_USE', installation: 'NOT_AVAILABLE' } }
  ]).entries;

  assert.equal(onUse?.authPolicy, 'ON_USE', 'the token is ON_USE, not ON_FIRST_USE');
  assert.equal(onUse?.installPolicy, 'NOT_AVAILABLE');
});

test('an entry Atlas will not install says why', () => {
  const blocked = (entry: Record<string, unknown>) =>
    marketplaceEntryBlocker(catalog([{ name: 'p', source: './', ...entry }]).entries[0]!);

  assert.match(blocked({ policy: { installation: 'NOT_AVAILABLE' } }) ?? '', /unavailable/);
  // A `strict: false` bundle ships no manifest at all — the catalogue is the
  // only description of it, so nothing travels with the code it describes.
  assert.match(blocked({ strict: false }) ?? '', /no manifest of its own/);
  assert.match(blocked({ source: { source: 'nfs' } }) ?? '', /cannot fetch/);
  assert.equal(blocked({}), null);
});

test('a repository that is itself one plugin parses as a one-entry catalogue', () => {
  // Real shape, from an installed bundle describing itself.
  const result = parseMarketplaceCatalog(
    JSON.stringify({
      name: 'claude-session-driver',
      source: { source: 'local', path: '.' },
      description: 'Launch and monitor other sessions',
      version: '4.0.0',
      strict: true
    })
  );

  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.equal(result.ok ? result.catalog.entries.length : 0, 1);
  assert.equal(result.ok ? result.catalog.entries[0]?.name : '', 'claude-session-driver');
});

test('catalogue presentation metadata is read from both spellings', () => {
  const withInterface = catalog([], { interface: { displayName: 'Codex official' } });
  assert.equal(withInterface.displayName, 'Codex official');

  const withOwner = catalog([], { owner: { name: 'Jesse Vincent' }, description: 'Skills' });
  assert.equal(withOwner.owner, 'Jesse Vincent');
  assert.equal(withOwner.description, 'Skills');
});
