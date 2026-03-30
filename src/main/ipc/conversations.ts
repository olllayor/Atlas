import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
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
}
