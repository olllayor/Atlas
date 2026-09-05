import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { makeClaudeEnvironment } from '../src/main/ai/providers/claude/claudeHome.js';

test('makeClaudeEnvironment preserves process.env without modifying HOME by default', () => {
  const env = makeClaudeEnvironment({
    homePath: '',
    env: {}
  });

  // HOME should remain pointing to user home (essential for macOS Keychain OAuth lookups)
  assert.equal(env.HOME, process.env.HOME);
  // CLAUDE_CONFIG_DIR should not be set when homePath is empty
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  // CLAUDE_CODE_ENABLE_TODO_TOOLS should default to '1' (t3code PR #9031)
  assert.equal(env.CLAUDE_CODE_ENABLE_TODO_TOOLS, '1');
});

test('makeClaudeEnvironment preserves explicit CLAUDE_CODE_ENABLE_TODO_TOOLS setting', () => {
  const env = makeClaudeEnvironment({
    homePath: '',
    env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' }
  });

  assert.equal(env.CLAUDE_CODE_ENABLE_TODO_TOOLS, '0');
});

test('makeClaudeEnvironment sets CLAUDE_CONFIG_DIR and expands tilde when homePath is set', () => {
  const env = makeClaudeEnvironment({
    homePath: '~/.custom-claude',
    env: {
      CUSTOM_VAR: 'hello'
    }
  });

  const expectedDir = path.join(os.homedir(), '.custom-claude');
  assert.equal(env.CLAUDE_CONFIG_DIR, expectedDir);
  assert.equal(env.CUSTOM_VAR, 'hello');
  assert.equal(env.HOME, process.env.HOME);
  assert.equal(env.CLAUDE_CODE_ENABLE_TODO_TOOLS, '1');
});

test('makeClaudeEnvironment handles absolute homePath directly', () => {
  const env = makeClaudeEnvironment({
    homePath: '/var/data/claude',
    env: {}
  });

  assert.equal(env.CLAUDE_CONFIG_DIR, '/var/data/claude');
  assert.equal(env.CLAUDE_CODE_ENABLE_TODO_TOOLS, '1');
});
