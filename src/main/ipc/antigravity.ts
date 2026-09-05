/**
 * Antigravity setup IPC: managed install + per-instance Google sign-in.
 *
 * Same method as t3code PR #9348, adapted to Atlas:
 * - Install downloads the official archive from Google, verifies SHA-256,
 *   extracts the executable pair, validates with an ACP `initialize` call.
 *   Progress streams via `antigravity:installProgress` events.
 * - Sign-in starts a disposable agent that reports its OAuth URL; the host
 *   loopback redirect finishes on its own, otherwise the user pastes the
 *   failed `127.0.0.1` redirect URL (remote/phone setup).
 * - Sign out, cancel, retry, and Remove downloaded runtime share this module.
 * - The API key lives in the keychain, never in settings JSON.
 */

import { BrowserWindow, ipcMain, shell } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import { ANTIGRAVITY_API_KEY_ACCOUNT } from '../secrets/keychain';
import type { KeychainStore } from '../secrets/keychain';
import { AcpClient } from '../ai/acp/acpClient';
import { AntigravityAuth } from '../ai/providers/antigravity/AntigravityAuth';
import { AntigravityInstallation } from '../ai/providers/antigravity/AntigravityInstallation';
import {
  ANTIGRAVITY_PERSONAL_AUTH,
  ANTIGRAVITY_STARTUP_TIMEOUT_MS,
  antigravityAuthConfigIssue,
  createAntigravityAuthorizationLineHandler,
  isAntigravityAuthMethod,
  type AntigravityAuthConfig
} from '../ai/providers/antigravity/antigravityAuthSupport';
import { planAntigravitySpawn } from '../ai/providers/antigravity/antigravityRuntime';
import type { LocalAgentController } from '../ai/agents/localAgentController';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export interface AntigravityIpcPaths {
  readonly stateDir: string;
  readonly runtimeExecutablePath: string;
  readonly installBaseDir: string;
  readonly attachmentsDir?: string;
}

interface AntigravityIpcDeps {
  readonly localAgents?: LocalAgentController;
  readonly keychain: Pick<
    KeychainStore,
    'getSecretByAccount' | 'setSecretByAccount' | 'deleteSecretByAccount'
  >;
  readonly paths: AntigravityIpcPaths;
}

