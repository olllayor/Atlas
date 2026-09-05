import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { PluginRegistry } from '../src/main/plugins/PluginRegistry';
import { SkillsService } from '../src/main/plugins/SkillsService';
import { StandaloneSkillsScanner } from '../src/main/plugins/StandaloneSkillsScanner';
import { createSkillTools } from '../src/main/plugins/skillTools';

function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });
  return dir;
}

function writeSkill(
  root: string,
  name: string,
  options: {
    description?: string;
    body?: string;
    implicit?: boolean;
    sidecarImplicit?: boolean;
    tools?: string[];
  } = {}
): string {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });

  const lines = [
    '---',
    `name: ${name}`,
    `description: ${options.description ?? `Description for ${name}.`}`,
  ];
  if (options.implicit === false) {
    lines.push('disable-model-invocation: true');
  }
  lines.push('---');
  lines.push('');
  lines.push(options.body ?? `# Instructions for ${name}\n\nDo something useful.`);

  writeFileSync(join(folder, 'SKILL.md'), lines.join('\n'), 'utf-8');

  if (options.sidecarImplicit !== undefined || (options.tools && options.tools.length > 0)) {
    const sidecarDir = join(folder, 'agents');
    mkdirSync(sidecarDir, { recursive: true });
    const sidecarLines: string[] = [];
    if (options.sidecarImplicit !== undefined) {
      sidecarLines.push('policy:');
      sidecarLines.push(`  allow_implicit_invocation: ${options.sidecarImplicit}`);
    }
    if (options.tools && options.tools.length > 0) {
      sidecarLines.push('dependencies:');
      sidecarLines.push('  tools:');
      for (const tool of options.tools) {
        sidecarLines.push(`    - type: mcp`);
        sidecarLines.push(`      value: ${tool}`);
      }
    }
    writeFileSync(join(sidecarDir, 'openai.yaml'), sidecarLines.join('\n'), 'utf-8');
  }

  return folder;
}

test('discovers global skills from configured globalRoots', (t) => {
  const global1 = tempDir(t, 'global1-skills');
  const global2 = tempDir(t, 'global2-skills');

  writeSkill(global1, 'apple-design', { description: 'HIG patterns for macOS.' });
  writeSkill(global2, 'cloudflare-deploy', { description: 'Deploy to Cloudflare.' });

  const scanner = new StandaloneSkillsScanner({
    globalRoots: [global1, global2]
  });

  const skills = scanner.scan();
  assert.equal(skills.length, 2);

  const apple = skills.find((s) => s.name === 'apple-design');
  assert.ok(apple);
  assert.equal(apple.pluginName, 'global');
  assert.equal(apple.description, 'HIG patterns for macOS.');

  const cf = skills.find((s) => s.name === 'cloudflare-deploy');
  assert.ok(cf);
  assert.equal(cf.pluginName, 'global');
});

test('project skills override global skills with the same name', (t) => {
  const globalRoot = tempDir(t, 'global-skills');
  const projectRoot = tempDir(t, 'project');
  const projectSkillsDir = join(projectRoot, '.agents', 'skills');

  writeSkill(globalRoot, 'brandkit', { description: 'Global brandkit.' });
  writeSkill(projectSkillsDir, 'brandkit', { description: 'Project brandkit with custom colors.' });

  const scanner = new StandaloneSkillsScanner({
    globalRoots: [globalRoot]
  });

  const skills = scanner.scan(projectRoot);
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.name, 'brandkit');
  assert.equal(skills[0]?.pluginName, 'project');
  assert.equal(skills[0]?.description, 'Project brandkit with custom colors.');
});

test('precedence within global roots gives priority to earlier roots', (t) => {
  const atlasGlobal = tempDir(t, 'atlas-skills');
  const agentsGlobal = tempDir(t, 'agents-skills');

  writeSkill(atlasGlobal, 'custom-skill', { description: 'Atlas version.' });
  writeSkill(agentsGlobal, 'custom-skill', { description: 'Agents version.' });

  const scanner = new StandaloneSkillsScanner({
    globalRoots: [atlasGlobal, agentsGlobal]
  });

  const skills = scanner.scan();
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.description, 'Atlas version.');
});

test('SkillsService resolves standalone global and project skills by bare name and qualified name', (t) => {
  const pluginsDir = tempDir(t, 'plugins');
  const globalDir = tempDir(t, 'global-skills');
  const projectDir = tempDir(t, 'project');

  writeSkill(globalDir, 'apple-design', { description: 'Native HIG design.' });
  writeSkill(join(projectDir, '.agents', 'skills'), 'shadcn', { description: 'UI components.' });

  const registry = new PluginRegistry({ root: pluginsDir });
  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const service = new SkillsService(registry, () => true, scanner);

  // Bare name
  assert.ok(service.find('apple-design'));
  assert.ok(service.find('shadcn', projectDir));

  // Qualified name
  assert.ok(service.find('global:apple-design'));
  assert.ok(service.find('project:shadcn', projectDir));

  // Case-insensitive
  assert.ok(service.find('APPLE-DESIGN'));
  assert.ok(service.find('SHADCN', projectDir));

  // Non-existent
  assert.equal(service.find('missing-skill'), null);
});

