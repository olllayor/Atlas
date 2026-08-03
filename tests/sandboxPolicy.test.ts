import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildBubblewrapLaunch } from '../src/main/ai/tools/sandbox/bubblewrap.js';
import { isLikelySandboxDenied, isSandboxWrapperFailure } from '../src/main/ai/tools/sandbox/denial.js';
import { buildSandboxedLaunch, deriveSandboxPolicy } from '../src/main/ai/tools/sandbox/index.js';
import { computeWritableRoots } from '../src/main/ai/tools/sandbox/policy.js';
import {
  buildSeatbeltLaunch,
  buildSeatbeltWritePolicy,
  SEATBELT_EXECUTABLE
} from '../src/main/ai/tools/sandbox/seatbelt.js';
import type { SandboxPolicy, WritableRoot } from '../src/main/ai/tools/sandbox/types.js';

function makeProject(name = 'atlas-policy-') {
  return mkdtempSync(join(tmpdir(), name));
}

function findRoot(roots: WritableRoot[], path: string) {
  const canonical = realpathSync.native(path);
  return roots.find((entry) => entry.root === canonical);
}

function workspaceWrite(roots: WritableRoot[]): SandboxPolicy {
  return { fs: { kind: 'workspace-write', writableRoots: roots }, network: 'deny' };
}

