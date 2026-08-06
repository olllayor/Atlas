import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadPlugin, readSkillBody } from '../src/main/plugins/PluginLoader.js';

type Ctx = { after: (fn: () => void) => void };

function workspace(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-plugin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFile(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** A bundle with a manifest under `convention` and the given skills. */
function bundle(
  root: string,
  options: {
    convention?: string;
    manifest?: Record<string, unknown>;
    skills?: Record<string, string>;
    skillsDir?: string;
  } = {}
) {
  const convention = options.convention ?? '.codex-plugin';
  writeFile(
    join(root, convention, 'plugin.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0', description: 'Demo', ...options.manifest })
  );

  for (const [name, text] of Object.entries(options.skills ?? {})) {
    writeFile(join(root, options.skillsDir ?? 'skills', name, 'SKILL.md'), text);
  }

  return root;
}

const SKILL = ['---', 'name: yeet', 'description: Ship it fast.', '---', '', '# Yeet', 'Body here.'].join('\n');

function loaded(root: string) {
  const result = loadPlugin(root);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.plugin : null!;
}

test('a bundle loads with its manifest and skill index', (t) => {
  const root = bundle(workspace(t), { skills: { yeet: SKILL } });
  const plugin = loaded(root);

  assert.equal(plugin.manifest.name, 'demo');
  assert.equal(plugin.skills.length, 1);
  assert.equal(plugin.skills[0]?.qualifiedName, 'demo:yeet');
  assert.equal(plugin.skills[0]?.description, 'Ship it fast.');
  assert.deepEqual(plugin.warnings, []);
});

test('every vendor manifest convention loads', (t) => {
  for (const convention of ['.atlas-plugin', '.plugin', '.codex-plugin', '.claude-plugin', '.cursor-plugin', '.kimi-plugin']) {
    const root = bundle(join(workspace(t), convention.slice(1)), { convention });
    assert.equal(loadPlugin(root).ok, true, convention);
  }
});

test('a directory with no manifest is refused rather than treated as empty', (t) => {
  const root = workspace(t);
  mkdirSync(join(root, 'skills', 'yeet'), { recursive: true });

  const result = loadPlugin(root);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /manifest/i);
});

test('a bundle that does not exist fails without throwing', () => {
  const result = loadPlugin('/atlas-definitely-not-a-real-directory');
  assert.equal(result.ok, false);
});

test('an invalid manifest fails the plugin instead of half-loading it', (t) => {
  const root = workspace(t);
  writeFile(join(root, '.codex-plugin', 'plugin.json'), '{ not json');

  assert.equal(loadPlugin(root).ok, false);
});

test('the index carries no skill bodies', (t) => {
  const body = 'X'.repeat(50_000);
  const root = bundle(workspace(t), {
    skills: { big: ['---', 'name: big', 'description: A big one.', '---', body].join('\n') }
  });

  const plugin = loaded(root);
  const serialized = JSON.stringify(plugin.skills);

  assert.equal(plugin.skills.length, 1);
  assert.ok(serialized.length < 1_000, 'an index entry must not carry the body');
  assert.doesNotMatch(serialized, /XXXX/, 'the body must not appear in the index');
});

test('a skill body is read on demand, and only then', (t) => {
  const root = bundle(workspace(t), { skills: { yeet: SKILL } });
  const plugin = loaded(root);

  const body = readSkillBody(plugin.skills[0]!);
  assert.match(body ?? '', /# Yeet/);
  assert.doesNotMatch(body ?? '', /description:/, 'frontmatter is not part of the body');
});

test('a declared skills directory is scanned in addition to the conventional one', (t) => {
  const root = workspace(t);
  bundle(root, { manifest: { skills: './extra/' }, skills: { yeet: SKILL } });
  writeFile(
    join(root, 'extra', 'other', 'SKILL.md'),
    ['---', 'name: other', 'description: Another one.', '---', 'body'].join('\n')
  );

  const names = loaded(root).skills.map((skill) => skill.name).sort();
  assert.deepEqual(names, ['other', 'yeet'], 'a declared path supplements, it does not replace');
});

test('a skills directory symlinked outside the bundle is not followed', (t) => {
  const dir = workspace(t);
  const outside = join(dir, 'outside');
  writeFile(
    join(outside, 'evil', 'SKILL.md'),
    ['---', 'name: evil', 'description: Should never load.', '---', 'body'].join('\n')
  );

  const root = join(dir, 'plugin');
  bundle(root);
  symlinkSync(outside, join(root, 'skills'));

  assert.deepEqual(loaded(root).skills, [], 'a symlinked escape must contribute nothing');
});

test('a symlinked skill directory inside the bundle is also not followed', (t) => {
  const root = workspace(t);
  bundle(root, { skills: { real: SKILL } });
  symlinkSync(join(root, 'skills', 'real'), join(root, 'skills', 'linked'));

  // Not a containment question — the same file would just be indexed twice
  // under two names, which is noise the model pays for.
  assert.equal(loaded(root).skills.length, 1);
});

test('one malformed skill does not cost the bundle its other skills', (t) => {
  const root = bundle(workspace(t), {
    skills: {
      good: SKILL,
      nameless: ['---', 'description: No name.', '---', 'body'].join('\n'),
      raw: '# No frontmatter at all'
    }
  });

  const plugin = loaded(root);
  assert.deepEqual(plugin.skills.map((skill) => skill.name), ['yeet']);
  assert.equal(plugin.warnings.length, 2, 'each skipped skill is reported');
});

test('two skills declaring the same name keep the first and say so', (t) => {
  const root = workspace(t);
  bundle(root, { skills: { a: SKILL, b: SKILL } });

  const plugin = loaded(root);
  assert.equal(plugin.skills.length, 1);
  assert.match(plugin.warnings.join(' '), /second skill named "yeet"/);
});

test('a missing declared skills path warns, a missing default one does not', (t) => {
  const bare = loaded(bundle(workspace(t)));
  assert.deepEqual(bare.warnings, [], 'shipping no skills is not a problem');

  const declared = loaded(bundle(workspace(t), { manifest: { skills: './nope/' } }));
  assert.match(declared.warnings.join(' '), /nope/);
});

test('implicit-invocation opt-out survives into the index', (t) => {
  const root = bundle(workspace(t), {
    skills: {
      quiet: ['---', 'name: quiet', 'description: d', 'disable-model-invocation: true', '---', 'b'].join('\n')
    }
  });

  assert.equal(loaded(root).skills[0]?.implicitInvocation, false);
});
