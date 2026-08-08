import type { ConversationWorkspace, CreateConversationRequest } from '../../shared/contracts';
import { isWorkspaceModeReady } from '../../shared/workspaceModes';
import type { AppDatabase } from '../db/client';
import type { ToolWorkspace } from '../ai/tools/toolWorkspace';

export type WorkspaceDatabase = Pick<AppDatabase, 'conversations' | 'projects'>;

/**
 * Whether re-pointing a conversation's attached project (or detaching it with
 * an explicit `null`) should also detach its worktree.
 *
 * A worktree belongs to the project that provisioned it
 * (`<root>/.atlas-worktrees/<conversationId>`), and the tool runtime resolves
 * its working directory from that path. Keeping the old root after the chip's
 * project chip moves would run every subsequent turn inside a folder the UI no
 * longer shows — while a re-provision on the *new* project is the only correct
 * worktree for the new folder. Detaches always count: a conversation is
 * attached to nothing, so a worktree under a forgotten repo has no owner.
 */
export function shouldResetWorktreeOnProjectChange(input: {
  currentProjectId: string | null;
  currentWorktreeRoot: string | null | undefined;
  requestedProjectId: string | null | undefined;
}): boolean {
  if (!input.currentWorktreeRoot || input.requestedProjectId === undefined) {
    return false;
  }
  return input.requestedProjectId === null || input.currentProjectId !== input.requestedProjectId;
}

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
  const { mode, executionTarget, projectId, worktreeRoot } = database.conversations.getWorkspace(conversationId);
  const project = projectId ? database.projects.get(projectId) : null;
  const usableProject = project?.exists ? project : null;

  return {
    conversationId,
    mode,
    executionTarget,
    projectId,
    project,
    worktreeRoot,
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
import type { AgentInstructionsService } from './AgentInstructions';
import type { TerminalHistoryRepo } from '../db/repositories/terminalHistoryRepo';

export function resolveConversationWorkspace(
  database: WorkspaceDatabase,
  conversationId: string,
  options?: {
    fileChangeTracker?: FileChangeTracker;
    envStore?: EnvStore;
    agentInstructions?: AgentInstructionsService;
    terminalHistory?: TerminalHistoryRepo;
    settingsRepo?: import('../db/repositories/settingsRepo').SettingsRepo;
    onAgentCommand?: (command: string, exitCode: number | null) => void;
  }
): ToolWorkspace {
  const workspace = describeConversationWorkspace(database, conversationId);
  const root = workspace.project?.exists ? workspace.project.root : null;
  const projectId = workspace.project?.exists ? workspace.project.id : null;

  const toolWorkspace: ToolWorkspace = {
    mode: workspace.mode,
    executionTarget: workspace.executionTarget,
    root,
    worktreeRoot: workspace.worktreeRoot,
    projectId,
    conversationId,
    cloudWorkerUrl: options?.settingsRepo?.getCloudSandboxWorkerUrl() ?? null,
    cloudWorkerSecret: options?.settingsRepo?.getCloudSandboxWorkerSecret() ?? null
  };

  // AGENTS.md is re-read every turn through an mtime-revalidated cache, so a
  // file the agent just edited applies to its next turn. A root with nothing to
  // say is left off the workspace entirely rather than carried as an empty
  // object, which is what the prompt builder tests for.
  if (options?.agentInstructions) {
    const instructions = options.agentInstructions.getForRoot(root);
    if (instructions.text || instructions.nestedPaths.length > 0) {
      toolWorkspace.instructions = instructions;
    }
  }

  // Project env vars are read from the in-memory cache: this resolver runs on
  // the synchronous turn-setup path, and the keychain read that fills the cache
  // is async. A cold cache means the turn runs without them rather than
  // blocking, which is why the store primes at boot and on every write.
  if (options?.envStore && projectId) {
    const env = options.envStore.getCachedEnv(projectId);
    if (Object.keys(env).length > 0) {
      toolWorkspace.env = env;
    }
  }

  // Shell commands the agent runs land in the same history the Terminal panel
  // reads, so the panel shows the conversation's commands rather than only
  // whatever the user typed.
  if (options?.terminalHistory || options?.onAgentCommand) {
    toolWorkspace.onCommandRun = (command) => {
      try {
        options.terminalHistory?.add({
          conversationId,
          command: command.command,
          exitCode: command.exitCode,
          finishedAt: new Date().toISOString()
        });
      } catch (err) {
        console.warn('[conversationWorkspace] failed to record command history:', err);
      }

      try {
        options.onAgentCommand?.(command.command, command.exitCode);
      } catch (err) {
        console.warn('[conversationWorkspace] failed to echo command to terminal:', err);
      }
    };
  }

  if (options?.fileChangeTracker) {
    toolWorkspace.onFileChange = (change) => {
      options.fileChangeTracker?.recordChange({
        conversationId,
        filePath: change.filePath,
        beforeContent: change.beforeContent,
        afterContent: change.afterContent,
        diffText: change.diffText,
        toolCallId: change.toolCallId ?? null
      });
    };
  }

  return toolWorkspace;
}
