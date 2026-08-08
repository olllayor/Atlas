import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from '../client';

export type CheckpointKind = 'pre' | 'post' | 'undo';
export type CheckpointStatus = 'captured' | 'skipped' | 'failed';

export type WorkspaceCheckpointRecord = {
  id: string;
  conversationId: string;
  turnId: string;
  kind: CheckpointKind;
  repoRoot: string;
  refName: string | null;
  commitSha: string | null;
  treeSha: string | null;
  headSha: string | null;
  status: CheckpointStatus;
  skipReason: string | null;
  createdAt: string;
};

type CheckpointRow = {
  id: string;
  conversation_id: string;
  turn_id: string;
  kind: CheckpointKind;
  repo_root: string;
  ref_name: string | null;
  commit_sha: string | null;
  tree_sha: string | null;
  head_sha: string | null;
  status: CheckpointStatus;
  skip_reason: string | null;
  created_at: string;
};

function toRecord(row: CheckpointRow): WorkspaceCheckpointRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    kind: row.kind,
    repoRoot: row.repo_root,
    refName: row.ref_name,
    commitSha: row.commit_sha,
    treeSha: row.tree_sha,
    headSha: row.head_sha,
    status: row.status,
    skipReason: row.skip_reason,
    createdAt: row.created_at
  };
}

export class WorkspaceCheckpointsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Records a checkpoint, or leaves the existing one alone.
   *
   * A turn re-enters this path on every stream retry, context compaction and
   * approval resume. The first capture is the one that defines the turn's
   * baseline, so later attempts are ignored rather than allowed to overwrite it.
   */
  record(input: {
    conversationId: string;
    turnId: string;
    kind: CheckpointKind;
    repoRoot: string;
    refName?: string | null;
    commitSha?: string | null;
    treeSha?: string | null;
    headSha?: string | null;
    status: CheckpointStatus;
    skipReason?: string | null;
  }): WorkspaceCheckpointRecord | null {
    const id = randomUUID();

    this.db
      .prepare(
        `INSERT INTO workspace_checkpoints (
           id, conversation_id, turn_id, kind, repo_root, ref_name, commit_sha,
           tree_sha, head_sha, status, skip_reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(turn_id, kind) DO NOTHING`
      )
      .run(
        id,
        input.conversationId,
        input.turnId,
        input.kind,
        input.repoRoot,
        input.refName ?? null,
        input.commitSha ?? null,
        input.treeSha ?? null,
        input.headSha ?? null,
        input.status,
        input.skipReason ?? null,
        new Date().toISOString()
      );

    return this.get(input.turnId, input.kind);
  }

  get(turnId: string, kind: CheckpointKind): WorkspaceCheckpointRecord | null {
    const row = this.db
      .prepare('SELECT * FROM workspace_checkpoints WHERE turn_id = ? AND kind = ?')
      .get(turnId, kind) as CheckpointRow | undefined;

    return row ? toRecord(row) : null;
  }

  /** Both ends of a turn, when both were captured. */
  getTurnBounds(turnId: string): { pre: WorkspaceCheckpointRecord | null; post: WorkspaceCheckpointRecord | null } {
    return { pre: this.get(turnId, 'pre'), post: this.get(turnId, 'post') };
  }

  listForConversation(conversationId: string): WorkspaceCheckpointRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workspace_checkpoints WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(conversationId) as CheckpointRow[];

    return rows.map(toRecord);
  }

  /**
   * The outer bounds of everything captured for a conversation.
   *
   * `undo` rows are excluded: they record a revert, not a turn, and including
   * them would make the cumulative diff jump backwards.
   */
  getConversationBounds(conversationId: string) {
    const captured = this.listForConversation(conversationId).filter(
      (entry) => entry.status === 'captured' && entry.kind !== 'undo'
    );

    const first = captured.find((entry) => entry.kind === 'pre') ?? null;
    const last = [...captured].reverse().find((entry) => entry.kind === 'post') ?? null;

    return { first, last };
  }

  deleteForConversation(conversationId: string): WorkspaceCheckpointRecord[] {
    const existing = this.listForConversation(conversationId);
    this.db.prepare('DELETE FROM workspace_checkpoints WHERE conversation_id = ?').run(conversationId);
    return existing;
  }
}