export function registerAntigravityIpc({ localAgents, keychain, paths }: AntigravityIpcDeps) {
  const installation = new AntigravityInstallation({ baseDir: paths.installBaseDir });
  let authFlow: AntigravityAuth | null = null;
  let installing = false;

  function broadcastProgress(payload: unknown) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.antigravityInstallProgress, payload);
    }
  }

  async function readAuthConfig(): Promise<AntigravityAuthConfig> {
    const settings = localAgents?.getSettings('antigravity');
    const authMethod =
      settings && isAntigravityAuthMethod(settings.antigravityAuthMethod)
        ? settings.antigravityAuthMethod
        : ANTIGRAVITY_PERSONAL_AUTH.authMethod;
    const apiKey = (await keychain.getSecretByAccount(ANTIGRAVITY_API_KEY_ACCOUNT).catch(() => null)) ?? '';
    return {
      authMethod,
      apiKey,
      gcpProject: settings?.antigravityGcpProject.trim() ?? '',
      gcpLocation: settings?.antigravityGcpLocation.trim() ?? ''
    };
  }

  async function spawnPlanFor(cwd: string, auth: AntigravityAuthConfig) {
    const settings = localAgents?.getSettings('antigravity');
    return planAntigravitySpawn({
      paths: {
        stateDir: paths.stateDir,
        runtimeExecutablePath: paths.runtimeExecutablePath,
        installBaseDir: paths.installBaseDir,
        ...(paths.attachmentsDir ? { attachmentsDir: paths.attachmentsDir } : {})
      },
      instanceId: 'antigravity',
      cwd,
      auth,
      baseEnv: settings?.env ?? {},
      ...(settings?.binaryPath.trim() ? { binaryOverride: settings.binaryPath.trim() } : {}),
      ...(settings?.launchArgs ? { extraArgs: settings.launchArgs.split(/\s+/).filter(Boolean) } : {}),
      installation
    });
  }

  ipcMain.handle(
    IPC_CHANNELS.antigravityInstall,
    withUserFacingErrors(IPC_CHANNELS.antigravityInstall, async (event) => {
      assertTrustedSender(event);
      if (installing) {
        throw new Error('Antigravity install is already running.');
      }
      installing = true;
      try {
        const runtime = await installation.install((progress) => {
          broadcastProgress(progress);
        });
        // Validate with an ACP `initialize` handshake before activating turns.
        const probe = new AcpClient({
          cwd: paths.stateDir,
          binaryPath: runtime.executablePath,
          spawnArgs: [],
          spawnCwd: false,
          spawnTimeoutMs: ANTIGRAVITY_STARTUP_TIMEOUT_MS,
          onStderr: createAntigravityAuthorizationLineHandler()
        });
        try {
          await probe.start();
        } finally {
          await probe.shutdown().catch(() => undefined);
        }
        broadcastProgress({ phase: 'done', downloadedBytes: 1, totalBytes: 1 });
        await localAgents?.syncRegistry().catch(() => undefined);
        return runtime;
      } finally {
        installing = false;
      }
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.antigravityInstallStatus,
    withUserFacingErrors(IPC_CHANNELS.antigravityInstallStatus, async (event) => {
      assertTrustedSender(event);
      return {
        installed: (await installation.readActive().catch(() => null)) !== null,
        installing,
        runtime: await installation.readActive().catch(() => null)
      };
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.antigravityRemove,
    withUserFacingErrors(IPC_CHANNELS.antigravityRemove, async (event) => {
      assertTrustedSender(event);
      await installation.remove();
      authFlow = null;
      await localAgents?.syncRegistry().catch(() => undefined);
      return { removed: true };
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsAntigravitySetApiKey,
    withUserFacingErrors(IPC_CHANNELS.settingsAntigravitySetApiKey, async (event, secret: unknown) => {
      assertTrustedSender(event);
      if (secret === null) {
        await keychain.deleteSecretByAccount(ANTIGRAVITY_API_KEY_ACCOUNT).catch(() => undefined);
        return { cleared: true };
      }
      if (typeof secret !== 'string' || !secret.trim()) {
        throw new Error('Enter an API key first.');
      }
      if (secret.length > 4096) {
        throw new Error('That API key is unreasonably long.');
      }
      await keychain.setSecretByAccount(ANTIGRAVITY_API_KEY_ACCOUNT, secret.trim());
      return { saved: true };
    })
  );

  function getOrCreateFlow(auth: AntigravityAuthConfig): AntigravityAuth {
    if (!authFlow) {
      authFlow = new AntigravityAuth(auth, {
        startAgent: async ({ onAuthorizationUrl }) => {
          const plan = await spawnPlanFor(paths.stateDir, auth);
          const client = new AcpClient({
            cwd: paths.stateDir,
            binaryPath: plan.command,
            spawnArgs: [...plan.args],
            spawnCwd: false,
            env: plan.env,
            spawnTimeoutMs: ANTIGRAVITY_STARTUP_TIMEOUT_MS,
            onAuthorizationUrl,
            onStderr: createAntigravityAuthorizationLineHandler({ onAuthorizationUrl })
          });
          await client.start();
          return {
            stop: async () => {
              await client.shutdown().catch(() => undefined);
            }
          };
        },
        confirmAuthenticated: async () => {
          const plan = await spawnPlanFor(paths.stateDir, auth);
          const client = new AcpClient({
            cwd: paths.stateDir,
            binaryPath: plan.command,
            spawnArgs: [...plan.args],
            spawnCwd: false,
            env: plan.env,
            spawnTimeoutMs: ANTIGRAVITY_STARTUP_TIMEOUT_MS,
            onStderr: createAntigravityAuthorizationLineHandler()
          });
          try {
            await client.start();
            const session = await client.createSession();
            await client.closeSession(session.sessionId).catch(() => undefined);
          } finally {
            await client.shutdown().catch(() => undefined);
          }
        },
        logoutAgent: async () => {
          await localAgents?.shutdownAgent('antigravity');
          const plan = await spawnPlanFor(paths.stateDir, auth);
          const client = new AcpClient({
            cwd: paths.stateDir,
            binaryPath: plan.command,
            spawnArgs: [...plan.args],
            spawnCwd: false,
            env: plan.env,
            spawnTimeoutMs: ANTIGRAVITY_STARTUP_TIMEOUT_MS,
            onStderr: createAntigravityAuthorizationLineHandler()
          });
          try {
            await client.logout();
          } finally {
            await client.shutdown().catch(() => undefined);
          }
        }
      });
    }
    return authFlow;
  }

  ipcMain.handle(
    IPC_CHANNELS.antigravityAuthStart,
    withUserFacingErrors(IPC_CHANNELS.antigravityAuthStart, async (event) => {
      assertTrustedSender(event);
      const auth = await readAuthConfig();
      const issue = antigravityAuthConfigIssue(auth);
      if (issue) {
        throw new Error(issue);
      }
      // A method switch starts a fresh flow; tokens are per-profile anyway.
      authFlow = null;
      const flow = getOrCreateFlow(auth);
      const status = await flow.start();
      if (status.state === 'awaiting-callback') {
        // Open the consent page on the host; remote users paste the redirect.
        await shell.openExternal(status.authorizationUrl).catch(() => undefined);
      }
      return status;
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.antigravityAuthComplete,
    withUserFacingErrors(IPC_CHANNELS.antigravityAuthComplete, async (event, callbackUrl: unknown) => {
      assertTrustedSender(event);
      if (typeof callbackUrl !== 'string' || !callbackUrl.trim()) {
        throw new Error('Paste the redirect URL first.');
      }
      if (!authFlow) {
        throw new Error('Start sign-in first.');
      }
      const status = await authFlow.complete(callbackUrl.trim());
      if (status.state === 'authenticated') {
        await localAgents?.syncRegistry().catch(() => undefined);
      }
      return status;
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.antigravityAuthCancel,
    withUserFacingErrors(IPC_CHANNELS.antigravityAuthCancel, async (event) => {
      assertTrustedSender(event);
      if (!authFlow) return { state: 'idle' };
      return authFlow.cancel();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.antigravityAuthStatus,
    withUserFacingErrors(IPC_CHANNELS.antigravityAuthStatus, async (event) => {
      assertTrustedSender(event);
      if (!authFlow) return { state: 'idle' };
      return authFlow.getStatus();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.antigravityAuthLogout,
    withUserFacingErrors(IPC_CHANNELS.antigravityAuthLogout, async (event) => {
      assertTrustedSender(event);
      // The agent's native logout clears the active method's token; Atlas
      // drops the flow and the keychain API key stays until cleared in Settings.
      if (!authFlow) return { state: 'idle' };
      const status = await authFlow.logout();
      await localAgents?.syncRegistry().catch(() => undefined);
      return status;
    })
  );
}
