import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadPlugin, readPluginCapability } from '../src/main/plugins/PluginLoader.js';
import {
  CONNECTOR_UNAVAILABLE_NOTICE,
  classifyConnectorId,
  parsePluginConnectors,
  toConnectorDeclaration
} from '../src/shared/pluginConnectors.js';

/**
 * `.app.json` — read for display, never acted on.
 *
 * The shapes asserted here were read off the seven `.app.json` files in a real
 * Codex install rather than inferred, which is why there is no `scopes` case:
 * the format carries none.
 */

/* ------------------------------------------------------------------ *
 * Parsing the real vocabulary
 * ------------------------------------------------------------------ */

test('the minimal shape every observed file uses', () => {
  const result = parsePluginConnectors(
    JSON.stringify({ apps: { github: { id: 'connector_76869538009648d5b282a4bb21c3d157' } } })
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.connectors, [
    {
      key: 'github',
      id: 'connector_76869538009648d5b282a4bb21c3d157',
      kind: 'first-party-connector',
      capabilities: [],
      category: null,
      required: false
    }
  ]);
});

test('every optional field observed in the wild is read', () => {
  const result = parsePluginConnectors(
    JSON.stringify({
      apps: {
        default_templates: {
          id: 'connector_openai_default_templates',
          required: true,
          capabilities: ['read', 'write'],
          category: 'productivity'
        }
      }
    })
  );

  assert.deepEqual(result.ok && result.connectors[0], {
    key: 'default_templates',
    id: 'connector_openai_default_templates',
    kind: 'first-party-connector',
    capabilities: ['read', 'write'],
    category: 'productivity',
    required: true
  });
});

test('the two id families are told apart', () => {
  // Both are equally unreachable here, but they fail for different reasons and
  // someone debugging one benefits from knowing which they have.
  assert.equal(classifyConnectorId('connector_abc'), 'first-party-connector');
  assert.equal(classifyConnectorId('asdk_app_69e0086d87088191a3edc052fa50c29f'), 'apps-sdk-app');
  assert.equal(classifyConnectorId('something-else'), 'unknown');
});

test('a malformed entry costs that entry and nothing else', () => {
  const result = parsePluginConnectors(
    JSON.stringify({
      apps: {
        good: { id: 'connector_a' },
        noId: { required: true },
        notAnObject: 'nope',
        emptyId: { id: '   ' }
      }
    })
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.connectors.map((c) => c.key), ['good']);
});

test('a file with no apps key declares no connectors rather than failing', () => {
  const result = parsePluginConnectors(JSON.stringify({ something: 'else' }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.connectors, []);
});

test('unreadable JSON is fatal for the file, not for the plugin', () => {
  assert.equal(parsePluginConnectors('{').ok, false);
  assert.equal(parsePluginConnectors('[]').ok, false);
});

/* ------------------------------------------------------------------ *
 * The boundary: declarative only
 * ------------------------------------------------------------------ */

test('parsing creates no OAuth state and resolves nothing', () => {
  // The property worth keeping as the module grows: the parser returns values
  // read out of a string. There is no field here that could hold a token.
  const result = parsePluginConnectors(
    JSON.stringify({ apps: { github: { id: 'connector_a', access_token: 'secret-should-be-ignored' } } })
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(JSON.stringify(result.connectors).includes('secret-should-be-ignored'), false);
  assert.deepEqual(Object.keys(result.connectors[0]).sort(), [
    'capabilities',
    'category',
    'id',
    'key',
    'kind',
    'required'
  ]);
});

test('the notice says what Atlas cannot do, not what the plugin cannot do', () => {
  assert.match(CONNECTOR_UNAVAILABLE_NOTICE, /Atlas cannot perform this yet/);
});

/* ------------------------------------------------------------------ *
 * Loading, and staying refused
 * ------------------------------------------------------------------ */

function bundle(t: { after: (fn: () => void) => void }, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-connectors-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const [relative, contents] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }

  return dir;
}

const MANIFEST = JSON.stringify({ name: 'demo', version: '1.0.0', description: 'A demo' });
const SKILL = ['---', 'name: greet', 'description: Say hello.', '---', 'Body.'].join('\n');
const APPS = JSON.stringify({ apps: { github: { id: 'connector_a', capabilities: ['read'] } } });

test('a bundle with skills and a connector loads both', (t) => {
  const root = bundle(t, {
    '.codex-plugin/plugin.json': MANIFEST,
    'skills/greet/SKILL.md': SKILL,
    '.app.json': APPS
  });

  const result = loadPlugin(root);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.plugin.connectors.map((c) => c.key), ['github']);
  assert.equal(result.plugin.skills.length, 1);
  assert.deepEqual(result.plugin.warnings, []);
});

test('a connector-only bundle is still refused before install', (t) => {
  // Unchanged by surfacing them. Installing one is a no-op the user pays for:
  // 108 of the 180 plugins in one public catalogue are exactly this shape.
  const root = bundle(t, { '.codex-plugin/plugin.json': MANIFEST, '.app.json': APPS });

  assert.deepEqual(readPluginCapability(root), { usable: false });
});

test('a malformed .app.json is a warning, not a failed plugin', (t) => {
  const root = bundle(t, {
    '.codex-plugin/plugin.json': MANIFEST,
    'skills/greet/SKILL.md': SKILL,
    '.app.json': '{'
  });

  const result = loadPlugin(root);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.plugin.skills.length, 1, 'the skills still load');
  assert.deepEqual(result.plugin.connectors, []);
  assert.match(result.plugin.warnings.join(' '), /connector configuration is not valid JSON/);
});

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

test('a declaration records ids, version and the inspection time', () => {
  const record = toConnectorDeclaration(
    [
      { key: 'a', id: 'connector_a', kind: 'first-party-connector', capabilities: [], category: null, required: false },
      { key: 'b', id: 'asdk_app_b', kind: 'apps-sdk-app', capabilities: [], category: null, required: true }
    ],
    '2.1.0',
    '2026-08-07T00:00:00.000Z'
  );

  assert.deepEqual(record, {
    ids: ['connector_a', 'asdk_app_b'],
    version: '2.1.0',
    inspectedAt: '2026-08-07T00:00:00.000Z'
  });
});

test('a bundle declaring no connectors records nothing', () => {
  assert.equal(toConnectorDeclaration([], '1.0.0', '2026-08-07T00:00:00.000Z'), null);
});
