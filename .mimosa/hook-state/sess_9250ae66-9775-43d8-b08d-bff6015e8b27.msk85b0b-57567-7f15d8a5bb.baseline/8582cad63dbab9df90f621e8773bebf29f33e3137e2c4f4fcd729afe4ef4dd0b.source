import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadPlugin } from '../src/main/plugins/PluginLoader.js';
import { buildMcpServerEnv } from '../src/shared/mcp.js';
import {
  AGENT_PLUGINS_MCP_SCHEMA,
  AGENT_PLUGINS_PLUGIN_SCHEMA,
  ATLAS_EXTENSION_NAMESPACE,
  describeSchemaSupport,
  expandPluginVariables,
  isAgentPluginName,
  isAgentSkillName,
  parsePluginManifest,
  parsePluginMcpServers,
  pluginComponentPaths
} from '../src/shared/plugins.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function workspace(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-ap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const SKILL = ['---', 'name: greet', 'description: Say hello. Use when greeting.', '---', 'Body.'].join('\n');

function write(root: string, relative: string, contents: string) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

/** A minimal conformant bundle: root manifest, one skill. */
function agentPlugin(root: string, manifest: Record<string, unknown> = {}, mcp?: Record<string, unknown>) {
  write(
    root,
    'plugin.json',
    JSON.stringify({ $schema: AGENT_PLUGINS_PLUGIN_SCHEMA, name: 'hello-plugin', ...manifest })
  );
  write(root, 'skills/greet/SKILL.md', SKILL);

  if (mcp) {
    write(root, 'mcp.json', JSON.stringify({ $schema: AGENT_PLUGINS_MCP_SCHEMA, ...mcp }));
  }

  return root;
}

function load(root: string) {
  const result = loadPlugin(root);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) throw new Error('unreachable');
  return result.plugin;
}

/* ------------------------------------------------------------------ *
 * Identity and format detection
 * ------------------------------------------------------------------ */

test('the smallest useful plugin from the spec loads', (t) => {
  const plugin = load(agentPlugin(workspace(t)));

  assert.equal(plugin.manifest.name, 'hello-plugin');
  assert.equal(plugin.manifest.format, 'agent-plugins');
  assert.deepEqual(plugin.skills.map((skill) => skill.name), ['greet']);
  assert.deepEqual(plugin.warnings, [], plugin.warnings.join(' | '));
});

test('a root manifest wins over a vendor one in the same bundle', (t) => {
  const root = agentPlugin(workspace(t));
  write(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'legacy', version: '0.0.1', description: 'x' }));

  // A bundle carrying both is saying "read me as the standard, and here is a
  // fallback for older clients".
  assert.equal(load(root).manifest.name, 'hello-plugin');
});

test('version and description are required by vendor conventions and optional here', () => {
  const bare = JSON.stringify({ $schema: AGENT_PLUGINS_PLUGIN_SCHEMA, name: 'x' });

  assert.equal(parsePluginManifest(bare, 'agent-plugins').ok, true);
  assert.equal(parsePluginManifest(bare, 'vendor').ok, false, 'vendor bundles still need both');
});

test('the spec name production is enforced only for the standard', () => {
  for (const good of ['a', 'hello-plugin', 'com.example.thing', 'x9']) {
    assert.ok(isAgentPluginName(good), good);
  }

  for (const bad of ['', 'Hello', '-lead', 'trail-', 'a--b', 'a..b', 'has_underscore', 'x'.repeat(65)]) {
    assert.equal(isAgentPluginName(bad), false, bad);
  }

  // `PascalCase` and underscores exist in real vendor bundles. Rejecting them
  // would enforce a spec against bundles that never claimed to follow it.
  const legacy = JSON.stringify({ name: 'My_Plugin', version: '1.0.0', description: 'd' });
  assert.equal(parsePluginManifest(legacy, 'vendor').ok, true);
  assert.equal(parsePluginManifest(legacy, 'agent-plugins').ok, false);
});

test('unknown manifest fields are reported and ignored, never fatal', (t) => {
  const plugin = load(agentPlugin(workspace(t), { hooks: './hooks.json', strict: true }));

  assert.equal(plugin.manifest.name, 'hello-plugin');
  assert.match(plugin.warnings.join(' '), /Ignored unrecognised manifest fields.*hooks.*strict/);
});

test('a newer schema is reported but still loads what it can', (t) => {
  const plugin = load(
    agentPlugin(workspace(t), {
      $schema: 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json'
    })
  );

  assert.equal(plugin.skills.length, 1, 'the skills are still readable');
  assert.match(plugin.warnings.join(' '), /targets Agent Plugins 2\.0\.0/);
});

