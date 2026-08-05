import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ActivationRecord } from '../src/main/plugins/PluginActivation.js';
import { PluginActivationStore, isGated } from '../src/main/plugins/PluginActivation.js';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry.js';
import { parseSkillSidecar } from '../src/shared/plugins.js';

type Ctx = { after: (fn: () => void) => void };

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function installPlugin(
  root: string,
  name: string,
  options: { skills?: string[]; servers?: string[]; sidecar?: Record<string, string> } = {}
) {
  const bundle = join(root, name);
  write(
    join(bundle, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} plugin` })
  );

  for (const skill of options.skills ?? []) {
    write(
      join(bundle, 'skills', skill, 'SKILL.md'),
      ['---', `name: ${skill}`, 'description: Do the thing.', '---', 'Body.'].join('\n')
    );

    const sidecar = options.sidecar?.[skill];
    if (sidecar) {
      write(join(bundle, 'skills', skill, 'agents', 'openai.yaml'), sidecar);
    }
  }

  if (options.servers?.length) {
    write(
      join(bundle, '.mcp.json'),
      JSON.stringify({
        mcpServers: Object.fromEntries(
          options.servers.map((key) => [key, { type: 'http', url: `https://${key}.test/mcp` }])
        )
      })
    );
  }
}

function setup(t: Ctx) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const registry = new PluginRegistry({ root });
  let stored: Record<string, ActivationRecord> = {};
  const store = new PluginActivationStore(
    registry,
    () => stored,
    (value) => {
      stored = value;
    }
  );

  return { root, registry, store, stored: () => stored };
}

test('a plugin with servers and skills is gated; one without a route is not', (t) => {
  const { root, registry } = setup(t);
  installPlugin(root, 'reachable', { skills: ['go'], servers: ['api'] });
  installPlugin(root, 'no-skills', { servers: ['api'] });
  installPlugin(root, 'no-servers', { skills: ['go'] });

  const byName = new Map(registry.snapshot().plugins.map((p) => [p.manifest.name, p]));

  assert.equal(isGated(byName.get('reachable')!), true);
  // Nothing would ever mention it, so gating would hide it forever.
  assert.equal(isGated(byName.get('no-skills')!), false);
  assert.equal(isGated(byName.get('no-servers')!), false);
});

test('a gated server is withheld until its plugin is activated', (t) => {
  const { root, store } = setup(t);
  installPlugin(root, 'demo', { skills: ['go'], servers: ['api'] });

  const before = store.serverFilter('conv-1');
  assert.equal(before('plugin:demo:api'), false, 'gated until something asks');

  store.activateForSkill('conv-1', 'demo', []);

  assert.equal(store.serverFilter('conv-1')('plugin:demo:api'), true);
});

test('activation is scoped to one conversation', (t) => {
  const { root, store } = setup(t);
  installPlugin(root, 'demo', { skills: ['go'], servers: ['api'] });

  store.activateForSkill('conv-1', 'demo', []);

  assert.equal(store.serverFilter('conv-1')('plugin:demo:api'), true);
  assert.equal(store.serverFilter('conv-2')('plugin:demo:api'), false);
});

test('an ungated plugin passes the filter without any activation', (t) => {
  const { root, store } = setup(t);
  installPlugin(root, 'no-skills', { servers: ['api'] });

  assert.equal(store.serverFilter('conv-1')('plugin:no-skills:api'), true);
});

test('loading a skill activates its own plugin, and says whether anything changed', (t) => {
  const { root, store } = setup(t);
  installPlugin(root, 'demo', { skills: ['go'], servers: ['api'] });

  assert.equal(store.activateForSkill('conv-1', 'demo', []), true, 'the first load changes things');
  assert.equal(store.activateForSkill('conv-1', 'demo', []), false, 'the second does not');
});

test('a skill can activate a server owned by a different plugin', (t) => {
  // The cross-plugin route, and the only reason dependencies.tools is parsed.
  const { root, store } = setup(t);
  installPlugin(root, 'skills-only', { skills: ['analyse'] });
  installPlugin(root, 'neon', { skills: ['go'], servers: ['neon'] });

  store.activateForSkill('conv-1', 'skills-only', ['neon']);

  assert.equal(store.serverFilter('conv-1')('plugin:neon:neon'), true);
});

test('deactivating puts a server back behind the gate', (t) => {
  const { root, store } = setup(t);
  installPlugin(root, 'demo', { skills: ['go'], servers: ['api'] });

  store.activateForSkill('conv-1', 'demo', []);
  store.deactivate('conv-1', 'demo');

  assert.equal(store.serverFilter('conv-1')('plugin:demo:api'), false);
});

test('the prewarm filter never warms a gated server', (t) => {
  const { root, store } = setup(t);
  installPlugin(root, 'gated', { skills: ['go'], servers: ['api'] });
  installPlugin(root, 'eager', { servers: ['api'] });

  const filter = store.eagerOnlyFilter();

  // Warming a gated server would spawn the process the gate exists to avoid.
  assert.equal(filter('plugin:gated:api'), false);
  assert.equal(filter('plugin:eager:api'), true);
});

test('stored activations stay bounded', (t) => {
  const { root, registry } = setup(t);
  installPlugin(root, 'demo', { skills: ['go'], servers: ['api'] });

  let stored: Record<string, ActivationRecord> = {};
  const store = new PluginActivationStore(registry, () => stored, (value) => { stored = value; }, 3);

  for (let index = 0; index < 10; index += 1) {
    store.activate(`conv-${index}`, ['demo']);
  }

  assert.equal(Object.keys(stored).length, 3);
  assert.ok(stored['conv-9'], 'the newest conversation survives');
  assert.equal(stored['conv-0'], undefined, 'the oldest is pruned');
});

test('the sidecar is read for both of the keys that change behaviour', () => {
  // Verbatim shape from the neon bundle.
  const sidecar = parseSkillSidecar(
    [
      'interface:',
      '  display_name: "Neon"',
      '  default_prompt: "Analyze my database"',
      'policy:',
      '  allow_implicit_invocation: false',
      'dependencies:',
      '  tools:',
      '    - type: "mcp"',
      '      value: "neon"',
      '      description: "Neon MCP server"',
      '      transport: "streamable_http"'
    ].join('\n')
  );

  assert.equal(sidecar.implicitInvocation, false);
  assert.deepEqual(sidecar.requiredServers, ['neon']);
});

test('a dependency that is not an mcp server contributes nothing', () => {
  const sidecar = parseSkillSidecar(
    ['dependencies:', '  tools:', '    - type: "http"', '      value: "not-a-server"'].join('\n')
  );

  assert.deepEqual(sidecar.requiredServers, []);
});

test('a sidecar that says nothing leaves the frontmatter answer standing', () => {
  const sidecar = parseSkillSidecar('interface:\n  display_name: "Just metadata"\n');

  assert.equal(sidecar.implicitInvocation, null);
  assert.deepEqual(sidecar.requiredServers, []);
});

test('the sidecar spelling of the invocation opt-out reaches the loaded skill', (t) => {
  const { root, registry } = setup(t);
  installPlugin(root, 'demo', {
    skills: ['quiet'],
    sidecar: { quiet: 'policy:\n  allow_implicit_invocation: false\n' }
  });

  const [skill] = registry.snapshot().plugins[0]?.skills ?? [];
  assert.equal(skill?.implicitInvocation, false, '20 real skills use this spelling, not the frontmatter one');
});
