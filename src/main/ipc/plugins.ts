import { dialog, ipcMain } from 'electron/main';
import { shell } from 'electron/common';
import { mkdirSync } from 'node:fs';

import type {
  MarketplaceInput,
  MarketplacesView,
  PluginActivationEntry,
  PluginCommandSummary,
  PluginHealthView,
  PluginUpdateView,
  PluginUrlPreview,
  PluginsView
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import { expandCommandBody } from '../../shared/plugins';
import { readCommandBody } from '../plugins/PluginLoader';
import type { PluginInstaller } from '../plugins/PluginInstaller';
import type { PluginActivationStore } from '../plugins/PluginActivation';
import type { PluginMarketplaceService } from '../plugins/PluginMarketplaceService';
import type { PluginOriginStore } from '../plugins/PluginOrigins';
import type { PluginRegistry } from '../plugins/PluginRegistry';
import type { PluginUpdateService } from '../plugins/PluginUpdateService';
import { buildCommandList, buildPluginHealth, buildPluginsView } from '../plugins/pluginViews';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * Installing and inspecting plugins.
 *
 * Every handler asserts a trusted sender for the same reason the MCP handlers
 * used to: a plugin can carry an MCP server, and the ability to install one is
 * the ability to run code as the user. Nothing here accepts a bundle path from
 * any source but the settings UI, and the picker path never lets a renderer
 * name a directory it was not shown.
 */
import type { McpSecretStore } from '../secrets/mcpSecrets';
import type { McpClientManager } from '../ai/mcp/McpClientManager';
import type { McpServerHealth } from '../ai/mcp/McpClientManager';

export function registerPluginsIpc(deps: {
  registry: PluginRegistry;
  installer: PluginInstaller;
  marketplaces: PluginMarketplaceService;
  updates: PluginUpdateService;
  origins: PluginOriginStore;
  activations: PluginActivationStore;
  secrets?: McpSecretStore;
  /** Present in production; absent where no MCP manager exists. */
  mcpManager?: Pick<McpClientManager, 'health' | 'authorize'>;
  setEnabled: (name: string, enabled: boolean) => void;
  setAlwaysOn: (name: string, alwaysOn: boolean) => void;
  /**
   * The beta switch, read live per call.
   *
   * The renderer hides every entry point when this is off, so a gated handler
   * reaching here means a stale window or a hand-built invoke. Writes refuse;
   * the quiet reads answer empty, and an off feature's surface reveals nothing.
   */
  isEnabled: () => boolean;
}) {
  const requireEnabled = (): void => {
    if (!deps.isEnabled()) {
      throw new Error('Plugins are a beta feature and are turned off. Enable them in Settings → Beta features.');
    }
  };

  /**
   * Every plugins channel goes through the beta gate, except the reads the
   * composer makes on every mount.
   *
   * list/commands/activation/marketplaces answer empty while the beta is off
   * instead of throwing: a throw is a rejected handle, an Electron "Error
   * occurred in handler" line on stderr, and a logger.error per call — per
   * mount, per chat — for a feature the user simply left off. Writes keep
   * the gate by construction instead of by remembering.
   */
  const QUIET_EMPTY: Record<string, () => unknown> = {
    [IPC_CHANNELS.pluginsList]: () => ({ root: deps.registry.root, plugins: [], failures: [] }),
    [IPC_CHANNELS.pluginsCommands]: () => [],
    [IPC_CHANNELS.pluginsActivation]: () => [],
    [IPC_CHANNELS.pluginsMarketplaces]: () => ({ marketplaces: [] }),
  };

  const handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown) =>
    ipcMain.handle(channel, async (event, ...args) => {
      const quiet = QUIET_EMPTY[channel];
      if (quiet && !deps.isEnabled()) return quiet();
      requireEnabled();
      return listener(event, ...(args as never[]));
    });

  const view = (): PluginsView => buildPluginsView(deps.registry, deps.origins);

  handle(
    IPC_CHANNELS.pluginsList,
    withUserFacingErrors(IPC_CHANNELS.pluginsList, async (event): Promise<PluginsView> => {
      assertTrustedSender(event);
      deps.registry.invalidate();
      return view();
    })
  );

  handle(
    IPC_CHANNELS.pluginsInstall,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsInstall,
      async (event, sourceDir: string): Promise<PluginsView> => {
        assertTrustedSender(event);
        requireEnabled();

        const result = deps.installer.install(sourceDir);

        if (!result.ok) {
          throw new Error(result.error);
        }

        return view();
      }
    )
  );

  /**
   * The path a user actually takes.
   *
   * The directory comes from Electron's own picker rather than from the
   * renderer, so the only bundle that can be installed is one the user selected
   * in a native dialog.
   */
  handle(
    IPC_CHANNELS.pluginsInstallFromPicker,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsInstallFromPicker,
      async (event): Promise<PluginsView | null> => {
        assertTrustedSender(event);

        const picked = await dialog.showOpenDialog({
          title: 'Install plugin',
          message: 'Choose a plugin bundle directory',
          properties: ['openDirectory']
        });

        const sourceDir = picked.filePaths[0];

        if (picked.canceled || !sourceDir) {
          return null;
        }

        const result = deps.installer.install(sourceDir);

        if (!result.ok) {
          throw new Error(result.error);
        }

        return view();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsUninstall,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsUninstall,
      async (event, name: string): Promise<PluginsView> => {
        assertTrustedSender(event);

        const result = deps.installer.uninstall(name);

        if (!result.ok) {
          throw new Error(result.error);
        }

        return view();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsSetEnabled,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsSetEnabled,
      async (event, name: string, enabled: boolean): Promise<PluginsView> => {
        assertTrustedSender(event);
        deps.setEnabled(name, enabled);
        deps.registry.invalidate();
        return view();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsMarketplaces,
    withUserFacingErrors(IPC_CHANNELS.pluginsMarketplaces, async (event): Promise<MarketplacesView> => {
      assertTrustedSender(event);
      return deps.marketplaces.view();
    })
  );

  handle(
    IPC_CHANNELS.pluginsAddMarketplace,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsAddMarketplace,
      async (event, input: MarketplaceInput): Promise<MarketplacesView> => {
        assertTrustedSender(event);

        deps.marketplaces.add(
          input.kind === 'git'
            ? { name: input.name, source: { kind: 'git', url: input.url, ref: input.ref } }
            : { name: input.name, source: { kind: 'path', path: input.path } }
        );

        return deps.marketplaces.view();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsRemoveMarketplace,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsRemoveMarketplace,
      async (event, name: string): Promise<MarketplacesView> => {
        assertTrustedSender(event);
        deps.marketplaces.remove(name);
        return deps.marketplaces.view();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsInstallFromMarketplace,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsInstallFromMarketplace,
      async (event, marketplace: string, plugin: string): Promise<PluginsView> => {
        assertTrustedSender(event);
        deps.marketplaces.install(marketplace, plugin);
        return view();
      }
    )
  );

  /**
   * What a pasted repository link would install.
   *
   * Fetches and reads the bundle, then throws the checkout away without
   * installing anything. Split from the install so the confirmation the user
   * sees is built from the bundle that actually landed — the literal commands,
   * the literal endpoints — rather than from a description its author wrote.
   */
  handle(
    IPC_CHANNELS.pluginsPreviewUrl,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsPreviewUrl,
      async (event, url: unknown): Promise<PluginUrlPreview> => {
        assertTrustedSender(event);

        if (typeof url !== 'string') {
          throw new Error('Enter a repository URL.');
        }

        return deps.marketplaces.previewUrl(url);
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsInstallFromUrl,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsInstallFromUrl,
      async (event, url: unknown): Promise<PluginsView> => {
        assertTrustedSender(event);

        if (typeof url !== 'string') {
          throw new Error('Enter a repository URL.');
        }

        // Re-fetched rather than reusing whatever the preview saw. The preview
        // is a read the user made a decision from; this is the install. Handing
        // the installer a checkout held open between two IPC calls would mean
        // the reviewed bytes and the installed bytes are only the same by
        // assumption — and it would keep a temp directory alive on a path the
        // user might simply abandon.
        deps.marketplaces.installFromUrl(url);
        return view();
      }
    )
  );

  /**
   * Asks every marketplace what it currently offers.
   *
   * Costs a fetch per git marketplace, which is why it is a button rather than
   * a timer: a background poll would be network the user did not ask for and a
   * heartbeat to every remote they have added.
   */
  handle(
    IPC_CHANNELS.pluginsCheckUpdates,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsCheckUpdates,
      async (event): Promise<PluginUpdateView[]> => {
        assertTrustedSender(event);
        return deps.updates.check();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsUpdate,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsUpdate,
      async (event, name: string): Promise<PluginsView> => {
        assertTrustedSender(event);
        deps.updates.update(name);
        return view();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsCommands,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsCommands,
      async (event): Promise<PluginCommandSummary[]> => {
        assertTrustedSender(event);
        return buildCommandList(deps.registry);
      }
    )
  );

  /**
   * One command's template, expanded with what the user typed after its name.
   *
   * Resolved from the registry rather than from a path the renderer sends, so
   * this cannot be turned into a way to read an arbitrary file. A disabled or
   * revoked plugin's commands are not in the snapshot and so cannot be reached.
   */
  handle(
    IPC_CHANNELS.pluginsCommandBody,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsCommandBody,
      async (event, qualifiedName: string, args: string): Promise<string> => {
        assertTrustedSender(event);

        const command = deps.registry
          .snapshot()
          .plugins.flatMap((plugin) => plugin.commands)
          .find((candidate) => candidate.qualifiedName === qualifiedName);

        if (!command) {
          throw new Error(`"${qualifiedName}" is not an installed command.`);
        }

        const body = readCommandBody(command);

        if (body == null) {
          throw new Error(`"${qualifiedName}" could not be read.`);
        }

        return expandCommandBody(body, typeof args === 'string' ? args : '');
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsActivation,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsActivation,
      async (event, conversationId: string): Promise<PluginActivationEntry[]> => {
        assertTrustedSender(event);
        return deps.activations.status(conversationId);
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsSetActivated,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsSetActivated,
      async (
        event,
        conversationId: string,
        plugin: string,
        active: boolean
      ): Promise<PluginActivationEntry[]> => {
        assertTrustedSender(event);

        if (active) {
          deps.activations.activate(conversationId, [plugin]);
        } else {
          deps.activations.deactivate(conversationId, plugin);
        }

        return deps.activations.status(conversationId);
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsSetAlwaysOn,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsSetAlwaysOn,
      async (
        event,
        conversationId: string,
        plugin: string,
        alwaysOn: boolean
      ): Promise<PluginActivationEntry[]> => {
        assertTrustedSender(event);
        deps.setAlwaysOn(plugin, alwaysOn);
        return deps.activations.status(conversationId);
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsConfigureAuth,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsConfigureAuth,
      async (event, pluginName: string, credentials: Record<string, string>): Promise<PluginsView> => {
        assertTrustedSender(event);
        if (deps.secrets) {
          await deps.secrets.setPluginCredentials(pluginName, credentials);
        }
        deps.registry.invalidate();
        return view();
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsCheckHealth,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsCheckHealth,
      async (event, pluginName: string): Promise<PluginHealthView> => {
        assertTrustedSender(event);

        if (!deps.mcpManager) {
          return { ok: false, servers: [], error: 'The MCP manager is not available.' };
        }

        const snapshot = deps.registry.snapshot();
        const plugin = snapshot.plugins.find((p) => p.manifest.name === pluginName)
          ?? snapshot.disabled.find((p) => p.manifest.name === pluginName);

        // Asked for real: each server is connected, `tools/list` is spoken to
        // it, and its failure record is consulted — the same path a turn's
        // tool resolution runs, so "ready" here means ready there.
        return buildPluginHealth(plugin, await deps.mcpManager.health());
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsConnectServer,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsConnectServer,
      async (
        event,
        pluginName: string,
        serverKey: string
      ): Promise<{ ok: boolean; status?: 'ready' | 'authorization-required'; error?: string }> => {
        assertTrustedSender(event);

        if (!deps.mcpManager) {
          return { ok: false, error: 'The MCP manager is not available.' };
        }

        const serverId = `plugin:${pluginName}:${serverKey}`;

        try {
          const status = await deps.mcpManager.authorize(serverId);
          return { ok: status === 'ready', status };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
    )
  );

  handle(
    IPC_CHANNELS.pluginsRevealRoot,
    withUserFacingErrors(IPC_CHANNELS.pluginsRevealRoot, async (event): Promise<void> => {
      assertTrustedSender(event);
      // Created on demand: the ordinary state is that it does not exist yet,
      // and opening nothing would look like a failure.
      mkdirSync(deps.registry.root, { recursive: true });
      await shell.openPath(deps.registry.root);
    })
  );
}
