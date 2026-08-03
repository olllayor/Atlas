import { ipcMain } from 'electron/main';

import type {
  GitBranchInfo,
  GitCommitRequest,
  GitLogEntry,
  GitStateSummary
} from '../../shared/contracts';
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
  const EMPTY_STATE: GitStateSummary = {
    isRepo: false,
    branch: null,
    files: [],
    ahead: null,
    behind: null
  };

  /**
   * The repository this conversation may act on.
   *
   * Resolved from the conversation row rather than from an argument, so a git
   * write can only ever land in the folder the conversation is attached to.
   */
  const resolveRepoRoot = (conversationId: string): string => {
    const workspace = describeConversationWorkspace(db, conversationId);
    const project = workspace.project;

    if (!project || !project.exists) {
      throw new Error('This conversation has no project folder attached.');
    }

    if (workspace.mode !== 'code') {
      throw new Error('Git actions are only available in Code mode.');
    }

    if (!gitStateService.isGitRepo(project.root)) {
      throw new Error(`${project.root} is not a git repository.`);
    }

    return project.root;
  };

  const readState = async (root: string): Promise<GitStateSummary> => {
    const [branch, files, aheadBehind] = await Promise.all([
      gitStateService.getBranch(root),
      gitStateService.getStatus(root),
      gitStateService.getAheadBehind(root)
    ]);

    return { isRepo: true, branch, files, ahead: aheadBehind.ahead, behind: aheadBehind.behind };
  };

  ipcMain.handle(
    IPC_CHANNELS.gitState,
    withUserFacingErrors(
      IPC_CHANNELS.gitState,
      async (event, conversationId: string): Promise<GitStateSummary> => {
        assertTrustedSender(event);
        const workspace = describeConversationWorkspace(db, conversationId);
        const project = workspace.project;

        if (!project || !project.exists || !gitStateService.isGitRepo(project.root)) {
          return EMPTY_STATE;
        }

        return readState(project.root);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitSwitchBranch,
    withUserFacingErrors(
      IPC_CHANNELS.gitSwitchBranch,
      async (event, conversationId: string, name: string): Promise<GitStateSummary> => {
        assertTrustedSender(event);
        const root = resolveRepoRoot(conversationId);
        await gitStateService.switchBranch(root, name);
        return readState(root);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitCreateBranch,
    withUserFacingErrors(
      IPC_CHANNELS.gitCreateBranch,
      async (event, conversationId: string, name: string): Promise<GitStateSummary> => {
        assertTrustedSender(event);
        const root = resolveRepoRoot(conversationId);
        await gitStateService.createBranch(root, name);
        return readState(root);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitCommit,
    withUserFacingErrors(
      IPC_CHANNELS.gitCommit,
      async (event, request: GitCommitRequest): Promise<string> => {
        assertTrustedSender(event);
        const root = resolveRepoRoot(request.conversationId);
        return gitStateService.commit(root, {
          message: request.message,
          amend: request.amend,
          addAll: request.addAll
        });
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
        // Clamp to valid range to prevent bad CLI args
        const clampedCount = Math.max(1, Math.min(Number(maxCount) || 20, 200));
        return gitStateService.getLog(project.root, clampedCount);
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
