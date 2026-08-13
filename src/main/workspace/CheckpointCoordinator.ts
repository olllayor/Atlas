import type { AppDatabase } from '../db/client';
import type { CheckpointKind } from '../db/repositories/workspaceCheckpointsRepo';
import { logger } from '../observability/logger';
import { WorkspaceCheckpointService } from './WorkspaceCheckpointService';
import { describeConversationWorkspace } from './conversationWorkspace';

/**
 * What ChatEngine needs from checkpointing, and nothing else.
 *
 * Narrow on purpose: the engine must not be able to make a checkpoint failure
 * into a turn failure, so neither method reports one.
 */
export type TurnCheckpointHooks = {
  captureTurnStart: (conversationId: string, turnId: string) => Promise<void>;
  captureTurnEnd: (conversationId: string, turnId: string) => Promise<void>;
};

export const NOOP_TURN_CHECKPOINTS: TurnCheckpointHooks = {
  captureTurnStart: async () => undefined,
  captureTurnEnd: async () => undefined
};

/**
 * Decides whether a turn can be checkpointed, and records the answer either way.
 *
 * A skipped capture is written down with its reason rather than dropped: "this
 * turn has no diff" and "this turn's folder is not a repository" look identical
 * in the UI otherwise, and only one of them is worth explaining to the user.
 *
 * Nothing here throws. A conversation whose snapshot fails is still a
 * conversation that should send.
 */
export class CheckpointCoordinator implements TurnCheckpointHooks {
  /**
   * One capture at a time per conversation.
   *
   * The end of one turn and the start of the next are recorded from different
   * places, and only one of them is in a position to await. Chaining them here
   * means the next turn's baseline cannot be taken before the previous turn's
   * result has been, whichever order the calls arrive in.
   */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly db: AppDatabase,
    private readonly service = new WorkspaceCheckpointService()
  ) {}

  captureTurnStart = (conversationId: string, turnId: string) =>
    this.enqueue(conversationId, () => this.capture(conversationId, turnId, 'pre'));

  captureTurnEnd = (conversationId: string, turnId: string) =>
    this.enqueue(conversationId, () => this.capture(conversationId, turnId, 'post'));

  private enqueue(conversationId: string, work: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(conversationId) ?? Promise.resolve()).then(work, work);
    this.queues.set(conversationId, next);

    void next.finally(() => {
      if (this.queues.get(conversationId) === next) {
        this.queues.delete(conversationId);
      }
    });

    return next;
  }

  /**
   * The post capture is only meaningful next to a pre capture, so a turn that
   * was skipped at the start is skipped at the end too rather than recording a
   * lone endpoint that nothing can be diffed against.
   */
  private async capture(conversationId: string, turnId: string, kind: CheckpointKind) {
    try {
      const repo = this.db.workspaceCheckpoints;

      if (kind === 'post' && repo.get(turnId, 'pre')?.status !== 'captured') {
        return;
      }

      if (repo.get(turnId, kind)) {
        return;
      }

      const reason = await this.describeBlocker(conversationId);
      const root = this.resolveRoot(conversationId);

      if (reason || !root) {
        repo.record({
          conversationId,
          turnId,
          kind,
          repoRoot: root ?? '',
          status: 'skipped',
          skipReason: reason ?? 'No project folder is attached.'
        });
        return;
      }

      const captured = await this.service.captureAndRelease(root, {
        conversationId,
        turnId,
        kind
      });

      repo.record({
        conversationId,
        turnId,
        kind,
        repoRoot: root,
        refName: captured.refName,
        commitSha: captured.commitSha,
        treeSha: captured.treeSha,
        headSha: captured.headSha,
        status: 'captured'
      });
    } catch (error) {
      logger.warn('checkpoint.capture_failed', {
        conversationId,
        turnId,
        kind,
        error: error instanceof Error ? error.message : String(error)
      });

      this.recordFailure(conversationId, turnId, kind, error);
    }
  }

  private recordFailure(
    conversationId: string,
    turnId: string,
    kind: CheckpointKind,
    error: unknown
  ) {
    try {
      this.db.workspaceCheckpoints.record({
        conversationId,
        turnId,
        kind,
        repoRoot: this.resolveRoot(conversationId) ?? '',
        status: 'failed',
        skipReason: error instanceof Error ? error.message : String(error)
      });
    } catch {
      // The database is the last thing that can be tried; if it refuses too,
      // the log line above is the whole record.
    }
  }

  private resolveRoot(conversationId: string): string | null {
    const workspace = describeConversationWorkspace(this.db, conversationId);
    const project = workspace.project;

    if (workspace.mode !== 'code' || !project || !project.exists) {
      return null;
    }

    return project.root;
  }

  /** The reason this conversation cannot be checkpointed, or null. */
  private async describeBlocker(conversationId: string): Promise<string | null> {
    const workspace = describeConversationWorkspace(this.db, conversationId);
    const project = workspace.project;

    if (workspace.mode !== 'code') {
      return 'Checkpoints are only captured in Code mode.';
    }

    if (!project || !project.exists) {
      return 'No project folder is attached.';
    }

    if (!(await this.service.isGitRepo(project.root))) {
      return `${project.root} is not a git repository.`;
    }

    return null;
  }
}
