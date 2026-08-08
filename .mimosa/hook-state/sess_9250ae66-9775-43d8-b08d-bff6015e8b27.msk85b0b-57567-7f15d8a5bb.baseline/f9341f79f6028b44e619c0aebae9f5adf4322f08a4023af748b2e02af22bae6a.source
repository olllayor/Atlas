import { rmSync, statSync, writeFileSync } from 'node:fs';

import type { FileChangeRecord, FileChangesRepo } from '../db/repositories/fileChangesRepo';
import type { ToolWorkspace } from '../ai/tools/toolWorkspace';
import { canWriteFiles, resolveWritablePath } from '../ai/tools/toolWorkspace';

export class FileChangeTracker {
  constructor(private readonly repo: FileChangesRepo) {}

  recordChange(input: {
    conversationId: string;
    filePath: string;
    beforeContent?: string | null;
    afterContent?: string | null;
    diffText: string;
    toolCallId?: string | null;
  }): FileChangeRecord {
    return this.repo.create(input);
  }

  listChanges(conversationId: string): FileChangeRecord[] {
    return this.repo.listForConversation(conversationId);
  }

  acceptChange(id: string): FileChangeRecord {
    return this.repo.updateStatus(id, 'accepted');
  }

  revertChange(id: string, workspace: ToolWorkspace): FileChangeRecord {
    const change = this.repo.get(id);
    if (!change) {
      throw new Error(`File change ${id} not found.`);
    }

    if (change.status === 'reverted') {
      return change;
    }

    if (!canWriteFiles(workspace)) {
      throw new Error('Reverting file changes is only allowed in Code mode with an attached project folder.');
    }

    const resolvedPath = resolveWritablePath(change.filePath, workspace);

    if (change.beforeContent != null) {
      writeFileSync(resolvedPath, change.beforeContent, 'utf8');
    } else {
      // File was created by the agent — remove it. Guard against accidentally
      // targeting a directory (which would need recursive: true).
      try {
        const stat = statSync(resolvedPath, { throwIfNoEntry: false });
        if (stat && stat.isFile()) {
          rmSync(resolvedPath, { force: true });
        }
      } catch (err) {
        console.warn(`[FileChangeTracker] Failed to remove ${resolvedPath}:`, err);
      }
    }

    return this.repo.updateStatus(id, 'reverted');
  }
}
