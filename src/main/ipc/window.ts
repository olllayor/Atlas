import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * Window chrome state the renderer cannot read for itself.
 *
 * Only fullscreen so far: native fullscreen hides the macOS traffic lights and
 * the menu bar, and the sidebar's reserved drag strip has to collapse with
 * them. `enter-full-screen`/`leave-full-screen` push every later change from
 * `createWindow`; this handler answers the first paint, before either fires.
 */
export function registerWindowIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.windowGetFullScreen,
    withUserFacingErrors(IPC_CHANNELS.windowGetFullScreen, async (event): Promise<boolean> => {
      assertTrustedSender(event);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) return false;
      return window.isFullScreen();
    })
  );
}
