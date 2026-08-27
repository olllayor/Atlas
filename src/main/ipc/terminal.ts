import { ipcMain } from 'electron/main';

import type { TerminalHistoryEntry, TerminalStartResult } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import type { PtyService } from '../terminal/PtyService';
import { describeConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerTerminalIpc(db: AppDatabase, ptyService: PtyService) {
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

  ipcMain.handle(
    IPC_CHANNELS.terminalStart,
    withUserFacingErrors(
      IPC_CHANNELS.terminalStart,
      async (event, conversationId: string, cols?: number, rows?: number): Promise<TerminalStartResult> => {
        assertTrustedSender(event);
        // The cwd comes from the conversation row, never from the renderer:
        // the shell starts where the rest of the turn's tools are confined
        // to — the worktree root when the conversation runs in one, so a
        // command typed here lands in the same tree the agent edits.
        const workspace = describeConversationWorkspace(db, conversationId);
        const cwd =
          workspace.executionTarget === 'worktree' && workspace.worktreeRoot
            ? workspace.worktreeRoot
            : workspace.project?.exists
              ? workspace.project.root
              : null;
        return ptyService.start(conversationId, cwd, cols, rows);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalInput,
    withUserFacingErrors(
      IPC_CHANNELS.terminalInput,
      async (event, conversationId: string, data: string): Promise<void> => {
        assertTrustedSender(event);
        ptyService.write(conversationId, data);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalResize,
    withUserFacingErrors(
      IPC_CHANNELS.terminalResize,
      async (event, conversationId: string, cols: number, rows: number): Promise<void> => {
        assertTrustedSender(event);
        ptyService.resize(conversationId, cols, rows);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalKill,
    withUserFacingErrors(
      IPC_CHANNELS.terminalKill,
      async (event, conversationId: string): Promise<void> => {
        assertTrustedSender(event);
        ptyService.kill(conversationId);
      }
    )
  );
}
