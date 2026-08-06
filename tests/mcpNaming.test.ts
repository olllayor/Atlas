import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_TOOL_NAME_LENGTH,
  buildMcpServerEnv,
  defaultMcpEnvVars,
  isMcpToolName,
  isValidMcpCommand,
  mcpToolNeedsApproval,
  namespaceMcpTool,
  sanitizeToolNamePart
} from '../src/shared/mcp.js';

test('a tool is namespaced under its server', () => {
  assert.equal(namespaceMcpTool('github', 'create_issue'), 'mcp__github__create_issue');
  assert.ok(isMcpToolName(namespaceMcpTool('github', 'create_issue')));
  assert.ok(!isMcpToolName('read_file'));
});

test('a server cannot impersonate a built-in tool', () => {
  // The whole point of the prefix: this must not come out as `read_file`.
  assert.notEqual(namespaceMcpTool('evil', 'read_file'), 'read_file');
  assert.ok(namespaceMcpTool('evil', 'read_file').startsWith('mcp__'));
});

test('characters a provider will not accept become underscores', () => {
  assert.equal(sanitizeToolNamePart('my-server.v2'), 'my_server_v2');
  assert.equal(namespaceMcpTool('my server', 'do/thing'), 'mcp__my_server__do_thing');
});

test('overlong names are truncated but stay distinct', () => {
  const server = 'a'.repeat(40);
  const first = namespaceMcpTool(server, `${'b'.repeat(40)}_one`);
  const second = namespaceMcpTool(server, `${'b'.repeat(40)}_two`);

  assert.equal(first.length, MAX_TOOL_NAME_LENGTH);
  assert.equal(second.length, MAX_TOOL_NAME_LENGTH);
  assert.notEqual(first, second, 'truncation must not collide two different tools');
});

test('namespacing is stable across calls', () => {
  const server = 'x'.repeat(60);
  assert.equal(namespaceMcpTool(server, 'tool'), namespaceMcpTool(server, 'tool'));
});

test('an unannotated tool is treated as unknown, not as safe', () => {
  assert.equal(mcpToolNeedsApproval('auto', undefined), true);
  assert.equal(mcpToolNeedsApproval('auto', {}), true);
  assert.equal(mcpToolNeedsApproval('auto', { readOnlyHint: false }), true);
  assert.equal(mcpToolNeedsApproval('auto', { readOnlyHint: true }), false);
});

test('the approval stances behave as configured', () => {
  assert.equal(mcpToolNeedsApproval('prompt', { readOnlyHint: true }), true);
  assert.equal(mcpToolNeedsApproval('approve', undefined), false);
  assert.equal(mcpToolNeedsApproval('writes', { readOnlyHint: true }), false);
  assert.equal(mcpToolNeedsApproval('writes', undefined), true);
});

test('a spawned server gets an allowlist, never the whole environment', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/Users/test',
    ANTHROPIC_API_KEY: 'sk-should-not-leak',
    OPENROUTER_API_KEY: 'sk-also-not',
    TERM: 'xterm'
  };

  const env = buildMcpServerEnv({ env: {}, envVars: [] }, source, 'darwin');

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/Users/test');
  assert.equal(env.TERM, 'xterm');
  assert.equal(env.ANTHROPIC_API_KEY, undefined, 'provider keys must not reach third-party servers');
  assert.equal(env.OPENROUTER_API_KEY, undefined);
});

test('a variable is forwarded only when the server declares it', () => {
  const source = { PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_x' };

  assert.equal(buildMcpServerEnv({ env: {}, envVars: [] }, source, 'darwin').GITHUB_TOKEN, undefined);
  assert.equal(
    buildMcpServerEnv({ env: {}, envVars: ['GITHUB_TOKEN'] }, source, 'darwin').GITHUB_TOKEN,
    'ghp_x'
  );
});

test('literal values win over forwarded ones', () => {
  const env = buildMcpServerEnv(
    { env: { PATH: '/custom/bin' }, envVars: [] },
    { PATH: '/usr/bin' },
    'darwin'
  );

  assert.equal(env.PATH, '/custom/bin');
});

test('an undeclared variable that is unset does not appear as empty', () => {
  const env = buildMcpServerEnv({ env: {}, envVars: ['MISSING_VAR'] }, { PATH: '/usr/bin' }, 'darwin');
  assert.ok(!('MISSING_VAR' in env));
});

test('windows and unix carry different allowlists', () => {
  assert.ok(defaultMcpEnvVars('darwin').includes('HOME'));
  assert.ok(defaultMcpEnvVars('win32').includes('USERPROFILE'));
  assert.ok(!defaultMcpEnvVars('win32').includes('LOGNAME'));
});

test('shell metacharacters are refused in a command', () => {
  assert.equal(isValidMcpCommand('npx'), true);
  assert.equal(isValidMcpCommand('/usr/local/bin/my-server'), true);
  assert.equal(isValidMcpCommand(''), false);
  assert.equal(isValidMcpCommand('  '), false);

  for (const bad of ['rm -rf /; echo', 'a && b', 'a | b', 'a > b', '$(whoami)', '`id`', 'a\nb']) {
    assert.equal(isValidMcpCommand(bad), false, bad);
  }
});

test('arguments are split into a list, with quoting honoured', async () => {
  const { parseMcpArgs } = await import('../src/shared/mcp.js');

  assert.deepEqual(parseMcpArgs('-y @modelcontextprotocol/server-github'), [
    '-y',
    '@modelcontextprotocol/server-github'
  ]);
  assert.deepEqual(parseMcpArgs('--dir "/Users/me/My Files"'), ['--dir', '/Users/me/My Files']);
  assert.deepEqual(parseMcpArgs("--msg 'hello world'"), ['--msg', 'hello world']);
  assert.deepEqual(parseMcpArgs('   '), []);

  // Shell syntax survives as literal text: it is one argument, not an operator,
  // because there is no shell on the other side to interpret it.
  assert.deepEqual(parseMcpArgs('a; rm -rf /'), ['a;', 'rm', '-rf', '/']);
});
