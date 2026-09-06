import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeSlashMenuCommands,
  filterSlashMenuSkills,
  formatSkillDisplayName,
  getSlashMenuSkills,
  skillInsertText,
  skillSlashLabel,
  type SlashMenuSkill,
} from '../src/shared/slashMenuSkills.js';

function makeSkill(overrides: Partial<SlashMenuSkill> = {}): SlashMenuSkill {
  return {
    qualifiedName: 'demo:unslop',
    pluginName: 'demo',
    name: 'unslop',
    description: 'Cut AI tells from writing',
    source: 'plugin',
    ...overrides,
  };
}

test('formatSkillDisplayName title-cases kebab and snake names', () => {
  assert.equal(formatSkillDisplayName('unslop'), 'Unslop');
  assert.equal(formatSkillDisplayName('ask-matt'), 'Ask Matt');
  assert.equal(formatSkillDisplayName('my_cool_skill'), 'My Cool Skill');
});

test('skillSlashLabel uses the /skill:Display form', () => {
  assert.equal(skillSlashLabel(makeSkill({ name: 'ask-matt' })), '/skill:Ask Matt');
});

test('skillInsertText uses the mention route per source', () => {
  assert.equal(
    skillInsertText(makeSkill({ pluginName: 'demo', name: 'unslop', source: 'plugin' })),
    '@demo unslop '
  );
  assert.equal(
    skillInsertText(makeSkill({ pluginName: 'project', name: 'shadcn', source: 'project' })),
    '$shadcn '
  );
  assert.equal(
    skillInsertText(makeSkill({ pluginName: 'global', name: 'unslop', source: 'global' })),
    '$unslop '
  );
});

test('skillInsertText never yields a bare /name the send path would consume', () => {
  for (const skill of [
    makeSkill({ name: 'plan', source: 'plugin', pluginName: 'demo' }),
    makeSkill({ name: 'compact', source: 'global', pluginName: 'global' }),
  ]) {
    assert.ok(!skillInsertText(skill).startsWith('/'));
  }
});

test('getSlashMenuSkills is just the setting gate', () => {
  const skills = [makeSkill()];
  assert.deepEqual(getSlashMenuSkills(skills, true).map((skill) => skill.name), ['unslop']);
  assert.deepEqual(getSlashMenuSkills(skills, false), []);
});

test('dedupeSlashMenuCommands lets the visible skill alias win', () => {
  const commands = [
    { name: 'ask-matt', description: 'Ask which skill fits.' },
    { name: 'compact', description: 'Compact history.' },
  ];
  const skills = [makeSkill({ name: 'ask-matt' })];
  assert.deepEqual(
    dedupeSlashMenuCommands(commands, skills).map((command) => command.name),
    ['compact']
  );
});

test('dedupeSlashMenuCommands keeps the command when the skill is hidden', () => {
  const commands = [{ name: 'ask-matt', description: 'Ask which skill fits.' }];
  assert.deepEqual(
    dedupeSlashMenuCommands(commands, []).map((command) => command.name),
    ['ask-matt']
  );
});

test('filterSlashMenuSkills lists everything on empty or bare skill queries', () => {
  const skills = [makeSkill(), makeSkill({ name: 'browser', qualifiedName: 'demo:browser' })];
  assert.equal(filterSlashMenuSkills(skills, '').length, 2);
  assert.equal(filterSlashMenuSkills(skills, 'skill').length, 2);
  assert.equal(filterSlashMenuSkills(skills, 'skill:').length, 2);
});

test('filterSlashMenuSkills matches names, display names, and descriptions', () => {
  const skills = [
    makeSkill({ name: 'ask-matt', description: 'Find the right skill or workflow' }),
    makeSkill({ name: 'browser', qualifiedName: 'demo:browser', description: 'Control the browser' }),
  ];
  assert.deepEqual(filterSlashMenuSkills(skills, 'ask matt').map((skill) => skill.name), [
    'ask-matt',
  ]);
  assert.deepEqual(filterSlashMenuSkills(skills, 'skill:brow').map((skill) => skill.name), [
    'browser',
  ]);
  assert.deepEqual(filterSlashMenuSkills(skills, 'workflow').map((skill) => skill.name), [
    'ask-matt',
  ]);
});

test('filterSlashMenuSkills ranks exact names first', () => {
  const skills = [
    makeSkill({ name: 'my-skill-extended', qualifiedName: 'demo:my-skill-extended' }),
    makeSkill({ name: 'my-skill', qualifiedName: 'demo:my-skill' }),
  ];
  assert.deepEqual(filterSlashMenuSkills(skills, 'my-skill').map((skill) => skill.name), [
    'my-skill',
    'my-skill-extended',
  ]);
});
