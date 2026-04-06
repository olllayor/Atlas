import { ipcMain } from 'electron';

import type { SavedVisual, SaveVisualRequest } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { VisualsRepo } from '../db/repositories/visualsRepo';
import { assertTrustedSender } from './security';

export function registerVisualsIpc(visualsRepo: VisualsRepo) {
  ipcMain.handle(
    IPC_CHANNELS.visualsSave,
    (_event, request: SaveVisualRequest): SavedVisual => {
      assertTrustedSender(_event);
      const result = visualsRepo.save({
        id: crypto.randomUUID(),
        title: request.title,
        content: request.content,
        visualType: request.visualType,
        sourceConversationId: request.sourceConversationId ?? null,
        sourceMessageId: request.sourceMessageId ?? null,
      });
      if (!result) throw new Error('Failed to save visual');
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.visualsList,
    (_event, limit = 50): SavedVisual[] => {
      assertTrustedSender(_event);
      return visualsRepo.list(limit);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.visualsGet,
    (_event, id: string): SavedVisual | null => {
      assertTrustedSender(_event);
      return visualsRepo.getById(id);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.visualsSearch,
    (_event, query: string, limit = 50): SavedVisual[] => {
      assertTrustedSender(_event);
      return visualsRepo.search(query, limit);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.visualsDelete,
    (_event, id: string): boolean => {
      assertTrustedSender(_event);
      return visualsRepo.deleteById(id);
    }
  );
}
