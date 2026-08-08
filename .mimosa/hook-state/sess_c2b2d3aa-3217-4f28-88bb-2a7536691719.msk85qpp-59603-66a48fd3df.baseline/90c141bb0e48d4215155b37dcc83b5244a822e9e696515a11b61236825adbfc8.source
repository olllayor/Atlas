import { ipcMain } from 'electron/main';

import type { FileChangeSummary } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import type { FileChangeTracker } from '../workspace/FileChangeTracker';
import type { FileChangeRecord } from '../db/repositories/fileChangesRepo';
import { describeConversationWorkspace, resolveConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerFileChangesIpc(
  db: AppDatabase,
  fileChangeTracker: FileChangeTracker
) {
  ipcMain.handle(
    IPC_CHANNELS.fileChangesList,
    withUserFacingErrors(
      IPC_CHANNELS.fileChangesList,
      async (event, conversationId: string): Promise<FileChangeRecord[]> => {
        assertTrustedSender(event);
        return fileChangeTracker.listChanges(conversationId);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.fileChangesRevert,
    withUserFacingErrors(
      IPC_CHANNELS.fileChangesRevert,
      async (event, conversationId: string, changeId: string): Promise<FileChangeRecord> => {
        assertTrustedSender(event);
        const workspace = resolveConversationWorkspace(db, conversationId);
        return fileChangeTracker.revertChange(changeId, workspace);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.fileChangesAccept,
    withUserFacingErrors(
      IPC_CHANNELS.fileChangesAccept,
      async (event, changeId: string): Promise<FileChangeRecord> => {
        assertTrustedSender(event);
        return fileChangeTracker.acceptChange(changeId);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.fileChangesSummary,
    withUserFacingErrors(
      IPC_CHANNELS.fileChangesSummary,
      async (event, conversationId: string): Promise<FileChangeSummary> => {
        assertTrustedSender(event);
        const changes = fileChangeTracker.listChanges(conversationId);
        let added = 0;
        let removed = 0;

        const files = changes.map((c) => {
          for (const line of c.diffText.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) added++;
            if (line.startsWith('-') && !line.startsWith('---')) removed++;
          }
          return {
            id: c.id,
            filePath: c.filePath,
            diffText: c.diffText,
            status: c.status
          };
        });

        return {
          fileCount: files.length,
          added,
          removed,
          files
        };
      }
    )
  );
}
