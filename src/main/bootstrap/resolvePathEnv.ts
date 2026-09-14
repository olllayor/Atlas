/**
 * PATH augmentation for spawning external CLIs from a packaged app.
 *
 * A GUI-launched Electron app inherits Finder's PATH — `/usr/bin:/bin` and
 * little else. Every spawn of an external CLI (opencode, MCP servers, gh)
 * has to search the directories the user's shell would have put on PATH.
 *
 * `defaultPathDirs` in IdeLauncher already encodes the directory list for
 * IDE detection; this module reuses it to produce PATH *values* for spawn
 * environments and absolute-path resolution for bare command names.
 */

import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { defaultPathDirs } from '../workspace/IdeLauncher.js';

/**
 * PATH string with the directories a Finder-launched app never inherits
 * appended. Exact-duplicate entries collapse (see `defaultPathDirs`).
 */
export function augmentPath(
  pathValue: string | undefined,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): string {
  return defaultPathDirs(platform, { PATH: pathValue }, home).join(delimiter);
}

/**
 * Environment with PATH replaced by the augmented value. When `env` is
 * undefined the inherited `process.env` is the base.
 */
export function withAugmentedPathEnv(
  env: NodeJS.ProcessEnv | undefined,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): NodeJS.ProcessEnv {
  const base = env ?? process.env;
  return { ...base, PATH: augmentPath(base.PATH, platform, home) };
}

/**
 * Resolve a command name to an absolute path by searching the augmented PATH.
 *
 * A configured path (anything with a separator) is taken at its word and only
 * checked for executability — overriding the binary is exactly how a user
 * points Atlas at a build that is not on PATH. A bare name is looked up in
 * the same directories `augmentPath` would put on a spawn environment, so
 * the answer matches what a terminal would resolve.
 *
 * Returns null when not found.
 */
export function resolveCommandOnPath(
  command: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    home?: string;
  } = {}
): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();

  if (command.includes('/') || (platform === 'win32' && command.includes('\\'))) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  const dirs = defaultPathDirs(platform, env, home);
  const extensions =
    platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : [''];

  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension.toLowerCase()}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }

  return null;
}
