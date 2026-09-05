import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  discoverClaudeSkills,
  parseSkillFrontmatter,
  planClaudeSkillDispatch
} from '../src/main/ai/providers/claude/claudeSkills.js';

test('skill frontmatter: description and invocation flags', () => {
  const parsed = parseSkillFrontmatter('---\ndescription: Reviews code\nuser-invocable: no\n---\nbody');
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind === 'parsed') {
    assert.equal(parsed.description, 'Reviews code');
    assert.equal(parsed.userInvocable, false);
  }
  assert.equal(parseSkillFrontmatter('no frontmatter').kind, 'missing');
  assert.equal(parseSkillFrontmatter('---\n: bad\n---\n').kind, 'malformed');
});

test('skill frontmatter: YAML 1.1 booleans and disable-model-invocation', () => {
  const parsed = parseSkillFrontmatter('---\ndisable-model-invocation: yes\n---\n');
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind === 'parsed') {
    assert.equal(parsed.userInvocationOnly, true);
  }
});

test('skill discovery: user scope wins, malformed skipped', async () => {
  const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
  const cwd = await mkdtemp(join(tmpdir(), 'claude-cwd-'));
  await mkdir(join(home, 'skills', 'shared', ), { recursive: true });
  await writeFile(join(home, 'skills', 'shared', 'SKILL.md'), '---\ndescription: user copy\n---\n');
  await mkdir(join(home, 'skills', 'broken'), { recursive: true });
  await writeFile(join(home, 'skills', 'broken', 'SKILL.md'), '---\n: bad\n---\n');
  await mkdir(join(cwd, '.claude', 'skills', 'shared'), { recursive: true });
  await writeFile(join(cwd, '.claude', 'skills', 'shared', 'SKILL.md'), '---\ndescription: project copy\n---\n');
  await mkdir(join(cwd, '.claude', 'skills', 'local'), { recursive: true });
  await writeFile(join(cwd, '.claude', 'skills', 'local', 'SKILL.md'), 'no frontmatter, still a skill');

  const skills = await discoverClaudeSkills({ homePath: home, cwd });
  const shared = skills.find((skill) => skill.name === 'shared');
  assert.equal(shared?.scope, 'user');
  assert.equal(shared?.description, 'user copy');
  assert.ok(skills.some((skill) => skill.name === 'local' && skill.scope === 'project'));
  assert.ok(!skills.some((skill) => skill.name === 'broken'));
});

test('skill dispatch: last known mention becomes the trailing command', () => {
  const names = new Set(['review', 'plan']);
  const dispatch = planClaudeSkillDispatch('check this $review then $plan it', names);
  assert.equal(dispatch?.skillName, 'plan');
  assert.equal(dispatch?.commandText, '/plan it');
  assert.equal(dispatch?.leadingText, 'check this /review then');
});

test('skill dispatch: unknown mentions stay literal, no dispatch without match', () => {
  assert.equal(planClaudeSkillDispatch('check $HOME dir', new Set(['review'])), undefined);
  assert.equal(planClaudeSkillDispatch('plain text', new Set(['review'])), undefined);
});
