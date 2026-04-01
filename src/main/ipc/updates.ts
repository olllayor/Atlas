import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { UpdateService } from '../updates/UpdateService';
import { assertTrustedSender } from './security';

export function registerUpdatesIpc(updateService: UpdateService) {
  ipcMain.handle(IPC_CHANNELS.updatesGetState, (event) => {
    assertTrustedSender(event);
    return updateService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.updatesCheck, (event) => {
    assertTrustedSender(event);
    return updateService.checkForUpdates({ userInitiated: true });
  });

  ipcMain.handle(IPC_CHANNELS.updatesPerformPrimaryAction, async (event) => {
    assertTrustedSender(event);
    await updateService.performPrimaryAction();
  });
}
