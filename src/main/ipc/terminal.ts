import { ipcMain } from 'electron/main';

import type {
  TerminalHistoryEntry,
  TerminalRef,
  TerminalStartResult,
  TerminalSummary,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isTerminalId } from '../../shared/terminalIds';
import type { AppDatabase } from '../db/client';
import type { PtyService } from '../terminal/PtyService';
import { describeConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * Terminal ids come from the renderer, so they are validated here rather than
 * trusted: an id is part of a map key, and a malformed one would silently
 * open a shell nothing can address again.
 */
function assertRef(ref: TerminalRef): TerminalRef {
  if (typeof ref?.conversationId !== 'string' || !ref.conversationId) {
    throw new Error('A terminal call must name its conversation.');
  }
  if (!isTerminalId(ref.terminalId)) {
    throw new Error(`Unrecognised terminal id: ${String(ref?.terminalId)}`);
  }
  return ref;
}

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
      async (
        event,
        input: TerminalRef & { cols?: number; rows?: number }
      ): Promise<TerminalStartResult> => {
        assertTrustedSender(event);
        const { conversationId, terminalId } = assertRef(input);
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
        return ptyService.start(conversationId, terminalId, cwd, input.cols, input.rows);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalInput,
    withUserFacingErrors(
      IPC_CHANNELS.terminalInput,
      async (event, input: TerminalRef & { data: string }): Promise<void> => {
        assertTrustedSender(event);
        const { conversationId, terminalId } = assertRef(input);
        ptyService.write(conversationId, terminalId, input.data);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalResize,
    withUserFacingErrors(
      IPC_CHANNELS.terminalResize,
      async (event, input: TerminalRef & { cols: number; rows: number }): Promise<void> => {
        assertTrustedSender(event);
        const { conversationId, terminalId } = assertRef(input);
        ptyService.resize(conversationId, terminalId, input.cols, input.rows);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalKill,
    withUserFacingErrors(
      IPC_CHANNELS.terminalKill,
      async (event, input: TerminalRef): Promise<void> => {
        assertTrustedSender(event);
        const { conversationId, terminalId } = assertRef(input);
        ptyService.kill(conversationId, terminalId);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalList,
    withUserFacingErrors(
      IPC_CHANNELS.terminalList,
      async (event, conversationId: string): Promise<TerminalSummary[]> => {
        assertTrustedSender(event);
        return ptyService.list(conversationId);
      }
    )
  );

  /**
   * A renderer with a terminal panel mounted. Refcounted rather than a
   * boolean: two windows can each hold one, and the second closing must not
   * turn the labels off for the first. A renderer that goes away without
   * saying so releases its own count on destruction.
   */
  const watchersBySender = new Map<number, number>();

  ipcMain.handle(
    IPC_CHANNELS.terminalWatch,
    withUserFacingErrors(
      IPC_CHANNELS.terminalWatch,
      async (event, watching: boolean): Promise<void> => {
        assertTrustedSender(event);
        const sender = event.sender;
        const held = watchersBySender.get(sender.id) ?? 0;

        if (watching) {
          if (held === 0) {
            sender.once('destroyed', () => {
              for (let index = 0; index < (watchersBySender.get(sender.id) ?? 0); index += 1) {
                ptyService.removeWatcher();
              }
              watchersBySender.delete(sender.id);
            });
          }
          watchersBySender.set(sender.id, held + 1);
          ptyService.addWatcher();
          return;
        }

        if (held === 0) return;
        watchersBySender.set(sender.id, held - 1);
        ptyService.removeWatcher();
      }
    )
  );
}