test('deriveSandboxPolicy grants workspace-write only to Code mode with a project', () => {
  const root = makeProject();

  try {
    const codePolicy = deriveSandboxPolicy({ mode: 'code', root });
    assert.equal(codePolicy.fs.kind, 'workspace-write');
    assert.equal(codePolicy.network, 'deny');

    assert.equal(deriveSandboxPolicy({ mode: 'code', root: null }).fs.kind, 'read-only');
    assert.equal(deriveSandboxPolicy({ mode: 'work', root }).fs.kind, 'read-only');
    assert.equal(deriveSandboxPolicy(undefined).fs.kind, 'read-only');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computeWritableRoots canonicalizes the project root and adds scratch space', () => {
  const root = makeProject();

  try {
    const roots = computeWritableRoots(root);
    const projectRoot = findRoot(roots, root);

    assert.ok(projectRoot, 'the project root is writable');
    assert.equal(projectRoot.root, realpathSync.native(root));
    assert.ok(findRoot(roots, '/tmp'), '/tmp is writable scratch space');
    assert.equal(new Set(roots.map((entry) => entry.root)).size, roots.length, 'roots are deduplicated');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computeWritableRoots deduplicates $TMPDIR against /tmp', () => {
  const root = makeProject();
  const originalTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = '/tmp';

  try {
    const roots = computeWritableRoots(root);
    const tmpRoots = roots.filter((entry) => entry.root === realpathSync.native('/tmp'));
    assert.equal(tmpRoots.length, 1);
  } finally {
    if (originalTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = originalTmpdir;
    }

    rmSync(root, { recursive: true, force: true });
  }
});

test('computeWritableRoots protects repository and Atlas metadata names', () => {
  const root = makeProject();

  try {
    const projectRoot = findRoot(computeWritableRoots(root), root);
    const canonical = realpathSync.native(root);

    assert.deepEqual(projectRoot?.readOnlySubpaths, [
      join(canonical, '.git'),
      join(canonical, '.atlas'),
      join(canonical, '.hg'),
      join(canonical, '.svn')
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computeWritableRoots follows a gitdir pointer file', () => {
  const root = makeProject();
  const realGitDir = join(root, 'actual-git');
  mkdirSync(realGitDir);
  writeFileSync(join(root, '.git'), `gitdir: ${realGitDir}\n`);

  try {
    const projectRoot = findRoot(computeWritableRoots(root), root);
    assert.ok(projectRoot?.readOnlySubpaths.includes(realpathSync.native(realGitDir)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildSeatbeltWritePolicy never spells a path into the profile text', () => {
  const { policyText, params } = buildSeatbeltWritePolicy([
    { root: '/Users/someone/my project', readOnlySubpaths: ['/Users/someone/my project/.git'] },
    { root: '/private/tmp', readOnlySubpaths: [] }
  ]);

  assert.equal(policyText.includes('/Users/someone'), false);
  assert.equal(policyText.includes('/private/tmp'), false);
  assert.match(policyText, /\(subpath \(param "WRITABLE_ROOT_0"\)\)/);
  assert.match(policyText, /\(require-not \(literal \(param "WRITABLE_ROOT_0_RO_0"\)\)\)/);
  assert.match(policyText, /\(require-not \(subpath \(param "WRITABLE_ROOT_0_RO_0"\)\)\)/);
  assert.deepEqual(params, [
    ['WRITABLE_ROOT_0', '/Users/someone/my project'],
    ['WRITABLE_ROOT_0_RO_0', '/Users/someone/my project/.git'],
    ['WRITABLE_ROOT_1', '/private/tmp']
  ]);
});

test('buildSeatbeltWritePolicy emits nothing for a read-only policy', () => {
  const { policyText, params } = buildSeatbeltWritePolicy([]);
  assert.equal(policyText, '');
  assert.deepEqual(params, []);
});

test('buildSeatbeltLaunch passes the profile and paths as separate argv elements', () => {
  const launch = buildSeatbeltLaunch(
    ['/bin/zsh', '-lc', 'echo hi'],
    workspaceWrite([{ root: '/Users/someone/my project', readOnlySubpaths: [] }])
  );

  assert.equal(launch.command, SEATBELT_EXECUTABLE);
  assert.equal(launch.args[0], '-p');
  assert.match(launch.args[1] ?? '', /^\(version 1\)/);
  assert.match(launch.args[1] ?? '', /\(deny default\)/);
  assert.match(launch.args[1] ?? '', /\(allow file-read\*\)/);
  assert.equal(launch.args[1]?.includes('network-outbound'), false);
  assert.deepEqual(launch.args.slice(2), [
    '-DWRITABLE_ROOT_0=/Users/someone/my project',
    '--',
    '/bin/zsh',
    '-lc',
    'echo hi'
  ]);
  assert.equal(launch.env.ATLAS_SANDBOX_NETWORK_DISABLED, '1');
  assert.equal(launch.mechanism, 'seatbelt');
});

test('buildSeatbeltLaunch appends the network section only when network is granted', () => {
  const launch = buildSeatbeltLaunch(['/bin/zsh', '-lc', 'echo hi'], {
    fs: { kind: 'workspace-write', writableRoots: [] },
    network: 'allow'
  });

  assert.match(launch.args[1] ?? '', /\(allow network-outbound\)/);
  assert.equal(launch.env.ATLAS_SANDBOX_NETWORK_DISABLED, undefined);
});

test('buildSeatbeltLaunch refuses a path it cannot represent as a parameter', () => {
  assert.throws(
    () => buildSeatbeltLaunch(['/bin/zsh', '-lc', 'echo hi'], workspaceWrite([{ root: '/tmp/a\nb', readOnlySubpaths: [] }])),
    /newline/
  );
});

test('buildBubblewrapLaunch binds the writable roots over a read-only root filesystem', () => {
  const launch = buildBubblewrapLaunch(
    ['/bin/zsh', '-lc', 'echo hi'],
    workspaceWrite([{ root: '/home/someone/project', readOnlySubpaths: [] }])
  );

  assert.equal(launch.command, 'bwrap');
  assert.deepEqual(launch.args, [
    '--die-with-parent',
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/run',
    '--bind',
    '/home/someone/project',
    '/home/someone/project',
    '--unshare-net',
    '--',
    '/bin/zsh',
    '-lc',
    'echo hi'
  ]);
  assert.equal(launch.env.ATLAS_SANDBOX, 'bubblewrap');
});

test('buildSandboxedLaunch leaves the command bare when there is nothing to enforce', () => {
  const bare = buildSandboxedLaunch(['/bin/zsh', '-lc', 'echo hi'], workspaceWrite([]), 'none');
  assert.equal(bare.command, '/bin/zsh');
  assert.deepEqual(bare.args, ['-lc', 'echo hi']);
  assert.equal(bare.mechanism, 'none');

  const escalated = buildSandboxedLaunch(
    ['/bin/zsh', '-lc', 'echo hi'],
    { fs: { kind: 'danger-full-access' }, network: 'allow' },
    'seatbelt'
  );
  assert.equal(escalated.command, '/bin/zsh');
  assert.equal(escalated.mechanism, 'none');
  assert.deepEqual(escalated.env, {});
});

test('isLikelySandboxDenied fires only on a failed sandboxed command with a denial keyword', () => {
  assert.equal(isLikelySandboxDenied('seatbelt', 1, '', 'touch: /x: Operation not permitted'), true);
  assert.equal(isLikelySandboxDenied('bubblewrap', 6, '', 'curl: (6) Could not resolve host: example.com'), true);
  assert.equal(isLikelySandboxDenied('seatbelt', 0, '', 'Operation not permitted'), false);
  assert.equal(isLikelySandboxDenied('none', 1, '', 'Operation not permitted'), false);
  assert.equal(isLikelySandboxDenied('seatbelt', null, '', 'Operation not permitted'), false);
  assert.equal(isLikelySandboxDenied('seatbelt', 127, '', 'zsh: command not found: nope'), false);
  assert.equal(isLikelySandboxDenied('seatbelt', 1, '', 'error: test failed'), false);
});

test('isSandboxWrapperFailure separates a broken wrapper from a failed command', () => {
  assert.equal(isSandboxWrapperFailure('seatbelt', 65, 'sandbox-exec: unable to parse policy'), true);
  assert.equal(isSandboxWrapperFailure('seatbelt', 1, 'sandbox-exec: unable to parse policy'), false);
  assert.equal(isSandboxWrapperFailure('seatbelt', 65, 'make: *** exit 65'), false);
  assert.equal(isSandboxWrapperFailure('bubblewrap', 1, 'bwrap: No permissions to creating new namespace'), true);
  assert.equal(isSandboxWrapperFailure('bubblewrap', 0, 'bwrap: warning'), false);
  assert.equal(isSandboxWrapperFailure('none', 1, 'bwrap: anything'), false);
});
