import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_RELEASE_VERSION,
  antigravityPlatformSupport,
  resolveAntigravityReleaseAsset
} from '../src/main/ai/providers/antigravity/antigravityRelease.js';
import {
  ANTIGRAVITY_PERSONAL_AUTH,
  antigravityAuthConfigIssue,
  antigravityAuthLabel,
  antigravityAuthUsesBrowser,
  antigravityEnvironment,
  antigravityProfileSettings,
  buildAntigravityAcpSpawnInput,
  buildAntigravityBrowserCommand,
  createAntigravityAuthorizationLineHandler,
  isAntigravitySignInRequiredError,
  parseAntigravityAuthorizationUrl,
  resolveAntigravityProfileDirectory,
  validateAntigravityBrowserCommand,
  ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE
} from '../src/main/ai/providers/antigravity/antigravityAuthSupport.js';
import {
  forwardAntigravityCallback,
  validateAntigravityCallbackUrl
} from '../src/main/ai/providers/antigravity/antigravityCallback.js';
import {
  antigravityApprovalOptions,
  antigravitySecurityWarning,
  extractAntigravityUserInputQuestion,
  isAntigravityUserInputRequest,
  makeAntigravityUserInputResponse,
  sanitizeAntigravityToolPayload,
  selectAntigravityPermissionOptionId
} from '../src/main/ai/providers/antigravity/antigravityProtocol.js';
import {
  ANTIGRAVITY_CHAT_DEFAULT_MODEL,
  isAntigravityCurrentModel,
  resolveAntigravityDefaultModel
} from '../src/main/ai/providers/antigravity/antigravityModels.js';
import { acpPermissionMode, ACP_AUDIO_MIME_TYPES } from '../src/main/ai/acp/acpClient.js';

test('release table pins the official 1.1.1 builds', () => {
  assert.equal(ANTIGRAVITY_RELEASE_VERSION, 'agy_acp_server_1.1.1');
  const linux = resolveAntigravityReleaseAsset('linux', 'x64');
  assert.ok(linux?.url.startsWith('https://dl.google.com/'));
  assert.equal(linux?.sha256.length, 64);
  const intelMac = antigravityPlatformSupport('darwin', 'x64');
  assert.equal(intelMac.supported, false);
  assert.match(
    (intelMac as { reason: string }).reason,
    /no Intel Mac build/i
  );
});

test('auth methods label and gate like T3', () => {
  assert.equal(antigravityAuthLabel('oauth-personal'), 'Google account');
  assert.equal(antigravityAuthUsesBrowser('oauth-personal'), true);
  assert.equal(antigravityAuthUsesBrowser('gemini-api-key'), false);
  assert.equal(antigravityAuthConfigIssue(ANTIGRAVITY_PERSONAL_AUTH), null);
  assert.match(
    antigravityAuthConfigIssue({ authMethod: 'gemini-api-key', apiKey: '', gcpProject: '', gcpLocation: '' }) ?? '',
    /API key/
  );
  assert.match(
    antigravityAuthConfigIssue({ authMethod: 'oauth-business', apiKey: '', gcpProject: '', gcpLocation: '' }) ?? '',
    /GCP project/
  );
});

test('auth URL handler accepts fragmented browser-helper stderr and rejects malformed lines', () => {
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=atlas-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2F';
  const received: string[] = [];
  const handler = createAntigravityAuthorizationLineHandler({
    onAuthorizationUrl: (value) => received.push(value)
  });
  handler('__ATLAS_ANTIGRAVITY_AUTH_URL__' + JSON.stringify(url).slice(0, 24));
  handler(JSON.stringify(url).slice(24) + '\nnoise\n');
  assert.deepEqual(received, [url]);

  const failing = createAntigravityAuthorizationLineHandler();
  assert.throws(
    () => failing(`__ATLAS_ANTIGRAVITY_AUTH_URL__${JSON.stringify(url)}\n`),
    new RegExp(ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE)
  );
  failing('__ATLAS_ANTIGRAVITY_AUTH_URL__"not a url"\n');
});

