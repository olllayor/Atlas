import { ipcMain } from 'electron/main';

import type { GitBranchInfo, GitLogEntry, GitStateSummary } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import type { GitStateService } from '../workspace/GitStateService';
import { describeConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerGitIpc(
  db: AppDatabase,
  gitStateService: GitStateService
) {
  ipcMain.handle(
    IPC_CHANNELS.gitState,
    withUserFacingErrors(
      IPC_CHANNELS.gitState,
      async (event, conversationId: string): Promise<GitStateSummary> => {
        assertTrustedSender(event);
        const workspace = describeConversationWorkspace(db, conversationId);
        const project = workspace.project;

        if (!project || !project.exists) {
          return { isRepo: false, branch: null, files: [] };
        }

        const isRepo = gitStateService.isGitRepo(project.root);
        if (!isRepo) {
          return { isRepo: false, branch: null, files: [] };
        }

        const branch = await gitStateService.getBranch(project.root);
        const files = await gitStateService.getStatus(project.root);

        return { isRepo: true, branch, files };
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitLog,
    withUserFacingErrors(
      IPC_CHANNELS.gitLog,
      async (event, conversationId: string, maxCount = 20): Promise<GitLogEntry[]> => {
        assertTrustedSender(event);
        const workspace = describeConversationWorkspace(db, conversationId);
        const project = workspace.project;

        if (!project || !project.exists) return [];
        return gitStateService.getLog(project.root, maxCount);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitBranches,
    withUserFacingErrors(
      IPC_CHANNELS.gitBranches,
      async (event, conversationId: string): Promise<GitBranchInfo[]> => {
        assertTrustedSender(event);
        const workspace = describeConversationWorkspace(db, conversationId);
        const project = workspace.project;

        if (!project || !project.exists) return [];
        return gitStateService.getBranches(project.root);
      }
    )
  );
}
