/**
 * probeOpenCode — answers, without any Atlas UI involvement:
 *   installed? version ok? authenticated? how many upstream providers/models?
 *
 * Blueprint: pingdotgg/t3code `Layers/OpenCodeProvider.ts` (whole file):
 * version floor gate, scoped external-vs-owned connectivity, auth derived
 * from connected-provider count, friendly taxonomy via openCodeErrors.
 *
 * Every side-effectful dependency is injectable so the full matrix runs under
 * plain `node --test` with zero real processes/HTTP (mirrors t3's testing).
 */

import { execFile } from 'node:child_process';

import {
  compareOpenCodeVersions,
  parseOpenCodeVersionOutput
} from './openCodeParsers.js';
import { describeOpenCodeFailure } from './openCodeErrors.js';
import {
  createOpenCodeInventoryClient,
  type OpenCodeInventoryClient
} from './OpenCodeClient.js';
import type { OpenCodeSettings } from '../../../../shared/opencodeSettings.js';
import { openCodeServerMode } from '../../../../shared/opencodeSettings.js';

export const MIN_OPENCODE_VERSION = '1.14.19';

export type OpenCodeProbeStatus = 'ready' | 'warning' | 'error';

export interface OpenCodeProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: OpenCodeProbeStatus;
  readonly auth: { readonly status: 'authenticated' | 'unknown' };
  readonly connectedProviders: readonly string[];
  readonly modelCount: number;
  readonly baseUrlUsed?: string;
  readonly message?: string;
}

export interface ReadBinaryVersionOutcome {
  readonly version: string | null;
  /** true ⇒ the binary could not be executed at all (ENOENT et al.). */
  readonly executableMissing: boolean;
  readonly cause?: unknown;
}

/** Default `--version` runner over execFile; injectable for tests. */
export function makeDefaultBinaryVersionReader(timeoutMs = 5000) {
  return async (command: string): Promise<ReadBinaryVersionOutcome> =>
    new Promise((resolve) => {
      execFile(
        command,
        ['--version'],
        { timeout: timeoutMs, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            const missing =
              (error as NodeJS.ErrnoException).code === 'ENOENT' ||
              /not recognized|command not found/i.test(String(stderr ?? '') || String(error.message));
            resolve({
              version: parseOpenCodeVersionOutput(String(stdout ?? '')),
              executableMissing: missing,
              cause: error
            });
            return;
          }
          resolve({ version: parseOpenCodeVersionOutput(String(stdout ?? '')), executableMissing: false });
        }
      );
    });
}

export interface OpenCodeProbeDeps {
  /** Spawn/read helper (default: real execFile). */
  readonly readBinaryVersion: (command: string) => Promise<ReadBinaryVersionOutcome>;
  /** HTTP client constructor (default: official SDK wrapper). */
  readonly createClient: (input: {
    baseUrl: string;
    directory: string;
    serverPassword?: string;
  }) => OpenCodeInventoryClient;
  /** Owned-server lifecycle; required only for spawned mode probes. */
  readonly connectOwnedServer?: () => Promise<{ baseUrl: string }>;
}

interface ProbeInput {
  readonly settings: OpenCodeSettings;
  /** Project directory handed to the opencode SDK (shapes project scoping). */
  readonly directory: string;
  readonly serverPassword?: string;
  /**
   * Pure-external deployments may have no local CLI at all; pass true
   * (together with an external `serverUrl`) to bypass the binary/version gate.
   */
  readonly skipBinaryVersionCheck?: boolean;
  readonly deps?: Partial<OpenCodeProbeDeps>;
}

function notInstalled(): OpenCodeProbeResult {
  return {
    installed: false,
    version: null,
    status: 'error',
    auth: { status: 'unknown' },
    connectedProviders: [],
    modelCount: 0,
    message: 'OpenCode CLI (`opencode`) is not installed or not on PATH.'
  };
}

function tooOld(version: string): OpenCodeProbeResult {
  return {
    installed: true,
    version,
    status: 'error',
    auth: { status: 'unknown' },
    connectedProviders: [],
    modelCount: 0,
    message: `OpenCode v${version} is too old. Upgrade to v${MIN_OPENCODE_VERSION} or newer.`
  };
}

