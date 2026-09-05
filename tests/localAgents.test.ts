import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalAgentController } from '../src/main/ai/agents/localAgentController.js';
import { detectLocalAgent, parseCliVersion } from '../src/main/ai/agents/localAgentDetection.js';
import type { AcpClient } from '../src/main/ai/acp/acpClient.js';
import type { ProviderRegistry } from '../src/main/ai/core/providerRegistry.js';
import type { LocalAgentSessionsRepo } from '../src/main/db/repositories/localAgentSessionsRepo.js';
import type { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';
import { LOCAL_AGENTS } from '../src/shared/localAgents.js';
import {
  defaultLocalAgentSettings,
  parseLocalAgentSettings
} from '../src/shared/localAgentsSchema.js';

/* ------------------------------------------------------------------ *
 * Settings schema
 * ------------------------------------------------------------------ */

test('local agent settings default an empty blob and strip unknown keys', () => {
  const parsed = parseLocalAgentSettings({ mysteryField: true });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.settings, defaultLocalAgentSettings());
  assert.deepEqual(Object.keys(parsed.settings).sort(), [
    'acpCommand',
    'binaryPath',
    'color',
    'customModels',
    'displayName',
    'enabled',
    'env',
    'homePath',
    'launchArgs'
  ]);
});

test('only known accent colors are accepted', () => {
  assert.ok(parseLocalAgentSettings({ color: 'purple' }).ok);
  assert.ok(parseLocalAgentSettings({ color: '' }).ok);
  assert.equal(parseLocalAgentSettings({ color: 'chartreuse' }).ok, false);
});

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

test('version parsing survives every shipped CLI format', () => {
  assert.equal(parseCliVersion('1.18.28'), '1.18.28');
  assert.equal(parseCliVersion('2.1.261 (Claude Code)'), '2.1.261');
  assert.equal(parseCliVersion('codex-cli 0.148.0'), '0.148.0');
  assert.equal(parseCliVersion('2026.05.09-0afadcc'), '2026.05.09-0afadcc');
  assert.equal(parseCliVersion('grok 1.0.5 (5115b46bc909)'), '1.0.5');
  assert.equal(parseCliVersion('no version here'), null);
});

test('a command that resolves but refuses --version still counts as installed', async () => {
  const detection = await detectLocalAgent(
    { command: 'weird', versionArgs: ['--version'] },
    {
      lookup: async () => '/usr/local/bin/weird',
      run: async () => ({ code: 1, stdout: '', stderr: 'unknown flag' }),
      now: () => new Date('2026-01-01T00:00:00.000Z')
    }
  );
  assert.equal(detection.installed, true);
  assert.equal(detection.version, null);
  assert.equal(detection.resolvedPath, '/usr/local/bin/weird');
  assert.equal(detection.checkedAt, '2026-01-01T00:00:00.000Z');
});

test('a command nothing resolves is reported missing, and never run', async () => {
  let ran = false;
  const detection = await detectLocalAgent(
    { command: 'missing', versionArgs: ['--version'] },
    {
      lookup: async () => null,
      run: async () => {
        ran = true;
        return { code: 0, stdout: '1.0.0', stderr: '' };
      }
    }
  );
  assert.equal(detection.installed, false);
  assert.equal(detection.version, null);
  assert.equal(detection.resolvedPath, null);
  assert.equal(ran, false);
});

/* ------------------------------------------------------------------ *
 * Controller
 * ------------------------------------------------------------------ */

function fakeSettingsRepo(initial: Record<string, unknown> = {}) {
  let record = { ...initial };
  return {
    getLocalAgentSettingsRecord(): Record<string, unknown> {
      return record;
    },
    setLocalAgentSettings(agentId: string, settings: unknown) {
      record = { ...record, [agentId]: settings };
    }
  } as unknown as SettingsRepo;
}

function fakeClient(catalog: Array<{ value: string; name: string }> = []) {
  const calls = { started: 0, sessions: 0, closed: 0 };
  return {
    calls,
    start: async () => {
      calls.started++;
    },
    stop: async () => {},
    createSession: async () => {
      calls.sessions++;
      return { sessionId: 'sess-1', models: catalog };
    },
    resumeSession: async (sessionId: string) => ({ sessionId, models: catalog }),
    closeSession: async () => {
      calls.closed++;
    },
    setSessionModel: async () => {},
    sendPrompt: async function* () {},
    cancelSession: async () => {},
    resolvePermission: () => {}
  };
}

const NOOP_SESSIONS = {
  get: () => null,
  set: () => {},
  clear: () => {}
} as unknown as LocalAgentSessionsRepo;

