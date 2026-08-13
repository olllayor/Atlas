import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GitHubService,
  assertNotFlag,
  detectGhBinary,
  parseGitHubSlug,
  type CommandRunner
} from '../src/main/workspace/GitHubCli.js';

type Invocation = { command: string; args: string[]; cwd?: string };

/**
 * A scripted `gh`/`git`, keyed by the first two argv words.
 *
 * Anything unscripted comes back as exit 1 rather than throwing, which is what
 * a real CLI does for an unknown subcommand and keeps the failure paths honest.
 */
function fakeRunner(script: Record<string, { code?: number; stdout?: string; stderr?: string }>) {
  const calls: Invocation[] = [];

  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    const key = [command.split('/').pop(), args[0], args[1]].filter(Boolean).join(' ');
    const exact = script[key] ?? script[`${command.split('/').pop()} ${args[0]}`];

    return {
      code: exact?.code ?? (exact ? 0 : 1),
      stdout: exact?.stdout ?? '',
      stderr: exact?.stderr ?? ''
    };
  };

  return { run, calls };
}

function serviceWith(
  script: Parameters<typeof fakeRunner>[0],
  present: string[] = ['/opt/homebrew/bin/gh']
) {
  const { run, calls } = fakeRunner(script);
  const found = new Set(present);

  const service = new GitHubService({
    platform: 'darwin',
    pathDirs: ['/opt/homebrew/bin'],
    exists: (path) => found.has(path),
    run
  });

  return { service, calls };
}

test('gh is found in the directories a GUI app does not inherit', () => {
  const binary = detectGhBinary({
    platform: 'darwin',
    pathDirs: ['/opt/homebrew/bin'],
    exists: (path) => path === '/opt/homebrew/bin/gh'
  });

  assert.equal(binary, '/opt/homebrew/bin/gh');
});

test('a machine without gh reports null rather than guessing a path', () => {
  const binary = detectGhBinary({
    platform: 'darwin',
    pathDirs: ['/opt/homebrew/bin'],
    exists: () => false
  });

  assert.equal(binary, null);
});

test('windows looks for gh.exe', () => {
  const seen: string[] = [];

  detectGhBinary({
    platform: 'win32',
    pathDirs: ['C:\\tools'],
    exists: (path) => {
      seen.push(path);
      return false;
    }
  });

  assert.ok(seen.every((path) => path.endsWith('gh.exe')));
});

test('every github remote spelling resolves to the same slug', () => {
  for (const url of [
    'https://github.com/pingdotgg/t3code.git',
    'https://github.com/pingdotgg/t3code',
    'git@github.com:pingdotgg/t3code.git',
    'ssh://git@github.com/pingdotgg/t3code.git'
  ]) {
    assert.deepEqual(parseGitHubSlug(url), { owner: 'pingdotgg', repo: 't3code' }, url);
  }
});

test('a non-github remote is not a github repository', () => {
  assert.equal(parseGitHubSlug('git@gitlab.com:group/project.git'), null);
  assert.equal(parseGitHubSlug('https://bitbucket.org/team/repo.git'), null);
  assert.equal(parseGitHubSlug(''), null);
  // A lookalike host must not pass: the check is the whole GitHub-only gate.
  assert.equal(parseGitHubSlug('https://github.com.evil.test/owner/repo'), null);
});

test('values that would read as flags are refused', () => {
  assert.throws(() => assertNotFlag('--force', 'branch name'), /cannot start with/);
  assert.throws(() => assertNotFlag('   ', 'branch name'), /required/);
  assert.equal(assertNotFlag('  feature/x  ', 'branch name'), 'feature/x');
});

test('an installed but signed-out gh is reported as such', async () => {
  const { service } = serviceWith({ 'gh auth status': { code: 1, stderr: 'not logged in' } });
  assert.deepEqual(await service.getStatus(), { installed: true, authenticated: false });
});

test('detection is cached so the toolbar does not spawn gh per render', async () => {
  const { service, calls } = serviceWith({ 'gh auth status': { code: 0 } });

  await service.getStatus(1_000);
  await service.getStatus(1_500);
  assert.equal(calls.filter((call) => call.args[0] === 'auth').length, 1);

  // Past the TTL the probe runs again, so a `gh auth login` is picked up.
  await service.getStatus(1_000 + 60_000);
  assert.equal(calls.filter((call) => call.args[0] === 'auth').length, 2);
});

