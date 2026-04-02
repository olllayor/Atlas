import { contextBridge, ipcRenderer } from 'electron';

import type { RendererApi } from '../shared/contracts';
import { IPC_CHANNELS } from '../shared/ipc';

const api: RendererApi = {
  settings: {
    getSummary: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetSummary),
    saveProviderKey: (providerId, secret) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsSaveProviderKey, providerId, secret),
    validateProviderKey: (providerId, secret) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsValidateProviderKey, providerId, secret),
    updatePreferences: (patch) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsUpdatePreferences, patch)
  },
  models: {
    list: (options) => ipcRenderer.invoke(IPC_CHANNELS.modelsList, options),
    refresh: () => ipcRenderer.invoke(IPC_CHANNELS.modelsRefresh)
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.conversationsList),
    create: () => ipcRenderer.invoke(IPC_CHANNELS.conversationsCreate),
    get: (conversationId) => ipcRenderer.invoke(IPC_CHANNELS.conversationsGet, conversationId),
    getPage: (conversationId, request) => ipcRenderer.invoke(IPC_CHANNELS.conversationsGetPage, conversationId, request),
    getStats: () => ipcRenderer.invoke(IPC_CHANNELS.conversationsGetStats),
    delete: (conversationId) => ipcRenderer.invoke(IPC_CHANNELS.conversationsDelete, conversationId)
  },
  chat: {
    start: (request) => ipcRenderer.invoke(IPC_CHANNELS.chatStart, request),
    abort: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.chatAbort, requestId),
    subscribe: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) => {
        listener(payload);
      };

      ipcRenderer.on(IPC_CHANNELS.chatEvent, handler);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.chatEvent, handler);
      };
    }
  },
  diagnostics: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsGetSnapshot)
  },
  updates: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.updatesGetState),
    check: () => ipcRenderer.invoke(IPC_CHANNELS.updatesCheck),
    performPrimaryAction: () => ipcRenderer.invoke(IPC_CHANNELS.updatesPerformPrimaryAction),
    subscribe: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) => {
        listener(payload);
      };

      ipcRenderer.on(IPC_CHANNELS.updatesEvent, handler);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.updatesEvent, handler);
      };
    }
  }
};

contextBridge.exposeInMainWorld('atlasChat', api);
