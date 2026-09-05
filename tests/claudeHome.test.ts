import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { makeClaudeEnvironment } from '../src/main/ai/providers/claude/claudeHome.js';

test('makeClaudeEnvironment preserves process.env without modifying HOME by default', () => {
  const env = makeClaudeEnvironment({
    binaryPath: '',
    homePath: '',
    launchArgs: '',
    env: {}
  });

  // HOME should remain pointing to user home (essential for macOS Keychain OAuth lookups)
  assert.equal(env.HOME, process.env.HOME);
  // CLAUDE_CONFIG_DIR should not be set when homePath is empty
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
});

test('makeClaudeEnvironment sets CLAUDE_CONFIG_DIR and expands tilde when homePath is set', () => {
  const env = makeClaudeEnvironment({
    binaryPath: '',
    homePath: '~/.custom-claude',
    launchArgs: '',
    env: {
      CUSTOM_VAR: 'hello'
    }
  });

  const expectedDir = path.join(os.homedir(), '.custom-claude');
  assert.equal(env.CLAUDE_CONFIG_DIR, expectedDir);
  assert.equal(env.CUSTOM_VAR, 'hello');
  assert.equal(env.HOME, process.env.HOME);
});

test('makeClaudeEnvironment handles absolute homePath directly', () => {
  const env = makeClaudeEnvironment({
    binaryPath: '',
    homePath: '/var/data/claude',
    launchArgs: '',
    env: {}
  });

  assert.equal(env.CLAUDE_CONFIG_DIR, '/var/data/claude');
});
