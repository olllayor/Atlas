import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { shell } from 'electron/common';
import { ipcMain } from 'electron/main';

import type {
  AgentInstructionsSummary,
  EnvVarItem,
  ProjectContextInfo,
  WorkspaceEntriesResult,
  WorkspaceFileResult
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import type { AgentInstructionsResult, AgentInstructionsService } from '../workspace/AgentInstructions';
import type { WorkspaceIndex } from '../workspace/WorkspaceIndex';
import { generateStarterAgentsMd } from '../workspace/AgentInstructions';
import type { EnvStore } from '../workspace/EnvStore';
import type { ProjectDetector } from '../workspace/ProjectDetector';
import { describeConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * Paths and sizes for the menu, never the text: the instructions are already in
 * the model's prompt, and a null summary is how the UI learns to offer creating
 * the file instead of opening it.
 */
function summarizeAgentInstructions(instructions: AgentInstructionsResult): AgentInstructionsSummary | null {
  if (instructions.sources.length === 0 && instructions.nestedPaths.length === 0) {
    return null;
  }

  return {
    sources: instructions.sources.map((source) => ({
      path: source.path,
      scope: source.scope,
      bytes: source.bytes,
      truncated: source.truncated
    })),
    nestedPaths: instructions.nestedPaths,
    totalBytes: instructions.totalBytes,
    truncated: instructions.truncated
  };
}

export function registerWorkspaceIpc(
  db: AppDatabase,
  projectDetector: ProjectDetector,
  envStore: EnvStore,
  agentInstructions: AgentInstructionsService,
  workspaceIndex: WorkspaceIndex
) {
  /**
   * The folder the Files surface reads, resolved from the conversation row
   * rather than sent by the renderer — the same rule the terminal's cwd
   * follows, so the panel and the shell can never disagree about where the
   * conversation is working.
   */
  const workspaceRoot = (conversationId: string): string | null => {
    const workspace = describeConversationWorkspace(db, conversationId);
    if (workspace.executionTarget === 'worktree' && workspace.worktreeRoot) {
      return workspace.worktreeRoot;
    }
    return workspace.project?.exists ? workspace.project.root : null;
  };

  ipcMain.handle(
    IPC_CHANNELS.workspaceContext,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceContext,
      async (event, conversationId: string): Promise<ProjectContextInfo> => {
        assertTrustedSender(event);
        const workspace = describeConversationWorkspace(db, conversationId);
        const project = workspace.project;

        if (!project || !project.exists) {
          return {
            project: null,
            projectType: { type: 'unknown' },
            envKeys: [],
            detectedEnvKeys: [],
            mode: workspace.mode,
            // Global instructions still apply to a conversation with no folder,
            // and the turn is told about them, so the UI says so too.
            agentInstructions: summarizeAgentInstructions(agentInstructions.getForRoot(null))
          };
        }

        const projectType = projectDetector.detectProjectType(project.root);
        const envKeys = envStore.listEnvKeys(project.id);
        const detectedEnvKeys = projectDetector.detectEnvFile(project.root);

        return {
          project,
          projectType,
          envKeys,
          detectedEnvKeys,
          mode: workspace.mode,
          agentInstructions: summarizeAgentInstructions(agentInstructions.getForRoot(project.root))
        };
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceEnvList,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceEnvList,
      async (event, projectId: string): Promise<EnvVarItem[]> => {
        assertTrustedSender(event);
        return envStore.listMaskedEnv(projectId);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceEnvSet,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceEnvSet,
      async (event, projectId: string, key: string, value: string): Promise<void> => {
        assertTrustedSender(event);
        await envStore.setEnvVar(projectId, key, value);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceEnvDelete,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceEnvDelete,
      async (event, projectId: string, key: string): Promise<void> => {
        assertTrustedSender(event);
        await envStore.deleteEnvVar(projectId, key);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceInstructionsOpen,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceInstructionsOpen,
      async (event, conversationId: string, sourcePath: string): Promise<void> => {
        assertTrustedSender(event);
        const workspace = describeConversationWorkspace(db, conversationId);
        const root = workspace.project?.exists ? workspace.project.root : null;
        const known = agentInstructions.getForRoot(root);

        // The renderer names a path, but only one the main process itself
        // discovered — same rule as `ToolWorkspace.root`: a boundary the client
        // can name is not a boundary, and this one ends in `shell.openPath`.
        if (!known.sources.some((source) => source.path === sourcePath)) {
          throw new Error('Not a loaded instruction file for this conversation.');
        }

        await shell.openPath(sourcePath);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceInstructionsInit,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceInstructionsInit,
      async (event, conversationId: string): Promise<void> => {
        assertTrustedSender(event);
        const workspace = describeConversationWorkspace(db, conversationId);
        const project = workspace.project?.exists ? workspace.project : null;

        if (!project) {
          throw new Error('Attach a project folder before creating AGENTS.md.');
        }

        // A deterministic skeleton rather than a generated description: there is
        // no turn around this handler, and an invented account of a project
        // nobody checked is worse than a form with blanks in it.
        const path = join(project.root, 'AGENTS.md');
        try {
          // `wx` so an existing file is never clobbered by a menu click.
          writeFileSync(path, generateStarterAgentsMd(project.title, projectDetector.detectProjectType(project.root)), {
            encoding: 'utf8',
            flag: 'wx'
          });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error('AGENTS.md already exists in this project.');
          }
          throw err;
        }

        agentInstructions.invalidate(project.root);
        await shell.openPath(path);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceOpenFile,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceOpenFile,
      async (event, filePath: string): Promise<void> => {
        assertTrustedSender(event);
        await shell.openPath(filePath);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceRevealPath,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceRevealPath,
      async (
        event,
        request: { conversationId: string; target: 'project' | 'worktree' }
      ): Promise<void> => {
        assertTrustedSender(event);

        const workspace = describeConversationWorkspace(db, request.conversationId);
        const path =
          request.target === 'worktree' ? workspace.worktreeRoot : workspace.project?.root;

        if (!path) {
          throw new Error(
            request.target === 'worktree'
              ? 'This conversation has no worktree.'
              : 'Attach a project folder first.'
          );
        }

        // A path the OS would fail to open (deleted folder, pruned worktree)
        // gets a friendly in-app error instead of a modal from shell.openPath.
        if (!existsSync(path)) {
          throw new Error(
            request.target === 'worktree'
              ? 'This conversation’s worktree is no longer on disk.'
              : 'That project folder is no longer on disk.'
          );
        }

        await shell.openPath(path);
      }
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.workspaceListEntries,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceListEntries,
      async (
        event,
        conversationId: string,
        options?: { refresh?: boolean }
      ): Promise<WorkspaceEntriesResult> => {
        assertTrustedSender(event);
        const root = workspaceRoot(conversationId);
        // No project is not an error: the panel says so, and an empty listing
        // is exactly what "nothing attached" looks like.
        if (!root) return { entries: [], truncated: false };
        return workspaceIndex.list(root, options);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.workspaceReadFile,
    withUserFacingErrors(
      IPC_CHANNELS.workspaceReadFile,
      async (event, conversationId: string, relativePath: string): Promise<WorkspaceFileResult> => {
        assertTrustedSender(event);
        const root = workspaceRoot(conversationId);
        if (!root) return { ok: false, relativePath, failure: 'no-workspace' };
        return workspaceIndex.read(root, relativePath);
      }
    )
  );
}
