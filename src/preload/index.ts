import { contextBridge, ipcRenderer } from 'electron';

import type { RendererApi } from '../shared/contracts';
import { IPC_CHANNELS } from '../shared/ipc';

const api: RendererApi = {
  settings: {
    getSummary: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetSummary),
    saveOpenRouterKey: (secret) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsSaveOpenRouterKey, secret),
    validateOpenRouterKey: () =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsValidateOpenRouterKey),
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
    get: (conversationId) => ipcRenderer.invoke(IPC_CHANNELS.conversationsGet, conversationId)
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
  }
};

contextBridge.exposeInMainWorld('cheapChat', api);
