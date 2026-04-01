export const IPC_CHANNELS = {
  settingsGetSummary: 'settings:getSummary',
  settingsSaveOpenRouterKey: 'settings:saveOpenRouterKey',
  settingsValidateOpenRouterKey: 'settings:validateOpenRouterKey',
  settingsUpdatePreferences: 'settings:updatePreferences',
  modelsList: 'models:list',
  modelsRefresh: 'models:refresh',
  conversationsList: 'conversations:list',
  conversationsCreate: 'conversations:create',
  conversationsGet: 'conversations:get',
  chatStart: 'chat:start',
  chatAbort: 'chat:abort',
  chatEvent: 'chat:event',
  updatesGetState: 'updates:getState',
  updatesCheck: 'updates:check',
  updatesPerformPrimaryAction: 'updates:performPrimaryAction',
  updatesEvent: 'updates:event'
} as const;
