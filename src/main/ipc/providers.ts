import { ipcMain } from 'electron/main';

import type { ProviderId } from '../../shared/contracts';
import type {
  CreateCustomProviderRequest,
  DiscoverCustomProviderModelsRequest,
  SetCustomProviderModelsRequest,
  UpdateCustomProviderRequest
} from '../../shared/customProviders';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { CustomProviderService } from '../ai/core/CustomProviderService';
import { assertTrustedSender } from './security';

export function registerProvidersIpc(service: CustomProviderService) {
  ipcMain.handle(IPC_CHANNELS.providersList, async (event) => {
    assertTrustedSender(event);
    return service.list();
  });

  ipcMain.handle(IPC_CHANNELS.providersCreate, async (event, request: CreateCustomProviderRequest) => {
    assertTrustedSender(event);
    return service.create(request);
  });

  ipcMain.handle(IPC_CHANNELS.providersUpdate, async (event, request: UpdateCustomProviderRequest) => {
    assertTrustedSender(event);
    return service.update(request);
  });

  ipcMain.handle(IPC_CHANNELS.providersDelete, async (event, providerId: ProviderId) => {
    assertTrustedSender(event);
    await service.delete(providerId);
  });

  ipcMain.handle(IPC_CHANNELS.providersSetModels, async (event, request: SetCustomProviderModelsRequest) => {
    assertTrustedSender(event);
    return service.setModels(request);
  });

  ipcMain.handle(
    IPC_CHANNELS.providersDiscoverModels,
    async (event, request: DiscoverCustomProviderModelsRequest) => {
      assertTrustedSender(event);
      return service.discoverModels(request);
    }
  );

  ipcMain.handle(IPC_CHANNELS.providersListPresets, async (event) => {
    assertTrustedSender(event);
    return service.listPresets();
  });

  ipcMain.handle(
    IPC_CHANNELS.providersTestConnection,
    async (event, request: DiscoverCustomProviderModelsRequest) => {
      assertTrustedSender(event);
      await service.testConnection(request);
    }
  );
}
