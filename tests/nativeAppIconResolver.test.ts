import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { describe, it } from 'node:test';

import { NativeAppIconResolver } from '../src/main/assets/NativeAppIconResolver';

describe('NativeAppIconResolver', () => {
  it('escapes Spotlight wildcards in query and caches misses', async () => {
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    const tmpDir = path.join(os.tmpdir(), `test-native-app-icons-${Date.now()}`);

    const resolver = new NativeAppIconResolver({
      cacheDir: tmpDir,
      platform: 'darwin',
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        return '';
      },
    });

    const result = await resolver.resolve({
      _tag: 'display-name',
      displayName: "Editor's App * [v1.0]?",
    });

    assert.equal(result, null);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, '/usr/bin/mdfind');
    // Spotlight query should have escaped single quotes, backslashes, asterisks, question marks
    const queryArg = commands[0].args[0];
    assert.ok(queryArg.includes("Editor\\'s App \\* [v1.0]\\?"));

    // Second call should hit the memory cache for misses without running any more commands
    const secondResult = await resolver.resolve({
      _tag: 'display-name',
      displayName: "Editor's App * [v1.0]?",
    });
    assert.equal(secondResult, null);
    assert.equal(commands.length, 1);
  });

  it('rejects display names containing control characters', async () => {
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    const tmpDir = path.join(os.tmpdir(), `test-native-app-icons-${Date.now()}`);

    const resolver = new NativeAppIconResolver({
      cacheDir: tmpDir,
      platform: 'darwin',
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        return '';
      },
    });

    const result = await resolver.resolve({
      _tag: 'display-name',
      displayName: 'Malicious\x00App\nName',
    });

    assert.equal(result, null);
    assert.equal(commands.length, 0); // never calls mdfind
  });

  it('returns null on non-darwin platforms', async () => {
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    const tmpDir = path.join(os.tmpdir(), `test-native-app-icons-${Date.now()}`);

    const resolver = new NativeAppIconResolver({
      cacheDir: tmpDir,
      platform: 'linux',
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        return '';
      },
    });

    const result = await resolver.resolve({
      _tag: 'app-id',
      appId: 'com.google.Chrome',
    });

    assert.equal(result, null);
    assert.equal(commands.length, 0);
  });
});