test('a missing gh names the fix instead of failing opaquely', async () => {
  const { service } = serviceWith({}, []);
  await assert.rejects(() => service.findOpenPr('/repo', 'main'), /brew install gh/);
});

test('a signed-out gh names the fix instead of failing opaquely', async () => {
  const { service } = serviceWith({ 'gh auth status': { code: 1 } });
  await assert.rejects(() => service.findOpenPr('/repo', 'main'), /gh auth login/);
});

test('an open pull request is parsed out of the gh json', async () => {
  const { service } = serviceWith({
    'gh auth status': { code: 0 },
    'gh pr list': {
      code: 0,
      stdout: JSON.stringify([
        {
          number: 42,
          title: 'Add checkpoints',
          url: 'https://github.com/o/r/pull/42',
          isDraft: true,
          headRefName: 'feature',
          baseRefName: 'dev'
        }
      ])
    }
  });

  const pr = await service.findOpenPr('/repo', 'feature');
  assert.equal(pr?.number, 42);
  assert.equal(pr?.isDraft, true);
  assert.equal(pr?.baseRefName, 'dev');
});

test('no open pull request is null, not an error', async () => {
  const { service } = serviceWith({
    'gh auth status': { code: 0 },
    'gh pr list': { code: 0, stdout: '[]' }
  });

  assert.equal(await service.findOpenPr('/repo', 'feature'), null);
});

test('a detached HEAD has no branch to open a pull request from', async () => {
  const { service } = serviceWith({
    'gh auth status': { code: 0 },
    'git rev-parse': { code: 0, stdout: 'HEAD\n' }
  });

  assert.equal(await service.getCurrentBranch('/repo'), null);
});

test('force pushing uses a lease so unseen commits survive', async () => {
  const { service, calls } = serviceWith({
    'gh auth status': { code: 0 },
    'git push': { code: 0, stdout: 'ok' }
  });

  await service.pushBranch('/repo', 'feature', true);
  const push = calls.find((call) => call.args[0] === 'push');

  assert.ok(push);
  assert.ok(push.args.includes('--force-with-lease'));
  assert.ok(!push.args.includes('--force'));
});

test('an existing pull request is returned instead of failing the create', async () => {
  const { service, calls } = serviceWith({
    'gh auth status': { code: 0 },
    'gh pr list': {
      code: 0,
      stdout: JSON.stringify([
        {
          number: 7,
          title: 'Existing',
          url: 'https://github.com/o/r/pull/7',
          isDraft: false,
          headRefName: 'feature',
          baseRefName: 'dev'
        }
      ])
    }
  });

  const result = await service.createPr('/repo', {
    title: 'New',
    body: 'body',
    branch: 'feature'
  });

  assert.equal(result.alreadyExisted, true);
  assert.equal(result.pr?.number, 7);
  assert.ok(!calls.some((call) => call.args[0] === 'pr' && call.args[1] === 'create'));
});

test('the pull request body travels as a file, never as argv', async () => {
  const { service, calls } = serviceWith({
    'gh auth status': { code: 0 },
    'gh pr list': { code: 0, stdout: '[]' },
    'gh pr create': { code: 0, stdout: 'https://github.com/o/r/pull/9\n' }
  });

  const body = 'line one\n\nline two with "quotes" and $VARS';
  const result = await service.createPr('/repo', {
    title: 'Title',
    body,
    base: 'dev',
    draft: true,
    branch: 'feature'
  });

  const create = calls.find((call) => call.args[0] === 'pr' && call.args[1] === 'create');
  assert.ok(create);
  assert.ok(create.args.includes('--body-file'));
  assert.ok(!create.args.includes('--body'));
  assert.ok(!create.args.some((arg) => arg.includes(body)));
  assert.ok(create.args.includes('--draft'));
  assert.deepEqual(create.args.slice(create.args.indexOf('--base'), create.args.indexOf('--base') + 2), [
    '--base',
    'dev'
  ]);
  assert.equal(result.url, 'https://github.com/o/r/pull/9');
});
