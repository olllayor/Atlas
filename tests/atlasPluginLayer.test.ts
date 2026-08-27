import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadPlugin } from '../src/main/plugins/PluginLoader.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { SkillsService } from '../src/main/plugins/SkillsService.js';
import { parsePluginManifest, satisfiesMinVersion } from '../src/shared/plugins.js';

type Ctx = { after: (fn: () => void) => void };

function workspace(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-layer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function bundle(root: string, name: string, atlas?: Record<string, unknown>) {
  write(
    join(root, name, '.atlas-plugin', 'plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      description: `${name} plugin`,
      ...(atlas ? { atlas } : {})
    })
  );
  write(
    join(root, name, 'skills', 'go', 'SKILL.md'),
    ['---', 'name: go', 'description: Do the thing.', '---', 'Body.'].join('\n')
  );
  return join(root, name);
}

test('a bundle that declares nothing keeps every default', () => {
  const result = parsePluginManifest(
    JSON.stringify({ name: 'plain', version: '1.0.0', description: 'd' })
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.manifest.atlas : null, {
    workspaceModes: [],
    requiresProject: false,
    minAppVersion: null
  });
});

test('the atlas block is read, and junk inside it is discarded rather than trusted', () => {
  const parsed = parsePluginManifest(
    JSON.stringify({
      name: 'p',
      version: '1.0.0',
      description: 'd',
      atlas: {
        workspaceModes: ['code', 'not-a-mode', 7],
        requiresProject: true,
        minAppVersion: '2.0.0'
      }
    })
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.deepEqual(parsed.manifest.atlas.workspaceModes, ['code'], 'unknown modes are dropped');
  assert.equal(parsed.manifest.atlas.requiresProject, true);
  assert.equal(parsed.manifest.atlas.minAppVersion, '2.0.0');
  assert.equal(parsed.manifest.unknown.atlas, undefined, 'atlas is modelled, not passed through');
});

test('version comparison orders releases and never refuses over nonsense', () => {
  assert.equal(satisfiesMinVersion('1.2.0', null), true, 'no floor is always satisfied');
  assert.equal(satisfiesMinVersion('1.2.0', '1.2.0'), true);
  assert.equal(satisfiesMinVersion('1.2.1', '1.2.0'), true);
  assert.equal(satisfiesMinVersion('1.10.0', '1.9.0'), true, 'segments compare numerically');
  assert.equal(satisfiesMinVersion('2.0.0', '10.0.0'), false);
  assert.equal(satisfiesMinVersion('0.1.14', '0.2.0'), false);
  assert.equal(satisfiesMinVersion('1.2.0-beta.1', '1.2.0'), true, 'prerelease tags are ignored');
  // A floor nobody can parse must not cost a working bundle its install.
  assert.equal(satisfiesMinVersion('1.0.0', 'whenever'), true);
});

test('a bundle needing a newer Atlas is refused with a reason, not half-loaded', (t) => {
  const dir = workspace(t);
  const root = bundle(dir, 'future', { minAppVersion: '99.0.0' });

  const refused = loadPlugin(root, '0.1.14');
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.error, /needs Atlas 99\.0\.0 or newer/);

  // The same bundle on a new enough build loads normally.
  assert.equal(loadPlugin(root, '99.0.0').ok, true);
  // And a caller that does not know the version does not get to guess.
  assert.equal(loadPlugin(root).ok, true);
});

test('a code-only plugin is withheld from a work session', (t) => {
  const dir = workspace(t);
  bundle(dir, 'coder', { workspaceModes: ['code'] });
  bundle(dir, 'anywhere');

  const skills = new SkillsService(new PluginRegistry({ root: dir }));

  assert.deepEqual(
    skills.applicableSkills({ mode: 'code', hasProject: true }).map((skill) => skill.pluginName),
    ['anywhere', 'coder']
  );
  assert.deepEqual(
    skills.applicableSkills({ mode: 'work', hasProject: true }).map((skill) => skill.pluginName),
    ['anywhere'],
    'a mode it does not claim costs no tokens at all'
  );
});

test('a plugin that needs a project is withheld when none is attached', (t) => {
  const dir = workspace(t);
  bundle(dir, 'repo-tools', { requiresProject: true });
  bundle(dir, 'anywhere');

  const skills = new SkillsService(new PluginRegistry({ root: dir }));

  assert.equal(skills.applicableSkills({ mode: 'code', hasProject: true }).length, 2);
  assert.deepEqual(
    skills.applicableSkills({ mode: 'code', hasProject: false }).map((skill) => skill.pluginName),
    ['anywhere'],
    'offering a skill with nothing to act on is worse than not offering it'
  );
});

test('the prompt index reflects the session it is written for', (t) => {
  const dir = workspace(t);
  bundle(dir, 'coder', { workspaceModes: ['code'] });

  const skills = new SkillsService(new PluginRegistry({ root: dir }));

  assert.match(skills.describeForPrompt({ mode: 'code', hasProject: true }) ?? '', /coder:go/);
  assert.equal(
    skills.describeForPrompt({ mode: 'work', hasProject: true }),
    null,
    'nothing applicable means no block at all, not an empty one'
  );
});

test('a caller with no session sees everything, so the meter cannot disagree', (t) => {
  const dir = workspace(t);
  bundle(dir, 'coder', { workspaceModes: ['code'] });
  bundle(dir, 'needs-project', { requiresProject: true });

  const skills = new SkillsService(new PluginRegistry({ root: dir }));

  assert.equal(skills.applicableSkills().length, 2);
  assert.equal(skills.snapshot().skills.length, 2, 'and find() still resolves either by name');
});

test('a declared skill stays loadable by name even outside its mode', (t) => {
  const dir = workspace(t);
  bundle(dir, 'coder', { workspaceModes: ['code'] });

  const skills = new SkillsService(new PluginRegistry({ root: dir }));

  // Withholding it from the index is about cost, not permission: a user who
  // names it should still get it.
  assert.ok(skills.find('coder:go'));
  assert.match(skills.read('coder:go'), /Body\./);
});

test('the beta switch off makes the skills service forget the directory', (t) => {
  const dir = workspace(t);
  bundle(dir, 'coder');
  bundle(dir, 'anywhere');

  let enabled = false;
  const skills = new SkillsService(new PluginRegistry({ root: dir }), () => enabled);

  assert.equal(skills.snapshot().plugins.length, 0);
  assert.equal(skills.snapshot().skills.length, 0);
  assert.equal(skills.find('coder:go'), null);
  assert.equal(skills.describeForPrompt(), null, 'no index reaches the prompt');

  // Live, not at construction: flipping the switch on is enough.
  enabled = true;
  assert.equal(skills.snapshot().skills.length, 2);
  assert.match(skills.describeForPrompt() ?? '', /coder:go/);
});
