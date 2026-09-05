import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_SHIM_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1']);

const NPM_PACKAGE_ENTRY_CANDIDATES = [
  ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'],
  ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js']
] as const;

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves the configured Claude binary path into a value the Claude Agent
 * SDK can spawn directly via `pathToClaudeCodeExecutable`.
 *
 * The SDK spawns the given path without a shell and without Windows PATH /
 * PATHEXT resolution, so a bare command name like `claude` can fail if not
 * resolved to an absolute path, and on Windows an npm `claude.cmd` shim fails
 * with `spawn EINVAL`.
 *
 * Blueprint: pingdotgg/t3code Drivers/ClaudeExecutable.ts
 */
export function resolveClaudeSdkExecutablePath(
  binaryPath: string,
  _environment?: NodeJS.ProcessEnv
): string {
  const trimmed = binaryPath.trim() || 'claude';
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    if (trimmed.startsWith('~/')) {
      return path.resolve(process.env.HOME ?? '', trimmed.slice(2));
    }
    return trimmed;
  }

  const ext = path.win32.extname(trimmed).toLowerCase();
  if (!WINDOWS_SHIM_EXTENSIONS.has(ext)) {
    return trimmed;
  }

  const shimDirectory = path.win32.dirname(trimmed);
  for (const entrySegments of NPM_PACKAGE_ENTRY_CANDIDATES) {
    const candidate = path.win32.join(shimDirectory, ...entrySegments);
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }

  return trimmed;
}