test('profile settings record auth type, never secrets', () => {
  const raw = antigravityProfileSettings({
    authMethod: 'oauth-business',
    apiKey: 'secret-should-not-appear',
    gcpProject: 'proj',
    gcpLocation: 'us-central1'
  });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.auth.type, 'oauth-business');
  assert.equal(parsed.gcp.project, 'proj');
  assert.ok(!raw.includes('secret-should-not-appear'));
});

test('profile directories are hashed per instance', () => {
  const a = resolveAntigravityProfileDirectory('/state', 'antigravity');
  const b = resolveAntigravityProfileDirectory('/state', 'antigravity');
  const c = resolveAntigravityProfileDirectory('/state', 'other');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a.includes('providers'));
});

test('environment strips ambient Google vars and injects only the picked credential', () => {
  const env = antigravityEnvironment(
    { geminiHome: '/profiles/x', browserCommand: 'BROWSER=x' },
    {
      PATH: '/bin',
      GOOGLE_API_KEY: 'ambient',
      GEMINI_API_KEY: 'ambient',
      BROWSER: 'ambient',
      KEEP: 'yes'
    },
    { authMethod: 'gemini-api-key', apiKey: 'picked', gcpProject: '', gcpLocation: '' }
  );
  assert.equal(env.GEMINI_API_KEY, 'picked');
  assert.equal(env.GOOGLE_API_KEY, undefined);
  assert.equal(env.BROWSER, 'BROWSER=x');
  assert.equal(env.GEMINI_HOME, '/profiles/x');
  assert.equal(env.AGY_ACP_FORCE_FILE_STORAGE, '1');
  assert.equal(env.KEEP, 'yes');
});

test('browser command rejects path separators like T3', () => {
  const command = buildAntigravityBrowserCommand('/app/runtime');
  assert.ok(command.includes('%s'));
  assert.equal(validateAntigravityBrowserCommand(command, '/app/runtime', 'linux'), null);
  assert.match(
    validateAntigravityBrowserCommand('a:b', '/app/runtime', 'linux') ?? '',
    /browser launches/
  );
});

test('OAuth authorization URLs validate strictly', () => {
  const good =
    'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=abc123&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2F&client_id=x';
  const parsed = parseAntigravityAuthorizationUrl(good);
  assert.equal(parsed.state, 'abc123');
  assert.equal(parsed.redirectUri, 'http://127.0.0.1:8080/');
  assert.throws(() => parseAntigravityAuthorizationUrl('https://evil.com/o/oauth2/v2/auth'), /invalid/);
  assert.throws(
    () => parseAntigravityAuthorizationUrl(good.replace('response_type=code', 'response_type=token')),
    /invalid/
  );
});

test('callback validation matches state and accepts code xor error', () => {
  const pending = { redirectUri: 'http://127.0.0.1:8080/', state: 's1' };
  const ok = validateAntigravityCallbackUrl(pending, 'http://127.0.0.1:8080/?code=c1&state=s1');
  assert.equal(ok.code, 'c1');
  assert.throws(
    () => validateAntigravityCallbackUrl(pending, 'http://127.0.0.1:8080/?code=c1&state=other'),
    /different sign-in/
  );
  assert.throws(
    () => validateAntigravityCallbackUrl(pending, 'http://127.0.0.1:8080/?state=s1'),
    /no usable sign-in result/
  );
});

test('callback forwarding hits the loopback server', async () => {
  const { createServer } = await import('node:http');
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url ?? '');
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await forwardAntigravityCallback(`http://127.0.0.1:${port}/?code=c&state=s`);
    assert.equal(seen.length, 1);
    await assert.rejects(
      forwardAntigravityCallback('https://example.com/callback'),
      /loopback/
    );
  } finally {
    server.close();
  }
});

test('protocol routes interaction_ to questions, not approvals', () => {
  const question = {
    toolCallId: 'interaction_1',
    title: 'Pick one',
    options: [
      { optionId: 'a', kind: 'x', name: 'Alpha' },
      { optionId: 'b', kind: 'y', name: 'Beta' }
    ]
  };
  assert.equal(isAntigravityUserInputRequest(question), true);
  assert.deepEqual(antigravityApprovalOptions(question), []);
  assert.equal(selectAntigravityPermissionOptionId(question, 'accept'), undefined);
  const extracted = extractAntigravityUserInputQuestion(question);
  assert.equal(extracted?.allowCustomAnswer, false);
  assert.equal(extracted?.options.length, 2);
  const response = makeAntigravityUserInputResponse(question, { interaction_1: 'b' });
  assert.equal(response?.outcome.optionId, 'b');
  assert.equal(makeAntigravityUserInputResponse(question, { interaction_1: 'nope' }), undefined);
});