test('describeSchemaSupport separates "too new" from "not ours"', () => {
  assert.equal(describeSchemaSupport(AGENT_PLUGINS_PLUGIN_SCHEMA), null);
  assert.equal(describeSchemaSupport(null), null);
  assert.match(
    describeSchemaSupport('https://agent-plugins.org/schemas/9.9.9/plugin.schema.json') ?? '',
    /targets Agent Plugins 9\.9\.9/
  );
  assert.match(describeSchemaSupport('https://elsewhere/x.json') ?? '', /Unrecognised/);
});

/* ------------------------------------------------------------------ *
 * Extensions
 * ------------------------------------------------------------------ */

test('Atlas reads its own namespace and ignores everyone else\'s without validating it', (t) => {
  const plugin = load(
    agentPlugin(workspace(t), {
      extensions: {
        [ATLAS_EXTENSION_NAMESPACE]: { workspaceModes: ['code'], requiresProject: true },
        // Deliberately nonsense. The spec says a client must ignore namespaces
        // it does not implement *without validating their contents* — letting
        // another client's schema decide whether this bundle loads here would
        // be exactly the coupling the namespace exists to prevent.
        'com.other.client': { anything: [1, 2, { nested: null }] }
      }
    })
  );

  assert.deepEqual(plugin.manifest.atlas.workspaceModes, ['code']);
  assert.equal(plugin.manifest.atlas.requiresProject, true);
  assert.ok('com.other.client' in plugin.manifest.extensions);
  assert.deepEqual(plugin.warnings, [], 'a foreign namespace is not a complaint');
});

/* ------------------------------------------------------------------ *
 * Component locations
 * ------------------------------------------------------------------ */

test('component locations are fixed for the standard and supplemented for vendors', () => {
  const standard = { format: 'agent-plugins' as const, paths: { skills: './elsewhere/', commands: null, mcpServers: null, apps: null, hooks: null } };
  assert.deepEqual(pluginComponentPaths(standard, 'skills'), ['./skills/']);
  assert.deepEqual(pluginComponentPaths(standard, 'mcpServers'), ['./mcp.json']);
  // Not in the standard at all.
  assert.deepEqual(pluginComponentPaths(standard, 'commands'), []);

  const vendor = { format: 'vendor' as const, paths: { skills: './elsewhere/', commands: null, mcpServers: null, apps: null, hooks: null } };
  assert.deepEqual(pluginComponentPaths(vendor, 'skills'), ['./skills/', './elsewhere/']);
});

test('an Agent Plugins bundle does not read a leftover .mcp.json', (t) => {
  const root = agentPlugin(workspace(t), {}, { mcpServers: { fresh: { type: 'stdio', command: 'node' } } });
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { stale: { command: 'node' } } }));

  // An author who moved to the standard and left the old file behind must not
  // have servers started that they believe they stopped declaring.
  assert.deepEqual(load(root).mcpServers.map((server) => server.key), ['fresh']);
});

/* ------------------------------------------------------------------ *
 * MCP: transports, headers, URLs
 * ------------------------------------------------------------------ */

test('the three specified transports are recognised by their standard spellings', () => {
  const result = parsePluginMcpServers(
    JSON.stringify({
      mcpServers: {
        local: { type: 'stdio', command: 'node', args: ['./s.js'] },
        modern: { type: 'streamable-http', url: 'https://example.com/mcp' },
        legacy: { type: 'sse', url: 'https://example.com/sse' }
      }
    })
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    result.servers.map((server) => [server.key, server.transport]),
    [
      ['local', 'stdio'],
      ['modern', 'http'],
      ['legacy', 'sse']
    ]
  );
});

test('plaintext HTTP is loopback-only', () => {
  const allowed = ['http://localhost:3000/mcp', 'http://127.0.0.1:8080/mcp', 'https://example.com/mcp'];
  const refused = ['http://example.com/mcp', 'ftp://example.com', 'not-a-url', 'https://example.com/mcp#frag'];

  for (const url of allowed) {
    const result = parsePluginMcpServers(JSON.stringify({ s: { type: 'streamable-http', url } }));
    assert.equal(result.ok && result.servers.length, 1, url);
  }

  for (const url of refused) {
    const result = parsePluginMcpServers(JSON.stringify({ s: { type: 'streamable-http', url } }));
    assert.deepEqual(result.ok && result.servers, [], url);
  }
});

