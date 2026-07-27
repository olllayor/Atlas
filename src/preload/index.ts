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
  providers: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.providersList),
    create: (request) => ipcRenderer.invoke(IPC_CHANNELS.providersCreate, request),
    update: (request) => ipcRenderer.invoke(IPC_CHANNELS.providersUpdate, request),
    delete: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.providersDelete, providerId),
    setModels: (request) => ipcRenderer.invoke(IPC_CHANNELS.providersSetModels, request),
    discoverModels: (request) => ipcRenderer.invoke(IPC_CHANNELS.providersDiscoverModels, request),
    testConnection: (request) => ipcRenderer.invoke(IPC_CHANNELS.providersTestConnection, request),
    listPresets: () => ipcRenderer.invoke(IPC_CHANNELS.providersListPresets)
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
    respondToolApproval: (request) => ipcRenderer.invoke(IPC_CHANNELS.chatRespondToolApproval, request),
    getRuntimeState: (request) => ipcRenderer.invoke(IPC_CHANNELS.chatGetRuntimeState, request),
    recoverEvents: (request) => ipcRenderer.invoke(IPC_CHANNELS.chatRecoverEvents, request),
    openVisualWindow: (request) => ipcRenderer.invoke(IPC_CHANNELS.chatOpenVisualWindow, request),
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
  visuals: {
    save: (request) => ipcRenderer.invoke(IPC_CHANNELS.visualsSave, request),
    list: (limit) => ipcRenderer.invoke(IPC_CHANNELS.visualsList, limit),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.visualsGet, id),
    search: (query, limit) => ipcRenderer.invoke(IPC_CHANNELS.visualsSearch, query, limit),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.visualsDelete, id)
  },
  sites: {
    list: (includeDeleted) => ipcRenderer.invoke(IPC_CHANNELS.sitesList, includeDeleted ?? false),
    get: (siteId) => ipcRenderer.invoke(IPC_CHANNELS.sitesGet, siteId),
    create: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesCreate, request),
    rename: (siteId, title) => ipcRenderer.invoke(IPC_CHANNELS.sitesRename, siteId, title),
    delete: (siteId) => ipcRenderer.invoke(IPC_CHANNELS.sitesDelete, siteId),
    restore: (siteId) => ipcRenderer.invoke(IPC_CHANNELS.sitesRestore, siteId),
    purge: (siteId) => ipcRenderer.invoke(IPC_CHANNELS.sitesPurge, siteId),
    readFile: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesReadFile, request),
    writeFile: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesWriteFile, request),
    deleteFile: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesDeleteFile, request),
    build: (siteId) => ipcRenderer.invoke(IPC_CHANNELS.sitesBuild, siteId),
    review: (siteId) => ipcRenderer.invoke(IPC_CHANNELS.sitesReview, siteId),
    publish: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesPublish, request),
    unpublish: (siteId) => ipcRenderer.invoke(IPC_CHANNELS.sitesUnpublish, siteId),
    rollback: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesRollback, request),
    resetDraft: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesResetDraft, request),
    previewTarget: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesPreviewTarget, request),
    openPreviewWindow: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesOpenPreviewWindow, request),
    export: (request) => ipcRenderer.invoke(IPC_CHANNELS.sitesExport, request),
    openInBrowser: (siteId, versionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sitesOpenInBrowser, siteId, versionId ?? null)
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
  },
  posthog: {
    getAnonymousId: () => ipcRenderer.invoke(IPC_CHANNELS.posthogGetAnonymousId),
    captureEvent: (event, properties) => {
      ipcRenderer.invoke(IPC_CHANNELS.posthogCaptureEvent, event, properties);
    },
    isTelemetryEnabled: () => ipcRenderer.invoke(IPC_CHANNELS.posthogGetTelemetryEnabled),
    setTelemetryEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.posthogSetTelemetryEnabled, enabled)
  }
};

contextBridge.exposeInMainWorld('atlasChat', api);
