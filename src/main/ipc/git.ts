import { ipcMain } from 'electron/main';

import type {
  GitApplyHunkRequest,
  GitBranchInfo,
  GitCommitRequest,
  GitLogEntry,
  GitReviewRequest,
  GitStateSummary
} from '../../shared/contracts';
import type { ReviewDiff } from '../../shared/review';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import type { GitReviewService } from '../workspace/GitReviewService';
import type { GitStateService } from '../workspace/GitStateService';
import { describeConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerGitIpc(
  db: AppDatabase,
  gitStateService: GitStateService,
  gitReviewService: GitReviewService
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

  // One `git status --porcelain=v1 --branch` carries the branch, the upstream
  // drift and the file list together, so this is a single subprocess rather
  // than the three it used to fan out to.
  const readState = async (root: string): Promise<GitStateSummary> => {
    const { branch, files, ahead, behind } = await gitStateService.getState(root);
    return { isRepo: true, branch, files, ahead, behind };
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

  /**
   * The commit pair bounding one checkpointed assistant turn — the newest by
   * default, or an explicit turn when the review scope list picks one.
   *
   * Read from the checkpoint table rather than from git: only the table knows
   * which refs belong to which turn, and it also records the turns that were
   * *not* captured, which is the difference between "nothing changed" and
   * "this folder is not a repository".
   */
  const turnRange = (
    conversationId: string,
    turnId?: string | null
  ): { from: string; to: string } | null => {
    const captured = db.workspaceCheckpoints
      .listForConversation(conversationId)
      .filter((entry) => entry.status === 'captured' && entry.kind !== 'undo');

    if (turnId) {
      const post = captured.find((entry) => entry.kind === 'post' && entry.turnId === turnId);
      if (!post?.commitSha) return null;
      const pre = captured.find((entry) => entry.turnId === turnId && entry.kind === 'pre');
      return pre?.commitSha ? { from: pre.commitSha, to: post.commitSha } : null;
    }

    for (let index = captured.length - 1; index >= 0; index -= 1) {
      const post = captured[index]!;

      if (post.kind !== 'post' || !post.commitSha) {
        continue;
      }

      const pre = captured.find((entry) => entry.turnId === post.turnId && entry.kind === 'pre');

      if (pre?.commitSha) {
        return { from: pre.commitSha, to: post.commitSha };
      }
    }

    return null;
  };

  // Every checkpointed, reviewable turn in order — the review scope list's
  // "Turn N" rows. Only turns with a usable pre/post pair are listed.
  ipcMain.handle(
    IPC_CHANNELS.gitListReviewTurns,
    withUserFacingErrors(IPC_CHANNELS.gitListReviewTurns, async (event, conversationId: string) => {
      assertTrustedSender(event);

      const workspace = describeConversationWorkspace(db, conversationId);
      const project = workspace.project;
      if (!project || !project.exists || !gitStateService.isGitRepo(project.root)) {
        return [];
      }

      const captured = db.workspaceCheckpoints
        .listForConversation(conversationId)
        .filter((entry) => entry.status === 'captured' && entry.kind !== 'undo');

      const turns: Array<{ turnId: string; createdAt: string }> = [];
      for (const post of captured) {
        if (post.kind !== 'post' || !post.commitSha) continue;
        const pre = captured.find(
          (entry) => entry.turnId === post.turnId && entry.kind === 'pre'
        );
        if (!pre?.commitSha) continue;
        if (turns.some((entry) => entry.turnId === post.turnId)) continue;
        turns.push({ turnId: post.turnId, createdAt: post.createdAt });
      }

      return turns
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((entry, arrayIndex) => ({ ...entry, index: arrayIndex + 1 }));
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.gitReview,
    withUserFacingErrors(
      IPC_CHANNELS.gitReview,
      async (event, request: GitReviewRequest): Promise<ReviewDiff> => {
        assertTrustedSender(event);

        const workspace = describeConversationWorkspace(db, request.conversationId);
        const project = workspace.project;

        // Not an error: an unattached conversation is a normal state, and the
        // pane says so itself rather than showing a failure toast on open.
        if (!project || !project.exists || !gitStateService.isGitRepo(project.root)) {
          return {
            scope: request.scope,
            files: [],
            subject: null,
            emptyReason: 'Attach a project folder that is a git repository to review changes.'
          };
        }

        return gitReviewService.review(project.root, request.scope, {
          commit: request.commit ?? null,
          range:
          request.scope === 'lastTurn'
            ? turnRange(request.conversationId, request.turnId)
            : null
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitStage,
    withUserFacingErrors(
      IPC_CHANNELS.gitStage,
      async (event, conversationId: string, paths: string[]): Promise<void> => {
        assertTrustedSender(event);
        await gitReviewService.stage(resolveRepoRoot(conversationId), paths);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitUnstage,
    withUserFacingErrors(
      IPC_CHANNELS.gitUnstage,
      async (event, conversationId: string, paths: string[]): Promise<void> => {
        assertTrustedSender(event);
        await gitReviewService.unstage(resolveRepoRoot(conversationId), paths);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitRevert,
    withUserFacingErrors(
      IPC_CHANNELS.gitRevert,
      async (event, conversationId: string, paths: string[]): Promise<void> => {
        assertTrustedSender(event);
        await gitReviewService.revert(resolveRepoRoot(conversationId), paths);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.gitApplyHunk,
    withUserFacingErrors(
      IPC_CHANNELS.gitApplyHunk,
      async (event, request: GitApplyHunkRequest): Promise<void> => {
        assertTrustedSender(event);

        await gitReviewService.applyPatch(resolveRepoRoot(request.conversationId), request.patch, {
          cached: request.cached,
          reverse: request.reverse
        });
      }
    )
  );
}