test('a manifest may not hard-code a credential header or a URL password', () => {
  for (const header of ['Authorization', 'authorization', 'Cookie', 'Proxy-Authorization']) {
    const result = parsePluginMcpServers(
      JSON.stringify({ s: { type: 'streamable-http', url: 'https://x.com/mcp', headers: { [header]: 'Bearer hunter2' } } })
    );

    // The spec makes this a rule for plugin authors, which means nothing on its
    // own — the file is written by the party the rule constrains.
    assert.deepEqual(result.ok && result.servers, [], header);
    assert.match((result.ok && result.warnings.join(' ')) || '', /Credentials belong in the environment/);
  }

  const embedded = parsePluginMcpServers(
    JSON.stringify({ s: { type: 'streamable-http', url: 'https://user:pw@x.com/mcp' } })
  );
  assert.deepEqual(embedded.ok && embedded.servers, []);
});

test('ordinary headers survive', () => {
  const result = parsePluginMcpServers(
    JSON.stringify({ s: { type: 'streamable-http', url: 'https://x.com/mcp', headers: { 'X-Api-Version': '2' } } })
  );

  assert.deepEqual(result.ok && result.servers[0]?.headers, { 'X-Api-Version': '2' });
});

/* ------------------------------------------------------------------ *
 * PLUGIN_ROOT and PLUGIN_DATA
 * ------------------------------------------------------------------ */

test('expansion is a single non-recursive pass', () => {
  const roots = { pluginRoot: '/p', pluginData: '/d' };

  assert.equal(expandPluginVariables('${PLUGIN_ROOT}/bin', roots), '/p/bin');
  assert.equal(expandPluginVariables('${PLUGIN_DATA}/cache', roots), '/d/cache');
  assert.equal(expandPluginVariables('a${PLUGIN_ROOT}b${PLUGIN_DATA}c', roots), 'a/pb/dc');
  assert.equal(expandPluginVariables('nothing here', roots), 'nothing here');
  // Undefined placeholders are left alone rather than emptied — a value that
  // silently became "" would be far harder to debug than one that stayed literal.
  assert.equal(expandPluginVariables('${HOME}', roots), '${HOME}');
});

test('a value that expands into another placeholder is not expanded again', () => {
  // The property that stops a bundle smuggling a placeholder through a variable
  // it also controls.
  assert.equal(
    expandPluginVariables('${PLUGIN_ROOT}', { pluginRoot: '${PLUGIN_DATA}', pluginData: '/secret' }),
    '${PLUGIN_DATA}'
  );
});

test('the variables are expanded in args, env values and cwd', (t) => {
  const root = agentPlugin(workspace(t), {}, {
    mcpServers: {
      s: {
        type: 'stdio',
        command: 'node',
        args: ['./s.js', '--data=${PLUGIN_DATA}', '--root=${PLUGIN_ROOT}'],
        env: { CACHE: '${PLUGIN_DATA}/cache' },
        cwd: '${PLUGIN_ROOT}'
      }
    }
  });

  // `plugin.root`, not the tmpdir string: the loader realpaths the bundle root
  // up front, and on macOS `/var` resolves to `/private/var`.
  const plugin = load(root);
  const [server] = plugin.mcpServers;

  assert.ok(server.args[1].endsWith('/plugin-data/hello-plugin'), server.args[1]);
  assert.equal(server.args[2], `--root=${plugin.root}`);
  assert.ok(server.env.CACHE.endsWith('/plugin-data/hello-plugin/cache'), server.env.CACHE);
  assert.equal(server.cwd, plugin.root);
});

test('a plugin may not set the reserved variables itself', () => {
  for (const name of ['PLUGIN_ROOT', 'PLUGIN_DATA']) {
    const result = parsePluginMcpServers(
      JSON.stringify({ s: { type: 'stdio', command: 'node', env: { [name]: '/somewhere/else' } } })
    );

    assert.deepEqual(result.ok && result.servers, [], name);
  }
});

test('the reserved variables are written after the plugin env, not before', () => {
  // Normative ordering: "overlay configured env on base environment, then set
  // reserved variables". A bundle that slipped one past the parser still cannot
  // redirect it here.
  const env = buildMcpServerEnv(
    { env: { PLUGIN_ROOT: '/attacker', KEEP: 'yes' }, envVars: [], pluginRoot: '/real', pluginDataDir: '/data' },
    {},
    'darwin'
  );

  assert.equal(env.PLUGIN_ROOT, '/real');
  assert.equal(env.PLUGIN_DATA, '/data');
  assert.equal(env.KEEP, 'yes');
});

