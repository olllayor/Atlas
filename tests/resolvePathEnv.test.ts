import assert from 'node:assert/strict';
import test from 'node:test';

import {
  augmentPath,
  withAugmentedPathEnv
} from '../src/main/bootstrap/resolvePathEnv.js';

test('augmentPath appends the directories a Finder-launched app never inherits', () => {
  const result = augmentPath('/usr/bin:/bin', 'darwin', '/Users/dev');
  const dirs = result.split(':');

  assert.ok(dirs.includes('/usr/bin'));
  assert.ok(dirs.includes('/bin'));
  assert.ok(dirs.includes('/usr/local/bin'));
  assert.ok(dirs.includes('/opt/homebrew/bin'));
  assert.ok(dirs.includes('/Users/dev/.local/bin'));
});

test('augmentPath collapses exact-duplicate directories', () => {
  const result = augmentPath('/usr/bin:/bin:/usr/bin:/opt/homebrew/bin', 'darwin', '/Users/dev');
  const dirs = result.split(':');

  assert.equal(dirs.filter((d) => d === '/usr/bin').length, 1);
  assert.equal(dirs.filter((d) => d === '/opt/homebrew/bin').length, 1);
});

test('augmentPath handles undefined PATH', () => {
  const result = augmentPath(undefined, 'darwin', '/Users/dev');
  const dirs = result.split(':');

  assert.ok(dirs.includes('/usr/local/bin'));
  assert.ok(dirs.includes('/opt/homebrew/bin'));
});

test('augmentPath is a no-op on win32 beyond the inherited PATH', () => {
  const result = augmentPath('C:\\Windows\\System32', 'win32', 'C:\\Users\\dev');
  assert.equal(result, 'C:\\Windows\\System32');
});

test('withAugmentedPathEnv replaces PATH and preserves other variables', () => {
  const env = withAugmentedPathEnv(
    { PATH: '/usr/bin', HOME: '/Users/dev', FOO: 'bar' },
    'darwin',
    '/Users/dev'
  );

  assert.ok(env.PATH!.includes('/opt/homebrew/bin'));
  assert.equal(env.HOME, '/Users/dev');
  assert.equal(env.FOO, 'bar');
});

test('withAugmentedPathEnv falls back to process.env when given undefined', () => {
  const env = withAugmentedPathEnv(undefined, 'darwin', '/Users/dev');
  assert.ok(env.PATH!.includes('/opt/homebrew/bin'));
});