test('approval options map kinds and surface the security warning', () => {
  const request = {
    toolCallId: 'call_1',
    title: 'Run command',
    options: [
      { optionId: 'o1', kind: 'allow_once', name: 'Allow once' },
      {
        optionId: 'o2',
        kind: 'allow_always',
        name: 'Allow always',
        meta: { 'agy.security.warning': { message: 'Prompt injection risk' } }
      },
      { optionId: 'o3', kind: 'reject_once', name: 'Deny' }
    ]
  };
  const options = antigravityApprovalOptions(request);
  assert.deepEqual(options.map((o) => o.decision), ['accept', 'acceptForSession', 'decline', 'cancel']);
  assert.equal(options[1]?.warning, 'Prompt injection risk');
  assert.equal(selectAntigravityPermissionOptionId(request, 'accept'), 'o1');
  assert.equal(selectAntigravityPermissionOptionId(request, 'acceptForSession'), 'o2');
  assert.equal(selectAntigravityPermissionOptionId(request, 'decline'), 'o3');
  assert.equal(
    antigravitySecurityWarning(request.options[1]!),
    'Prompt injection risk'
  );
});

test('tool payloads are bounded and drop image blobs', () => {
  const payload = sanitizeAntigravityToolPayload({
    type: 'text',
    text: 'x'.repeat(100_000),
    nested: { data: 'data:image/png;base64,AAA' }
  }) as Record<string, unknown>;
  assert.ok((payload.text as string).startsWith('[Earlier output truncated]'));
  assert.equal((payload.nested as Record<string, unknown>).data, undefined);
});

test('model manifest names 3.8 Flash current with High as chat default', () => {
  assert.equal(ANTIGRAVITY_CHAT_DEFAULT_MODEL, 'gemini-3.8-flash-high');
  assert.equal(isAntigravityCurrentModel('gemini-3.8-flash-high'), true);
  assert.equal(isAntigravityCurrentModel('gemini-3.7-flash-high'), false);
  assert.equal(
    resolveAntigravityDefaultModel(['gemini-3.7-flash-high', 'gemini-3.8-flash-high'], 'gemini-3.7-flash-high'),
    'gemini-3.8-flash-high'
  );
  assert.equal(resolveAntigravityDefaultModel(['gemini-3.7-flash-high'], 'gemini-3.7-flash-high'), 'gemini-3.7-flash-high');
});

test('permission modes map onto the agent modes', () => {
  assert.equal(acpPermissionMode('full-access'), 'yolo');
  assert.equal(acpPermissionMode('auto-accept-edits'), 'auto_edit');
  assert.equal(acpPermissionMode('ask'), 'default');
  assert.ok(ACP_AUDIO_MIME_TYPES.has('audio/wav'));
});

test('sign-in errors are recognized', () => {
  assert.equal(
    isAntigravitySignInRequiredError(new Error(ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE)),
    true
  );
  assert.equal(isAntigravitySignInRequiredError(new Error('request failed -32000')), true);
  assert.equal(isAntigravitySignInRequiredError(new Error('all good')), false);
});

test('spawn input pins linux --uid and the harness path', () => {
  const plan = buildAntigravityAcpSpawnInput({
    executablePath: '/tools/exe',
    harnessPath: '/tools/harness',
    profile: {
      platform: 'linux',
      geminiHome: '/profiles/x',
      acpDirectory: '/profiles/x/antigravity-acp',
      tokenPath: '/profiles/x/antigravity-acp/acp_token.json',
      browserCommand: 'BROWSER=x'
    },
    cwd: '/work'
  });
  assert.deepEqual(plan.args, ['--uid=']);
  assert.equal(plan.env.ANTIGRAVITY_HARNESS_PATH, '/tools/harness');
});
