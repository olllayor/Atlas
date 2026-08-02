import type { ConversationWorkspace, CreateConversationRequest } from '../../shared/contracts';
import { isWorkspaceModeReady } from '../../shared/workspaceModes';
import type { AppDatabase } from '../db/client';
import type { ToolWorkspace } from '../ai/tools/toolWorkspace';

export type WorkspaceDatabase = Pick<AppDatabase, 'conversations' | 'projects'>;

/**
 * The authoritative answer to "what may this conversation touch".
 *
 * Both callers — the chat runtime and the IPC layer — go through here so the
 * root the model is allowed to write to and the folder the UI shows can never
 * disagree. A project row whose folder has since been deleted resolves to no
 * root at all rather than to a path that no longer exists.
 */
export function describeConversationWorkspace(
  database: WorkspaceDatabase,
  conversationId: string
): ConversationWorkspace {
  const { mode, projectId } = database.conversations.getWorkspace(conversationId);
  const project = projectId ? database.projects.get(projectId) : null;
  const usableProject = project?.exists ? project : null;

  return {
    conversationId,
    mode,
    projectId,
    project,
    ready: isWorkspaceModeReady(mode, usableProject != null)
  };
}

/**
 * Which project a brand-new conversation lands in.
 *
 * The caller's `projectId` wins whenever the field is present, *including* an
 * explicit `null` — that is how "I am reading an unfiled chat, give me another
 * unfiled chat" is expressed. Only an omitted field falls back to the last
 * project the user worked in, which is all a caller with nothing on screen
 * (the landing page, a cold start) can offer.
 *
 * Either way the id is verified against a folder that still exists, so a
 * project deleted on disk yields an unfiled chat instead of a conversation
 * pinned to a path that is gone.
 */
export function resolveNewConversationProjectId(
  projects: Pick<WorkspaceDatabase['projects'], 'get'>,
  request: CreateConversationRequest | undefined,
  rememberedProjectId: string | null
): string | null {
  const requested = request && 'projectId' in request ? (request.projectId ?? null) : undefined;
  const candidate = requested === undefined ? rememberedProjectId : requested;

  if (!candidate) {
    return null;
  }

  const project = projects.get(candidate);
  return project?.exists ? project.id : null;
}

import type { FileChangeTracker } from './FileChangeTracker';
import type { EnvStore } from './EnvStore';

export function resolveConversationWorkspace(
  database: WorkspaceDatabase,
  conversationId: string,
  options?: {
    fileChangeTracker?: FileChangeTracker;
    envStore?: EnvStore;
  }
): ToolWorkspace {
  const workspace = describeConversationWorkspace(database, conversationId);
  const root = workspace.project?.exists ? workspace.project.root : null;
  const projectId = workspace.project?.exists ? workspace.project.id : null;

  const toolWorkspace: ToolWorkspace = {
    mode: workspace.mode,
    root,
    projectId
  };

  if (options?.fileChangeTracker) {
    toolWorkspace.onFileChange = (change) => {
      options.fileChangeTracker?.recordChange({
        conversationId,
        filePath: change.filePath,
        beforeContent: change.beforeContent,
        afterContent: change.afterContent,
        diffText: change.diffText
      });
    };
  }

  return toolWorkspace;
}