test('SkillsService describeForPrompt includes global and project skills', (t) => {
  const pluginsDir = tempDir(t, 'plugins');
  const globalDir = tempDir(t, 'global-skills');
  const projectDir = tempDir(t, 'project');

  writeSkill(globalDir, 'apple-design', { description: 'Native HIG design.' });
  writeSkill(globalDir, 'hidden-skill', { description: 'Hidden.', implicit: false });
  writeSkill(join(projectDir, '.agents', 'skills'), 'shadcn', { description: 'UI components.' });

  const registry = new PluginRegistry({ root: pluginsDir });
  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const service = new SkillsService(registry, () => true, scanner);

  const prompt = service.describeForPrompt({
    mode: 'code',
    hasProject: true,
    projectRoot: projectDir
  });

  assert.ok(prompt);
  assert.match(prompt, /<available_skills>/);
  assert.match(prompt, /- apple-design — Native HIG design\./);
  assert.match(prompt, /- shadcn — UI components\./);
  // Hidden skill must not be listed in prompt
  assert.doesNotMatch(prompt, /hidden-skill/);

  // But hidden skill can still be found and read
  assert.ok(service.find('hidden-skill'));
  const hiddenBody = service.read('hidden-skill');
  assert.match(hiddenBody, /Do something useful/);
});

test('SkillsService read returns fenced body with folder path anchor', (t) => {
  const pluginsDir = tempDir(t, 'plugins');
  const globalDir = tempDir(t, 'global-skills');

  const folder = writeSkill(globalDir, 'apple-design', {
    description: 'Native HIG design.',
    body: '# Apple Design\nFollow HIG.'
  });

  const registry = new PluginRegistry({ root: pluginsDir });
  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const service = new SkillsService(registry, () => true, scanner);

  const text = service.read('apple-design');
  assert.match(text, /<plugin_skill plugin="global" skill="apple-design">/);
  assert.match(text, /Follow HIG\./);
  assert.ok(text.includes(folder), 'expected folder path in read text');
  assert.match(text, /Supporting files for this skill live in/);
});

test('createSkillTools executes load_skill for standalone global and project skills', async (t) => {
  const pluginsDir = tempDir(t, 'plugins');
  const globalDir = tempDir(t, 'global-skills');
  const projectDir = tempDir(t, 'project');

  writeSkill(globalDir, 'apple-design', {
    description: 'Native HIG design.',
    body: '# Apple Design Guidelines'
  });
  writeSkill(join(projectDir, '.agents', 'skills'), 'shadcn', {
    description: 'Shadcn UI.',
    body: '# Shadcn Components'
  });

  const registry = new PluginRegistry({ root: pluginsDir });
  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const service = new SkillsService(registry, () => true, scanner);

  const tools = createSkillTools(service, undefined, projectDir);
  assert.ok(tools.load_skill);

  const result1 = await (tools.load_skill as any).execute({ name: 'apple-design' });
  assert.match(result1, /Apple Design Guidelines/);

  const result2 = await (tools.load_skill as any).execute({ name: 'shadcn' });
  assert.match(result2, /Shadcn Components/);
});

test('find does not leak project skills across project roots', (t) => {
  const pluginsDir = tempDir(t, 'plugins');
  const globalDir = tempDir(t, 'global-skills');
  const projectA = tempDir(t, 'project-a');
  const projectB = tempDir(t, 'project-b');

  writeSkill(join(projectA, '.agents', 'skills'), 'only-in-a', {
    description: 'Secret A skill.'
  });

  const registry = new PluginRegistry({ root: pluginsDir });
  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const service = new SkillsService(registry, () => true, scanner);

  assert.ok(service.find('only-in-a', projectA));
  assert.equal(service.find('only-in-a', projectB), null);
  assert.equal(service.find('only-in-a', null), null);
  assert.match(service.read('only-in-a', projectB), /no skill called/);
});

test('project .codex/skills root is discovered', (t) => {
  const pluginsDir = tempDir(t, 'plugins');
  const globalDir = tempDir(t, 'global-skills');
  const projectDir = tempDir(t, 'project');

  writeSkill(join(projectDir, '.codex', 'skills'), 'codex-only', {
    description: 'Codex project skill.'
  });

  const registry = new PluginRegistry({ root: pluginsDir });
  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const service = new SkillsService(registry, () => true, scanner);

  assert.ok(service.find('codex-only', projectDir));
});

test('cached scans return copies so callers cannot poison the cache', (t) => {
  const globalDir = tempDir(t, 'global-skills');
  writeSkill(globalDir, 's1', { description: 'One.' });

  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const first = scanner.scanGlobal();
  assert.equal(first.length, 1);
  (first as unknown[]).push({ name: 'poison' });
  assert.equal(scanner.scanGlobal().length, 1);
});

test('invalidate clears standalone caches', (t) => {
  const pluginsDir = tempDir(t, 'plugins');
  const globalDir = tempDir(t, 'global-skills');

  writeSkill(globalDir, 's1', { description: 'One.' });
  const registry = new PluginRegistry({ root: pluginsDir });
  const scanner = new StandaloneSkillsScanner({ globalRoots: [globalDir] });
  const service = new SkillsService(registry, () => true, scanner);

  assert.equal(service.snapshot().skills.length, 1);
  writeSkill(globalDir, 's2', { description: 'Two.' });
  // Still cached
  assert.equal(service.snapshot().skills.length, 1);
  service.invalidate();
  assert.equal(service.snapshot().skills.length, 2);
});
