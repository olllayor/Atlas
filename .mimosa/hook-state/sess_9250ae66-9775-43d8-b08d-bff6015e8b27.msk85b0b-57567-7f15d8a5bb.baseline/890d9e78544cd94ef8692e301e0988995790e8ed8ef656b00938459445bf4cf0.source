import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gitPushToolExecute,
  githubPrCreateToolExecute,
  githubPrStatusToolExecute
} from '../src/main/ai/tools/githubTools.js';
import { GitHubService, type CommandRunner } from '../src/main/workspace/GitHubCli.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

const CODE_WORKSPACE: ToolWorkspace = { mode: 'code', root: '/repo' };
const WORK_WORKSPACE: ToolWorkspace = { mode: 'work', root: null };

const PR_JSON = JSON.stringify([
  {
    number: 12,
    title: 'Add worktrees',
    url: 'https://github.com/o/r/pull/12',
    isDraft: false,
    headRefName: 'feature',
    baseRefName: 'dev'
  }
]);

function buildService(script: Record<string, { code?: number; stdout?: string; stderr?: string }>) {
  const calls: { command: string; args: string[] }[] = [];

  const run: CommandRunner = async (command, args) => {
    calls.push({ command: command.split('/').pop()!, args });
    const key = [command.split('/').pop(), args[0], args[1]].filter(Boolean).join(' ');
    const exact = script[key] ?? script[`${command.split('/').pop()} ${args[0]}`];

    return {
      code: exact?.code ?? (exact ? 0 : 1),
      stdout: exact?.stdout ?? '',
      stderr: exact?.stderr ?? ''
    };
  };

  const service = new GitHubService({
    platform: 'darwin',
    pathDirs: ['/opt/homebrew/bin'],
    exists: (path) => path === '/opt/homebrew/bin/gh',
    run
  });

  return { service, calls };
}

const HEALTHY = {
  'gh auth status': { code: 0 },
  'git remote get-url': { code: 0, stdout: 'git@github.com:o/r.git\n' },
  'git rev-parse': { code: 0, stdout: 'feature\n' },
  'git push': { code: 0, stdout: 'Everything up-to-date' },
  'gh pr list': { code: 0, stdout: '[]' },
  'gh pr create': { code: 0, stdout: 'https://github.com/o/r/pull/99\n' }
} satisfies Record<string, { code?: number; stdout?: string }>;

test('github tools refuse to run without a project in code mode', async () => {
  const { service } = buildService(HEALTHY);

  await assert.rejects(
    () => githubPrStatusToolExecute({}, WORK_WORKSPACE, service),
    /project folder attached in Code mode/
  );
  await assert.rejects(
    () => githubPrCreateToolExecute({ title: 'x' }, undefined, service),
    /project folder attached in Code mode/
  );
});

test('status explains a missing gh rather than reporting no pull request', async () => {
  const { service } = buildService(HEALTHY);
  const offline = new GitHubService({
    platform: 'darwin',
    pathDirs: ['/opt/homebrew/bin'],
    exists: () => false,
    run: (service as unknown as { run: CommandRunner }).run
  });

  const output = await githubPrStatusToolExecute({}, CODE_WORKSPACE, offline);
  assert.match(output, /brew install gh/);
});

test('status explains a non-github remote', async () => {
  const { service } = buildService({
    ...HEALTHY,
    'git remote get-url': { code: 0, stdout: 'git@gitlab.com:g/p.git\n' }
  });

  const output = await githubPrStatusToolExecute({}, CODE_WORKSPACE, service);
  assert.match(output, /no GitHub `origin` remote/);
});

test('status reports the open pull request for the branch', async () => {
  const { service } = buildService({ ...HEALTHY, 'gh pr list': { code: 0, stdout: PR_JSON } });

  const output = await githubPrStatusToolExecute({}, CODE_WORKSPACE, service);
  assert.match(output, /#12/);
  assert.match(output, /Add worktrees/);
  assert.match(output, /https:\/\/github\.com\/o\/r\/pull\/12/);
});

test('creating a pull request pushes the branch first', async () => {
  const { service, calls } = buildService(HEALTHY);

  const output = await githubPrCreateToolExecute(
    { title: 'Add worktrees', body: 'Why this exists.' },
    CODE_WORKSPACE,
    service
  );

  const pushIndex = calls.findIndex((call) => call.command === 'git' && call.args[0] === 'push');
  const createIndex = calls.findIndex(
    (call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'create'
  );

  assert.ok(pushIndex >= 0, 'expected a push');
  assert.ok(createIndex >= 0, 'expected a pr create');
  assert.ok(pushIndex < createIndex, 'the branch must exist on the remote before the PR is opened');
  assert.match(output, /https:\/\/github\.com\/o\/r\/pull\/99/);
});

test('a non-github remote refuses pull request creation outright', async () => {
  const { service } = buildService({
    ...HEALTHY,
    'git remote get-url': { code: 0, stdout: 'git@gitlab.com:g/p.git\n' }
  });

  await assert.rejects(
    () => githubPrCreateToolExecute({ title: 'x' }, CODE_WORKSPACE, service),
    /supports GitHub only/
  );
});

test('a detached HEAD is refused with the fix named', async () => {
  const { service } = buildService({ ...HEALTHY, 'git rev-parse': { code: 0, stdout: 'HEAD\n' } });

  await assert.rejects(
    () => githubPrCreateToolExecute({ title: 'x' }, CODE_WORKSPACE, service),
    /detached/
  );
});

test('push defaults to the current branch', async () => {
  const { service, calls } = buildService(HEALTHY);

  await gitPushToolExecute({}, CODE_WORKSPACE, service);
  const push = calls.find((call) => call.command === 'git' && call.args[0] === 'push');

  assert.deepEqual(push?.args, ['push', '--set-upstream', 'origin', 'feature']);
});