test('a non-plugin server gets neither variable', () => {
  const env = buildMcpServerEnv({ env: {}, envVars: [] }, {}, 'darwin');

  assert.equal('PLUGIN_ROOT' in env, false);
  assert.equal('PLUGIN_DATA' in env, false);
});

test('a ${PLUGIN_DATA} working directory may not escape the data directory', (t) => {
  const root = agentPlugin(workspace(t), {}, {
    mcpServers: { s: { type: 'stdio', command: 'node', cwd: '${PLUGIN_DATA}/../../../etc' } }
  });

  assert.deepEqual(load(root).mcpServers, [], 'the placeholder chooses the base, it does not waive the check');
});

/* ------------------------------------------------------------------ *
 * Skills
 * ------------------------------------------------------------------ */

test('the full Agent Skills frontmatter is read', (t) => {
  const root = agentPlugin(workspace(t));
  write(
    root,
    'skills/greet/SKILL.md',
    [
      '---',
      'name: greet',
      'description: Say hello.',
      'license: Apache-2.0',
      'compatibility: Requires git and network access',
      'allowed-tools: Bash(git:*) Read',
      '---',
      'Body.'
    ].join('\n')
  );

  const [skill] = load(root).skills;

  assert.equal(skill.license, 'Apache-2.0');
  assert.equal(skill.compatibility, 'Requires git and network access');
  assert.deepEqual(skill.allowedTools, ['Bash(git:*)', 'Read']);
});

test('a skill whose name disagrees with its directory is reported, not dropped', (t) => {
  const root = agentPlugin(workspace(t));
  write(root, 'skills/greet/SKILL.md', ['---', 'name: hello', 'description: d', '---', 'b'].join('\n'));

  const plugin = load(root);

  assert.equal(plugin.skills.length, 1, 'a confusing bundle is not a broken one');
  assert.match(plugin.warnings.join(' '), /calls itself "hello"/);
});

test('the Agent Skills name production', () => {
  for (const good of ['a', 'pdf-processing', 'x9']) {
    assert.ok(isAgentSkillName(good), good);
  }

  for (const bad of ['', 'PDF', '-pdf', 'pdf-', 'pdf--processing', 'has.dot', 'x'.repeat(65)]) {
    assert.equal(isAgentSkillName(bad), false, bad);
  }
});

test('only immediate children of skills/ are skills', (t) => {
  const root = agentPlugin(workspace(t));
  write(root, 'skills/nested/deeper/SKILL.md', SKILL);

  // "no recursive searching" — a SKILL.md two levels down is not a skill, and
  // walking for one would turn discovery into a tree scan.
  assert.deepEqual(load(root).skills.map((skill) => skill.name), ['greet']);
});

test('skill resources sit beside SKILL.md and are reachable', (t) => {
  const root = agentPlugin(workspace(t));
  write(root, 'skills/greet/references/REFERENCE.md', '# details');
  write(root, 'skills/greet/scripts/run.sh', 'echo hi');

  const [skill] = load(root).skills;

  // The skill is a *folder*. `load_skill` hands the model the directory so
  // `references/` and `scripts/` can be opened; without it a skill that says
  // "see references/REFERENCE.md" is pointing at nothing.
  assert.ok(skill.path.endsWith(join('skills', 'greet', 'SKILL.md')));
});

/* ------------------------------------------------------------------ *
 * Failure isolation, end to end
 * ------------------------------------------------------------------ */

test('an unsupported mcp.json schema disables MCP and leaves the skills alone', (t) => {
  const root = agentPlugin(workspace(t));
  write(
    root,
    'mcp.json',
    JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/9.9.9/mcp.schema.json',
      mcpServers: { s: { type: 'stdio', command: 'node' } }
    })
  );

  const plugin = load(root);

  assert.deepEqual(plugin.mcpServers, []);
  assert.equal(plugin.skills.length, 1, 'skills do not stop being readable');
  assert.match(plugin.warnings.join(' '), /servers were not loaded/);
});

test('a broken skill and a broken server cost only themselves', (t) => {
  const root = agentPlugin(workspace(t), {}, {
    mcpServers: {
      good: { type: 'stdio', command: 'node', args: ['./s.js'] },
      bad: { type: 'stdio' }
    }
  });
  write(root, 'skills/broken/SKILL.md', '# no frontmatter');

  const plugin = load(root);

  assert.deepEqual(plugin.skills.map((skill) => skill.name), ['greet']);
  assert.deepEqual(plugin.mcpServers.map((server) => server.key), ['good']);
  assert.equal(plugin.warnings.length, 2, plugin.warnings.join(' | '));
});