export async function probeOpenCode(input: ProbeInput): Promise<OpenCodeProbeResult> {
  const deps: OpenCodeProbeDeps = {
    readBinaryVersion: input.deps?.readBinaryVersion ?? makeDefaultBinaryVersionReader(),
    createClient: input.deps?.createClient ?? createOpenCodeInventoryClient,
    ...(input.deps?.connectOwnedServer ? { connectOwnedServer: input.deps.connectOwnedServer } : {})
  };

  const binaryCommand = input.settings.binaryPath.trim() || 'opencode';

  // 1) Binary presence + version floor (skippable for pure-external servers).
  const isExternal = openCodeServerMode(input.settings) === 'external';
  const skipBinary = input.skipBinaryVersionCheck === true && isExternal;

  if (!skipBinary) {
    const binary = await deps.readBinaryVersion(binaryCommand);
    if (binary.executableMissing) {
      return notInstalled();
    }
    if (!binary.version) {
      return {
        installed: true,
        version: null,
        status: 'error',
        auth: { status: 'unknown' },
        connectedProviders: [],
        modelCount: 0,
        message: `Unable to determine OpenCode version from \`${binaryCommand} --version\`. Atlas requires OpenCode v${MIN_OPENCODE_VERSION} or newer.`
      };
    }
    if (compareOpenCodeVersions(binary.version, MIN_OPENCODE_VERSION) < 0) {
      return tooOld(binary.version);
    }

    // 2) Inventory via the server (external URL or spawned-by-runtime).
    const isExternal = openCodeServerMode(input.settings) === 'external';
    const serverUrl = isExternal ? input.settings.serverUrl.trim() : undefined;

    try {
      let baseUrl = serverUrl;
      if (!baseUrl) {
        if (!deps.connectOwnedServer) {
          throw new Error('OpenCodeRuntime was not wired into the probe for spawned mode.');
        }
        baseUrl = (await deps.connectOwnedServer()).baseUrl;
      }

      const client = deps.createClient({
        baseUrl,
        directory: input.directory,
        ...(input.serverPassword ? { serverPassword: input.serverPassword } : {})
      });
      const inventory = await client.listProviders();
      const connectedCount = inventory.connected.length;

      return {
        installed: true,
        version: binary.version,
        status: connectedCount > 0 ? 'ready' : 'warning',
        auth: { status: connectedCount > 0 ? 'authenticated' : 'unknown' },
        connectedProviders: [...inventory.connected],
        modelCount: inventory.modelCount,
        baseUrlUsed: baseUrl,
        message:
          connectedCount > 0
            ? `${connectedCount} upstream provider${connectedCount === 1 ? '' : 's'} connected through ${isExternal ? 'the configured OpenCode server' : 'OpenCode'}.`
            : isExternal
              ? 'Connected to the configured OpenCode server, but it did not report any connected upstream providers.'
              : 'OpenCode is available, but it did not report any connected upstream providers. Run `opencode auth login`.'
      };
    } catch (cause) {
      const report = describeOpenCodeFailure(cause, { isExternalServer: !!serverUrl, serverUrl: serverUrl ?? '' });
      return {
        installed: report.installed,
        version: binary.version,
        status: 'error',
        auth: { status: 'unknown' },
        connectedProviders: [],
        modelCount: 0,
        message: report.message
      };
    }
  }

  // Pure-external probe with no local binary check requested by caller.
  const isExternalProbe = openCodeServerMode(input.settings) === 'external';
  try {
    const baseUrl = input.settings.serverUrl.trim();
    const client = deps.createClient({
      baseUrl,
      directory: input.directory,
      ...(input.serverPassword ? { serverPassword: input.serverPassword } : {})
    });
    const inventory = await client.listProviders();
    const connectedCount = inventory.connected.length;
    return {
      installed: true,
      version: null,
      status: connectedCount > 0 ? 'ready' : 'warning',
      auth: { status: connectedCount > 0 ? 'authenticated' : 'unknown' },
      connectedProviders: [...inventory.connected],
      modelCount: inventory.modelCount,
      baseUrlUsed: baseUrl,
      message:
        connectedCount > 0
          ? `${connectedCount} upstream provider${connectedCount === 1 ? '' : 's'} connected through the configured OpenCode server.`
          : 'Connected to the configured OpenCode server, but it did not report any connected upstream providers.'
    };
  } catch (cause) {
    const report = describeOpenCodeFailure(cause, {
      isExternalServer: isExternalProbe,
      serverUrl: input.settings.serverUrl.trim()
    });
    return {
      installed: report.installed,
      version: null,
      status: 'error',
      auth: { status: 'unknown' },
      connectedProviders: [],
      modelCount: 0,
      message: report.message
    };
  }
}

