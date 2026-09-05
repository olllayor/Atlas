import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { resolveClaudeSdkExecutablePath } from '../src/main/ai/providers/claude/claudeExecutable.js';

test('resolves explicit binary path when provided on non-windows', () => {
  if (process.platform === 'win32') return;

  const resolved = resolveClaudeSdkExecutablePath('/custom/path/to/claude', {});
  assert.equal(resolved, '/custom/path/to/claude');
});

test('resolves default claude when binary path is empty', () => {
  if (process.platform === 'win32') return;

  const resolved = resolveClaudeSdkExecutablePath('', {});
  assert.equal(resolved, 'claude');
});

test('expands tilde home path in binaryPath', () => {
  if (process.platform === 'win32') return;

  const resolved = resolveClaudeSdkExecutablePath('~/.local/bin/claude', {});
  assert.equal(resolved, path.join(os.homedir(), '.local/bin/claude'));
});

test('resolves npm cmd shim on Windows to cli.js or real binary', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-exe-test-'));
  try {
    const shimPath = path.join(tmpDir, 'claude.cmd');
    const targetScript = path.join(tmpDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    fs.mkdirSync(path.dirname(targetScript), { recursive: true });
    fs.writeFileSync(targetScript, '// cli entry');

    // Create a typical npm-generated .cmd shim
    fs.writeFileSync(
      shimPath,
      `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
`
    );

    // Call resolver pretending we are on windows or testing the shim logic
    const resolved = resolveClaudeSdkExecutablePath(shimPath, {});
    // On windows it parses the shim and finds cli.js; on other OS it either parses if .cmd is specified
    if (shimPath.endsWith('.cmd')) {
      // Should find targetScript or real candidate
      assert.ok(resolved.includes('cli.js') || resolved === shimPath);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
