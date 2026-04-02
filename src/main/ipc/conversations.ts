import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { ConversationPageRequest } from '../../shared/contracts';
import type { ConversationsRepo } from '../db/repositories/conversationsRepo';
import { assertTrustedSender } from './security';

export function registerConversationsIpc(conversationsRepo: ConversationsRepo) {
  ipcMain.handle(IPC_CHANNELS.conversationsList, (event) => {
    assertTrustedSender(event);
    return conversationsRepo.list();
  });

  ipcMain.handle(IPC_CHANNELS.conversationsCreate, (event) => {
    assertTrustedSender(event);
    return conversationsRepo.create();
  });

  ipcMain.handle(IPC_CHANNELS.conversationsGet, (event, conversationId: string) => {
    assertTrustedSender(event);
    return conversationsRepo.get(conversationId);
  });

  ipcMain.handle(IPC_CHANNELS.conversationsGetPage, (event, conversationId: string, request: ConversationPageRequest | undefined) => {
    assertTrustedSender(event);
    return conversationsRepo.getPage(conversationId, request);
  });

  ipcMain.handle(IPC_CHANNELS.conversationsGetStats, (event) => {
    assertTrustedSender(event);
    return conversationsRepo.getStats();
  });

  ipcMain.handle(IPC_CHANNELS.conversationsDelete, (event, conversationId: string) => {
    assertTrustedSender(event);
    conversationsRepo.delete(conversationId);
  });
}
