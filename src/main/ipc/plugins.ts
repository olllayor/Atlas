import { dialog, ipcMain } from 'electron/main';
import { shell } from 'electron/common';
import { mkdirSync } from 'node:fs';

import type {
  MarketplaceInput,
  MarketplacesView,
  PluginActivationEntry,
  PluginsView
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { PluginInstaller } from '../plugins/PluginInstaller';
import type { PluginActivationStore } from '../plugins/PluginActivation';
import type { PluginMarketplaceService } from '../plugins/PluginMarketplaceService';
import type { PluginRegistry } from '../plugins/PluginRegistry';
import { buildPluginsView } from '../plugins/pluginViews';
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
export function registerPluginsIpc(deps: {
  registry: PluginRegistry;
  installer: PluginInstaller;
  marketplaces: PluginMarketplaceService;
  activations: PluginActivationStore;
  setEnabled: (name: string, enabled: boolean) => void;
  setAlwaysOn: (name: string, alwaysOn: boolean) => void;
}) {
  const view = (): PluginsView => buildPluginsView(deps.registry);

  ipcMain.handle(
    IPC_CHANNELS.pluginsList,
    withUserFacingErrors(IPC_CHANNELS.pluginsList, async (event): Promise<PluginsView> => {
      assertTrustedSender(event);
      deps.registry.invalidate();
      return view();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.pluginsInstall,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsInstall,
      async (event, sourceDir: string): Promise<PluginsView> => {
        assertTrustedSender(event);

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
  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
    IPC_CHANNELS.pluginsMarketplaces,
    withUserFacingErrors(IPC_CHANNELS.pluginsMarketplaces, async (event): Promise<MarketplacesView> => {
      assertTrustedSender(event);
      return deps.marketplaces.view();
    })
  );

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
    IPC_CHANNELS.pluginsActivation,
    withUserFacingErrors(
      IPC_CHANNELS.pluginsActivation,
      async (event, conversationId: string): Promise<PluginActivationEntry[]> => {
        assertTrustedSender(event);
        return deps.activations.status(conversationId);
      }
    )
  );

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
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
