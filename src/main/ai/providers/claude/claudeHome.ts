import os from 'node:os';
import path from 'node:path';

export function resolveClaudeHomePath(homePath: string): string {
  const trimmed = homePath.trim();
  if (!trimmed) return os.homedir();
  if (trimmed.startsWith('~/') || trimmed === '~') {
    return path.resolve(os.homedir(), trimmed.slice(trimmed === '~' ? 1 : 2));
  }
  return path.resolve(trimmed);
}

/**
 * Prepares the environment for Claude Code.
 *
 * NOTE (blueprint: pingdotgg/t3code Drivers/ClaudeHome.ts):
 * We isolate this instance's config via CLAUDE_CONFIG_DIR rather than HOME.
 * Overriding HOME relocates the macOS login keychain lookup ($HOME/Library/Keychains),
 * so the spawned CLI cannot find its stored OAuth credentials and reports "Not logged in".
 * CLAUDE_CONFIG_DIR points Claude Code at its config dir directly while leaving HOME
 * (and the keychain) intact.
 *
 * We also default CLAUDE_CODE_ENABLE_TODO_TOOLS=1 so spawned sessions receive
 * task/todo progress updates (t3code PR #9031).
 */
export function makeClaudeEnvironment(
  settings: { homePath?: string; env?: Record<string, string> },
  baseEnv?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(baseEnv ?? process.env), ...(settings.env ?? {}) };
  env.CLAUDE_CODE_ENABLE_TODO_TOOLS = env.CLAUDE_CODE_ENABLE_TODO_TOOLS ?? '1';
  const homePath = settings.homePath?.trim();
  if (homePath) {
    env.CLAUDE_CONFIG_DIR = resolveClaudeHomePath(homePath);
  }
  return env;
}
