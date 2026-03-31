import { ipcMain } from 'electron/main';

import type { ListModelsOptions, ProviderId } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { ModelRegistry } from '../ai/core/ModelRegistry';
import { assertTrustedSender } from './security';

export function registerModelsIpc(modelRegistry: ModelRegistry) {
  ipcMain.handle(IPC_CHANNELS.modelsList, (event, options: ListModelsOptions | undefined) => {
    assertTrustedSender(event);
    return modelRegistry.list(options ?? {});
  });

  ipcMain.handle(IPC_CHANNELS.modelsRefresh, async (event) => {
    assertTrustedSender(event);
    return modelRegistry.refresh();
  });

  ipcMain.handle(IPC_CHANNELS.modelsRefreshProvider, async (event, providerId: ProviderId) => {
    assertTrustedSender(event);
    return modelRegistry.refreshProvider(providerId);
  });
}
