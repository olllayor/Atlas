import { shell } from 'electron/common';
import { ipcMain } from 'electron/main';

import type { DiscoveredServer } from '../../shared/browser';
import { isBrowsableUrl } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { PortDiscovery } from '../browser/PortDiscovery';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * The Browser surface's only main-process call.
 *
 * Discovery takes no argument on purpose: what is listening on this machine
 * has nothing to do with which conversation asked, and letting the renderer
 * name a host or a port range would turn a convenience into a scanner.
 */
export function registerBrowserIpc(portDiscovery: PortDiscovery) {
  ipcMain.handle(
    IPC_CHANNELS.browserDiscoverServers,
    withUserFacingErrors(
      IPC_CHANNELS.browserDiscoverServers,
      async (event): Promise<DiscoveredServer[]> => {
        assertTrustedSender(event);
        return portDiscovery.scan();
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.browserOpenExternal,
    withUserFacingErrors(
      IPC_CHANNELS.browserOpenExternal,
      async (event, url: string): Promise<void> => {
        assertTrustedSender(event);
        // The URL reaches the OS handler, so the scheme is checked here
        // rather than trusted from the surface that passed it along.
        if (!isBrowsableUrl(url)) {
          throw new Error('Only http and https links can be opened.');
        }
        await shell.openExternal(url);
      }
    )
  );
}
