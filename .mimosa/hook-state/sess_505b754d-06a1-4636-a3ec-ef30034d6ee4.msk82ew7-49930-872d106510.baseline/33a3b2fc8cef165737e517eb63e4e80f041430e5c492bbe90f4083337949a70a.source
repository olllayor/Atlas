import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadPlugin, readCommandBody } from '../src/main/plugins/PluginLoader.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { buildCommandList } from '../src/main/plugins/pluginViews.js';
import {
  applyCommand,
  filterCommands,
  matchCommandQuery
} from '../src/shared/commands.js';
import { expandCommandBody, parseCommandMarkdown } from '../src/shared/plugins.js';

type Ctx = { after: (fn: () => void) => void };

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function bundle(dir: string, name: string, extra: (root: string) => void = () => {}) {
  const root = join(dir, name);
  write(
    join(root, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} plugin` })
  );
  extra(root);
  return root;
}

function workspace(t: Ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-commands-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a command needs neither frontmatter nor a description', () => {
  const bare = parseCommandMarkdown('Review the diff and be blunt.', 'review');

  assert.equal(bare.ok, true);
  assert.equal(bare.ok ? bare.command.name : '', 'review', 'the filename names it');
  assert.equal(bare.ok ? bare.command.description : 'x', '');
  assert.equal(bare.ok ? bare.command.body : '', 'Review the diff and be blunt.');
});

test('frontmatter overrides the filename and carries an argument hint', () => {
  const parsed = parseCommandMarkdown(
    ['---', 'name: ship', 'description: Cut a release.', 'argument-hint: <version>', '---', 'Ship $1.'].join('\n'),
    'whatever'
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok ? parsed.command.name : '', 'ship');
  assert.equal(parsed.ok ? parsed.command.argumentHint : '', '<version>');
  assert.equal(parsed.ok ? parsed.command.body : '', 'Ship $1.');
});

test('a command with no body is refused, because it would expand to nothing', () => {
  assert.equal(parseCommandMarkdown('---\nname: empty\n---\n', 'empty').ok, false);
  assert.equal(parseCommandMarkdown('   ', 'blank').ok, false);
});

test('a name that could not be typed after a slash is refused', () => {
  assert.equal(parseCommandMarkdown('body', 'has space').ok, false);
  assert.equal(parseCommandMarkdown('body', '../escape').ok, false);
});

test('arguments fill the placeholders, and unfilled ones collapse', () => {
  assert.equal(expandCommandBody('Review $ARGUMENTS now.', 'src/app.ts'), 'Review src/app.ts now.');
  assert.equal(expandCommandBody('Move $1 to $2.', 'a b'), 'Move a to b.');
  assert.equal(
    expandCommandBody('Move $1 to $2.', 'a'),
    'Move a to .',
    'a placeholder with nothing to fill it must not reach the model as literal $2'
  );
  assert.equal(expandCommandBody('Cost is $5 total.', ''), 'Cost is  total.');
});

test('the picker only triggers on a slash in the first column', () => {
  assert.ok(matchCommandQuery('/rev', 4), 'a leading slash is an invocation');
  assert.equal(matchCommandQuery('see src/app.ts', 14), null, 'a path is not');
  assert.equal(matchCommandQuery('and/or', 6), null);
  assert.equal(matchCommandQuery('on 12/03 we shipped', 19), null);
  assert.equal(
    matchCommandQuery('/review\nthen explain', 19),
    null,
    'a message that has become prose is no longer naming a command'
  );
});

test('the picker stays open while arguments are typed', () => {
  const match = matchCommandQuery('/review src/app.ts', 18);

  assert.equal(match?.query, 'review');
  assert.equal(match?.args, 'src/app.ts', 'so the body can be expanded with them');
});

test('an exact name outranks a longer one that merely contains it', () => {
  const commands = [
    { qualifiedName: 'a:reviewer', pluginName: 'a', name: 'reviewer', description: '', argumentHint: '' },
    { qualifiedName: 'b:review', pluginName: 'b', name: 'review', description: '', argumentHint: '' }
  ];

  assert.deepEqual(
    filterCommands(commands, 'review').map((command) => command.name),
    ['review', 'reviewer']
  );
});

test('picking a command replaces the invocation with the expanded body', () => {
  const match = matchCommandQuery('/review src/app.ts', 18)!;
  const applied = applyCommand(match, 'Review $ARGUMENTS carefully.');

  assert.equal(applied.text, 'Review src/app.ts carefully.');
  assert.equal(applied.caret, applied.text.length, 'the expansion is a draft, so the caret ends after it');
});

test('commands are discovered beside skills and read on demand', (t) => {
  const dir = workspace(t);
  const root = bundle(dir, 'demo', (b) => {
    write(join(b, 'commands', 'review.md'), '---\ndescription: Review it.\n---\nLook at $ARGUMENTS.');
    write(join(b, 'commands', 'ship.md'), 'Ship it.');
    write(join(b, 'commands', 'notes.txt'), 'not a command');
    write(join(b, 'skills', 'go', 'SKILL.md'), '---\nname: go\ndescription: Go.\n---\nBody.');
  });

  const loaded = loadPlugin(root);
  assert.equal(loaded.ok, true);

  const commands = loaded.ok ? loaded.plugin.commands : [];
  assert.deepEqual(commands.map((command) => command.name).sort(), ['review', 'ship']);
  assert.equal(commands.find((command) => command.name === 'review')?.qualifiedName, 'demo:review');
  assert.equal(
    readCommandBody(commands.find((command) => command.name === 'review')!),
    'Look at $ARGUMENTS.',
    'the body is read from disk when it is actually wanted'
  );
  assert.equal(loaded.ok ? loaded.plugin.skills.length : 0, 1, 'skills are unaffected');
});

test('a linked command file is skipped, like every other way out of a bundle', (t) => {
  const dir = workspace(t);
  const outside = join(dir, 'outside.md');
  writeFileSync(outside, 'Whatever the attacker wants in your composer.');

  const root = bundle(dir, 'demo', (b) => {
    mkdirSync(join(b, 'commands'), { recursive: true });
    symlinkSync(outside, join(b, 'commands', 'sneaky.md'));
    write(join(b, 'commands', 'fine.md'), 'Fine.');
  });

  const loaded = loadPlugin(root);

  assert.deepEqual(loaded.ok ? loaded.plugin.commands.map((c) => c.name) : [], ['fine']);
});

test('a disabled plugin contributes no commands to the composer', (t) => {
  const dir = workspace(t);
  const pluginsRoot = join(dir, 'plugins');
  mkdirSync(pluginsRoot, { recursive: true });

  bundle(join(dir, 'plugins'), 'demo', (b) => {
    write(join(b, 'commands', 'review.md'), 'Review it.');
  });

  const disabled = new Set<string>();
  const registry = new PluginRegistry({ root: pluginsRoot, isEnabled: (name) => !disabled.has(name) });

  assert.deepEqual(buildCommandList(registry).map((command) => command.name), ['review']);

  disabled.add('demo');
  registry.invalidate();

  assert.deepEqual(buildCommandList(registry), [], 'off has to mean off here too');
});

test('a revoked plugin contributes no commands either', (t) => {
  const dir = workspace(t);
  const pluginsRoot = join(dir, 'plugins');
  mkdirSync(pluginsRoot, { recursive: true });

  bundle(join(dir, 'plugins'), 'demo', (b) => {
    write(join(b, 'commands', 'review.md'), 'Review it.');
  });

  const registry = new PluginRegistry({
    root: pluginsRoot,
    blockedReason: () => 'Withdrawn for security.'
  });

  assert.deepEqual(buildCommandList(registry), []);
});
