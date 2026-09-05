/**
 * Antigravity runtime wiring for Atlas: profile preparation, spawn planning,
 * and probing. Same method as t3code PR #9348, adapted to Atlas' local-agent
 * controller (plain Node, one instance per agent id).
 *
 * - each agent id gets its own `GEMINI_HOME` profile with file token storage;
 * - `settings.json` is rewritten on every launch so method/project/location
 *   edits take effect, and records `auth.type` like T3;
 * - a controlled `BROWSER` helper stops the agent opening a browser on the
 *   host; the OAuth URL is caught from the stdout prefix by `AcpClient`;
 * - spawn uses the managed install when present, else an explicit binary
 *   override, else PATH resolution at detection time.
 */

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ANTIGRAVITY_BROWSER_PREFLIGHT_URL,
  ANTIGRAVITY_AUTH_BROWSER_MARKER,
  antigravityBrowserHelperSource,
  antigravityEnvironment,
  antigravityProfileSettings,
  buildAntigravityBrowserCommand,
  resolveAntigravityProfileDirectory,
  resolveAntigravityProfilePaths,
  validateAntigravityBrowserCommand,
  type AntigravityAuthConfig,
  type AntigravityProfile
} from './antigravityAuthSupport.js';
import { AntigravityInstallation } from './AntigravityInstallation.js';

export interface AntigravityRuntimePaths {
  readonly stateDir: string;
  /** Executable used for the BROWSER suppression helper (app runtime). */
  readonly runtimeExecutablePath: string;
  /** Base dir for the managed install (`<userData>/tools`). */
  readonly installBaseDir: string;
  /** Extra session root passed as `additionalDirectories` (attachments). */
  readonly attachmentsDir?: string;
  readonly platform?: NodeJS.Platform;
}

export interface AntigravitySpawnPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly profile: AntigravityProfile;
  readonly harnessPath: string;
  readonly key: string;
}

export async function prepareAntigravityProfileDir(
  profileDirectory: string,
  auth: AntigravityAuthConfig,
  platform: NodeJS.Platform = process.platform
): Promise<{ geminiHome: string; acpDirectory: string; tokenPath: string }> {
  const paths = resolveAntigravityProfilePaths(profileDirectory, platform);
  await mkdir(paths.geminiHome, { recursive: true, mode: 0o700 });
  await mkdir(paths.acpDirectory, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') {
    await chmod(paths.geminiHome, 0o700).catch(() => undefined);
    await chmod(paths.acpDirectory, 0o700).catch(() => undefined);
  }
  await writeFile(join(paths.acpDirectory, 'settings.json'), antigravityProfileSettings(auth));
  return paths;
}

/** Verify the BROWSER suppression helper echoes the marker for a preflight URL. */
export function verifyAntigravityBrowserHelper(
  runtimeExecutablePath: string,
  env: NodeJS.ProcessEnv
): void {
  // The runtime executable runs the helper with ELECTRON_RUN_AS_NODE=1 (set
  // in the profile env), so Electron behaves as plain node, like T3's server.
  const result = spawnSync(
    runtimeExecutablePath,
    ['-e', antigravityBrowserHelperSource, '--', ANTIGRAVITY_BROWSER_PREFLIGHT_URL],
    { encoding: 'utf8', timeout: 5_000, env, windowsHide: true }
  );
  const stderr = result.stderr ?? '';
  const expected = `${ANTIGRAVITY_AUTH_BROWSER_MARKER}"${ANTIGRAVITY_BROWSER_PREFLIGHT_URL}"\n`;
  if (result.status !== 0 || stderr !== expected) {
    throw new Error('Antigravity browser suppression could not be verified.');
  }
}

/** Build the full spawn plan for an Antigravity turn or probe. */
export async function planAntigravitySpawn(input: {
  readonly paths: AntigravityRuntimePaths;
  readonly instanceId: string;
  readonly cwd: string;
  readonly auth: AntigravityAuthConfig;
  readonly baseEnv: Record<string, string>;
  readonly binaryOverride?: string;
  readonly extraArgs?: readonly string[];
  readonly installation?: AntigravityInstallation;
  readonly skipBrowserPreflight?: boolean;
}): Promise<AntigravitySpawnPlan> {
  const platform = input.paths.platform ?? process.platform;
  const profileDirectory = resolveAntigravityProfileDirectory(input.paths.stateDir, input.instanceId);
  const browserCommand = buildAntigravityBrowserCommand(input.paths.runtimeExecutablePath);
  const browserError = validateAntigravityBrowserCommand(
    browserCommand,
    input.paths.runtimeExecutablePath,
    platform
  );
  if (browserError) {
    throw new Error(browserError);
  }
  const profilePaths = await prepareAntigravityProfileDir(profileDirectory, input.auth, platform);
  const profile: AntigravityProfile = {
    platform,
    geminiHome: profilePaths.geminiHome,
    acpDirectory: profilePaths.acpDirectory,
    tokenPath: profilePaths.tokenPath,
    browserCommand
  };
  const env = antigravityEnvironment(profile, { ...process.env, ...input.baseEnv }, input.auth);
  if (!input.skipBrowserPreflight) {
    verifyAntigravityBrowserHelper(input.paths.runtimeExecutablePath, env);
  }

  const installation =
    input.installation ?? new AntigravityInstallation({ baseDir: input.paths.installBaseDir });
  const override = input.binaryOverride?.trim();
  let executablePath = override || null;
  let harnessPath = '';
  if (!executablePath) {
    const active = await installation.acquire();
    if (active) {
      executablePath = active.executablePath;
      harnessPath = active.harnessPath;
    }
  }
  if (!executablePath) {
    throw new Error(
      'Antigravity is not installed. Open Settings → Antigravity and click Install.'
    );
  }
  const fullEnv: NodeJS.ProcessEnv = {
    ...env,
    ...(harnessPath ? { ANTIGRAVITY_HARNESS_PATH: harnessPath } : {})
  };
  const args = [...(platform === 'linux' ? ['--uid='] : []), ...(input.extraArgs ?? [])];
  return {
    command: executablePath,
    args,
    env: fullEnv,
    profile,
    harnessPath,
    key: JSON.stringify([executablePath, args, input.auth, profileDirectory])
  };
}

/** Model catalog entry the probe reports. */
export interface AntigravityProbeModels {
  readonly models: readonly { value: string; name: string }[];
  readonly currentModel: string | null;
}
