import { ipcMain } from 'electron/main';

import type { TerminalHistoryEntry } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerTerminalIpc(db: AppDatabase) {
  ipcMain.handle(
    IPC_CHANNELS.terminalHistory,
    withUserFacingErrors(
      IPC_CHANNELS.terminalHistory,
      async (event, conversationId: string, limit = 50): Promise<TerminalHistoryEntry[]> => {
        assertTrustedSender(event);
        return db.terminalHistory.listForConversation(conversationId, limit);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalRecord,
    withUserFacingErrors(
      IPC_CHANNELS.terminalRecord,
      async (
        event,
        conversationId: string,
        command: string,
        exitCode?: number | null
      ): Promise<TerminalHistoryEntry> => {
        assertTrustedSender(event);
        return db.terminalHistory.add({
          conversationId,
          command,
          exitCode: exitCode ?? null,
          finishedAt: new Date().toISOString()
        });
      }
    )
  );
}