function makeController(
  options: {
    client?: unknown;
    installed?: boolean;
    initialSettings?: Record<string, unknown>;
  } = {}
) {
  const settingsRepo = fakeSettingsRepo(options.initialSettings);
  const registry: ProviderRegistry = new Map();
  const controller = new LocalAgentController({
    settingsRepo,
    sessions: NOOP_SESSIONS,
    registry,
    defaultDirectory: () => '/workspace',
    detectionDeps: {
      lookup: async (cmd) => (options.installed === false ? null : `/bin/${cmd}`),
      run: async () => ({ code: 0, stdout: '1.0.0', stderr: '' })
    },
    ...(options.client ? { createAcpClient: () => options.client as AcpClient } : {})
  });
  return { controller, registry, settingsRepo };
}

test('the list covers the whole catalog and carries detection per agent', async () => {
  const { controller } = makeController();
  const rows = await controller.list();

  assert.deepEqual(
    rows.map((row) => row.id),
    LOCAL_AGENTS.map((agent) => agent.id)
  );
  assert.ok(rows.every((row) => row.detection.installed));
  assert.ok(rows.every((row) => row.enabled === false));

  const claude = rows.find((row) => row.id === 'claude-code');
  assert.equal(claude?.acpCommandDefault, null);
  assert.equal(claude?.transport, 'sdk');
});

test('an agent with no transport cannot be enabled, and stays out of the registry', async () => {
  const { controller, registry } = makeController();

  await assert.rejects(
    () => controller.update({ agentId: 'cursor', enabled: true }),
    /cannot run turns/i
  );
  assert.equal(registry.has('cursor'), false);
});

test('enabling Claude Code registers its adapter; disabling retires it', async () => {
  const { controller, registry } = makeController();

  const rows = await controller.update({ agentId: 'claude-code', enabled: true });
  assert.equal(rows.find((row) => row.id === 'claude-code')?.enabled, true);

  const adapter = registry.get('claude-code');
  assert.ok(adapter, 'the adapter is registered while the agent is on');
  assert.equal(adapter?.providerId, 'claude-code');

  // A second sync must not swap the instance out from under a live turn.
  await controller.syncRegistry();
  assert.equal(registry.get('claude-code'), adapter);

  await controller.update({ agentId: 'claude-code', enabled: false });
  assert.equal(registry.has('claude-code'), false);
});

test('a disabled agent never spawns anything, even to probe', async () => {
  const client = fakeClient();
  const { controller } = makeController({ client, installed: false });

  const result = await controller.probe('claude-code');
  assert.equal(result.installed, false);
  assert.equal(result.status, 'error');
  assert.match(result.message ?? '', /not installed/i);
});

test('probing a detect-only agent explains itself instead of failing', async () => {
  const { controller } = makeController();
  const result = await controller.probe('codex');

  assert.equal(result.installed, true);
  assert.equal(result.status, 'warning');
  assert.match(result.message ?? '', /app-server protocol/i);
});

test('probing Claude Code counts default or discovered models', async () => {
  const { controller } = makeController();

  const result = await controller.probe('claude-code');
  assert.equal(result.status, 'ready');
  assert.ok(result.modelCount >= 4);

  await controller.shutdown();
});

test('the Claude adapter lists discovered models plus any hand-typed ids', async () => {
  const { controller, registry } = makeController();

  await controller.update({
    agentId: 'claude-code',
    enabled: true,
    customModels: ['some-internal-build']
  });

  const models = await registry.get('claude-code')!.listModels('');
  assert.ok(models.some((m) => m.id === 'sonnet'));
  assert.ok(models.some((m) => m.id === 'some-internal-build'));
  assert.ok(models.every((model) => model.providerId === 'claude-code'));

  await controller.shutdown();
});

test('detection is cached per command, so a burst of saves is not a burst of shells', async () => {
  let lookups = 0;
  const registry: ProviderRegistry = new Map();
  const controller = new LocalAgentController({
    settingsRepo: fakeSettingsRepo(),
    sessions: NOOP_SESSIONS,
    registry,
    defaultDirectory: () => '/workspace',
    detectionDeps: {
      lookup: async () => {
        lookups++;
        return '/bin/claude';
      },
      run: async () => ({ code: 0, stdout: '1.0.0', stderr: '' })
    }
  });

  await controller.list();
  await controller.list();
  await controller.list();
  // One lookup per catalog agent on the first list; none on the cached next two.
  assert.equal(lookups, LOCAL_AGENTS.length);
});

test('invalid settings are rejected whole, leaving the stored blob untouched', async () => {
  const { controller, settingsRepo } = makeController();

  await assert.rejects(
    () => controller.update({ agentId: 'claude-code', color: 'chartreuse' as unknown as '' }),
    /Invalid/
  );
  assert.equal(settingsRepo.getLocalAgentSettingsRecord()['claude-code'], undefined);
});
