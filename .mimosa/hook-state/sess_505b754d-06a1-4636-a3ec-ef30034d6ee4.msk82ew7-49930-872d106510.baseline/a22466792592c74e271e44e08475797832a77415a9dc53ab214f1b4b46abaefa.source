import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AgentInstructionsService,
  generateStarterAgentsMd
} from '../src/main/workspace/AgentInstructions.js';

/**
 * Every case gets its own global directory so the suite can never read the
 * developer's real `~/.atlas`.
 */
function makeDirs() {
  const base = mkdtempSync(join(tmpdir(), 'atlas-agents-test-'));
  const globalDir = join(base, 'global');
  const root = join(base, 'project');
  mkdirSync(globalDir);
  mkdirSync(root);
  return { base, globalDir, root, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('global instructions load before project instructions', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    writeFileSync(join(globalDir, 'AGENTS.md'), 'Global rule: prefer small diffs.');
    writeFileSync(join(root, 'AGENTS.md'), 'Project rule: run pnpm test.');

    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(root);

    assert.deepEqual(
      result.sources.map((source) => source.scope),
      ['global', 'project']
    );
    assert.ok(result.text.indexOf('Global rule') < result.text.indexOf('Project rule'));
    assert.equal(result.truncated, false);
  } finally {
    cleanup();
  }
});

test('an override file replaces the plain file in the same directory', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    writeFileSync(join(root, 'AGENTS.override.md'), 'Override wins.');
    writeFileSync(join(root, 'AGENTS.md'), 'Plain file loses.');

    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(root);

    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]?.path, join(root, 'AGENTS.override.md'));
    assert.ok(result.text.includes('Override wins.'));
    assert.equal(result.text.includes('Plain file loses.'), false);
  } finally {
    cleanup();
  }
});

test('an empty override falls through to the plain file', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    writeFileSync(join(root, 'AGENTS.override.md'), '   \n\n');
    writeFileSync(join(root, 'AGENTS.md'), 'Still here.');

    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(root);

    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]?.path, join(root, 'AGENTS.md'));
  } finally {
    cleanup();
  }
});

test('the byte cap truncates the last file that fits and skips the rest', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    writeFileSync(join(globalDir, 'AGENTS.md'), 'g'.repeat(20 * 1024));
    writeFileSync(join(root, 'AGENTS.md'), 'p'.repeat(20 * 1024));

    const service = new AgentInstructionsService({ globalDir, maxBytes: 32 * 1024 });
    const result = service.getForRoot(root);

    assert.equal(result.truncated, true);
    assert.equal(result.sources[0]?.truncated, false);
    assert.equal(result.sources[1]?.truncated, true);
    assert.equal(result.sources[1]?.bytes, 12 * 1024);
    assert.ok(result.text.includes('[Truncated: AGENTS.md content exceeded the 32 KiB limit]'));
  } finally {
    cleanup();
  }
});

test('truncation never leaves a half-decoded multibyte character behind', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    // Three bytes per character, cut at a byte offset that is not a multiple of
    // three, so the naive decode would end in a replacement character.
    writeFileSync(join(root, 'AGENTS.md'), '这'.repeat(100));

    const service = new AgentInstructionsService({ globalDir, maxBytes: 100 });
    const result = service.getForRoot(root);

    assert.equal(result.truncated, true);
    assert.equal(result.text.includes('�'), false);
  } finally {
    cleanup();
  }
});

test('a project with no instruction files produces an empty result', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(root);

    assert.equal(result.text, '');
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.nestedPaths, []);
    assert.equal(result.totalBytes, 0);
    assert.equal(result.truncated, false);
  } finally {
    cleanup();
  }
});

test('a conversation with no project still gets the global scope', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    writeFileSync(join(globalDir, 'AGENTS.md'), 'Global rule.');
    writeFileSync(join(root, 'AGENTS.md'), 'Project rule.');

    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(null);

    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]?.scope, 'global');
    assert.equal(result.text.includes('Project rule.'), false);
    assert.deepEqual(result.nestedPaths, []);
  } finally {
    cleanup();
  }
});

test('a directory named AGENTS.md is skipped rather than read', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    mkdirSync(join(root, 'AGENTS.md'));

    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(root);

    assert.deepEqual(result.sources, []);
  } finally {
    cleanup();
  }
});

test('an unreadable instruction file is skipped without taking the turn down', { skip: process.getuid?.() === 0 }, () => {
  const { globalDir, root, cleanup } = makeDirs();
  const path = join(root, 'AGENTS.md');
  try {
    writeFileSync(path, 'Secret instructions.');
    chmodSync(path, 0o000);

    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(root);

    assert.deepEqual(result.sources, []);
    assert.equal(result.text, '');
  } finally {
    chmodSync(path, 0o600);
    cleanup();
  }
});

test('nested instruction files are listed, bounded, and never loaded', () => {
  const { globalDir, root, cleanup } = makeDirs();
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'Root rule.');

    mkdirSync(join(root, 'packages', 'a'), { recursive: true });
    writeFileSync(join(root, 'packages', 'a', 'AGENTS.md'), 'Nested rule.');

    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x', 'AGENTS.md'), 'Vendored rule.');

    mkdirSync(join(root, 'one', 'two', 'three', 'four'), { recursive: true });
    writeFileSync(join(root, 'one', 'two', 'three', 'four', 'AGENTS.md'), 'Too deep.');

    const service = new AgentInstructionsService({ globalDir });
    const result = service.getForRoot(root);

    assert.deepEqual(result.nestedPaths, [join('packages', 'a', 'AGENTS.md')]);
    assert.equal(result.text.includes('Nested rule.'), false);
    assert.equal(result.text.includes('Vendored rule.'), false);
    assert.ok(result.text.includes('Root rule.'));
  } finally {
    cleanup();
  }
});

test('an edited instruction file is picked up on the next read', () => {
  const { globalDir, root, cleanup } = makeDirs();
  const path = join(root, 'AGENTS.md');
  try {
    writeFileSync(path, 'First version.');

    const service = new AgentInstructionsService({ globalDir });
    assert.ok(service.getForRoot(root).text.includes('First version.'));

    writeFileSync(path, 'Second version.');
    // Filesystems with coarse mtime resolution would otherwise report the two
    // writes as the same instant, which is a cache hit the user never made.
    const future = new Date(Date.now() + 2_000);
    utimesSync(path, future, future);

    assert.ok(service.getForRoot(root).text.includes('Second version.'));
  } finally {
    cleanup();
  }
});

test('the starter template names the project and its detected commands', () => {
  const markdown = generateStarterAgentsMd('Atlas', {
    type: 'node',
    packageManager: 'pnpm',
    framework: 'Electron'
  });

  assert.ok(markdown.startsWith('# Atlas'));
  assert.ok(markdown.includes('pnpm test'));
  assert.ok(markdown.includes('Electron'));
});
