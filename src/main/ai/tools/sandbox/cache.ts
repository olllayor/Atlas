import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Directory where sandboxed commands can persist package manager and tool caches
 * without needing write access to $HOME.
 *
 * Located under $TMPDIR (or /tmp), which is already granted as a writable scratch
 * root in every workspace-write policy.
 */
export function getSandboxCacheDir(): string {
  const scratchBase = process.env.TMPDIR?.trim() || tmpdir();
  const uid = typeof process.getuid === 'function' ? process.getuid() : process.env.USER || 'default';
  const cacheDir = resolve(scratchBase, `atlas-sandbox-cache-${uid}`);
  try {
    mkdirSync(cacheDir, { recursive: true });
    const subdirectories = [
      'xdg',
      'xdg-config',
      'xdg-data',
      'xdg-state',
      'npm',
      'pnpm-home',
      'yarn',
      'uv',
      'pip',
      'go-build',
      'cargo',
      'ms-playwright',
      'cypress'
    ];
    for (const sub of subdirectories) {
      mkdirSync(resolve(cacheDir, sub), { recursive: true });
    }
  } catch {
    // Ignore error if it already exists or cannot be created synchronously
  }
  return cacheDir;
}

/**
 * Environment variables that redirect package managers and tools to write their
 * ephemeral caches to the sandboxed scratch cache directory instead of $HOME.
 */
export function buildSandboxCacheEnv(cacheDir: string = getSandboxCacheDir()): Record<string, string> {
  return {
    XDG_CACHE_HOME: resolve(cacheDir, 'xdg'),
    XDG_CONFIG_HOME: resolve(cacheDir, 'xdg-config'),
    XDG_DATA_HOME: resolve(cacheDir, 'xdg-data'),
    XDG_STATE_HOME: resolve(cacheDir, 'xdg-state'),
    npm_config_cache: resolve(cacheDir, 'npm'),
    PNPM_HOME: resolve(cacheDir, 'pnpm-home'),
    YARN_CACHE_FOLDER: resolve(cacheDir, 'yarn'),
    UV_CACHE_DIR: resolve(cacheDir, 'uv'),
    PIP_CACHE_DIR: resolve(cacheDir, 'pip'),
    GOCACHE: resolve(cacheDir, 'go-build'),
    CARGO_HOME: resolve(cacheDir, 'cargo'),
    PLAYWRIGHT_BROWSERS_PATH: resolve(cacheDir, 'ms-playwright'),
    CYPRESS_CACHE_FOLDER: resolve(cacheDir, 'cypress'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    npm_config_yes: 'true'
  };
}
