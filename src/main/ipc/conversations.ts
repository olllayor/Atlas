import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type {
  ConversationPageRequest,
  CreateConversationRequest,
  SetConversationWorkspaceRequest
} from '../../shared/contracts';
import { isWorkspaceMode } from '../../shared/workspaceModes';
import type { AppDatabase } from '../db/client';
import type { ConversationsRepo } from '../db/repositories/conversationsRepo';
import type { SettingsRepo } from '../db/repositories/settingsRepo';
import {
  describeConversationWorkspace,
  resolveNewConversationProjectId
} from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

type ConversationsIpcDependencies = {
  conversationsRepo: ConversationsRepo;
  projectsRepo: AppDatabase['projects'];
  settingsRepo: SettingsRepo;
  /** Lets the deleted conversation's shell and other per-conversation
   *  resources be torn down with it. */
  onConversationDeleted?: (conversationId: string) => void;
};

export function registerConversationsIpc({
  conversationsRepo,
  projectsRepo,
  settingsRepo,
  onConversationDeleted
}: ConversationsIpcDependencies) {
  const database = { conversations: conversationsRepo, projects: projectsRepo };

  ipcMain.handle(
    IPC_CHANNELS.conversationsList,
    withUserFacingErrors(IPC_CHANNELS.conversationsList, (event) => {
      assertTrustedSender(event);
      return conversationsRepo.list();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsCreate,
    withUserFacingErrors(IPC_CHANNELS.conversationsCreate, (event, request: CreateConversationRequest | undefined) => {
      assertTrustedSender(event);

      // A new conversation inherits the working mode, the way Codex-style
      // clients carry model and mode onto the next thread. The *project* comes
      // from the caller when it knows one, because the remembered id only moves
      // on an explicit workspace change: open a chat in another folder and press
      // the New chat shortcut, and this used to file it under the folder you
      // last picked by hand, not the one you were reading.
      const projectId = resolveNewConversationProjectId(
        projectsRepo,
        request,
        settingsRepo.getLastProjectId()
      );

      const conversation = conversationsRepo.create({
        workspaceMode: settingsRepo.getWorkspaceMode(),
        projectId,
        toolPermissionMode: request?.toolPermissionMode ?? settingsRepo.getToolPermissionMode()
      });

      // Keep the fallback honest for the next caller that cannot state a
      // project — creating here *is* the user working in that project.
      if (projectId !== settingsRepo.getLastProjectId()) {
        settingsRepo.setLastProjectId(projectId);
      }

      return conversation;
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsGet,
    withUserFacingErrors(IPC_CHANNELS.conversationsGet, (event, conversationId: string) => {
      assertTrustedSender(event);
      return conversationsRepo.get(conversationId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsGetPage,
    withUserFacingErrors(
      IPC_CHANNELS.conversationsGetPage,
      (event, conversationId: string, request: ConversationPageRequest | undefined) => {
        assertTrustedSender(event);
        return conversationsRepo.getPage(conversationId, request);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsGetStats,
    withUserFacingErrors(IPC_CHANNELS.conversationsGetStats, (event) => {
      assertTrustedSender(event);
      return conversationsRepo.getStats();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsDelete,
    withUserFacingErrors(IPC_CHANNELS.conversationsDelete, (event, conversationId: string) => {
      assertTrustedSender(event);
      conversationsRepo.delete(conversationId);
      onConversationDeleted?.(conversationId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsRename,
    withUserFacingErrors(IPC_CHANNELS.conversationsRename, (event, conversationId: string, title: string) => {
      assertTrustedSender(event);
      return conversationsRepo.rename(conversationId, title);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsGetWorkspace,
    withUserFacingErrors(IPC_CHANNELS.conversationsGetWorkspace, (event, conversationId: string) => {
      assertTrustedSender(event);
      return describeConversationWorkspace(database, conversationId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsSetWorkspace,
    withUserFacingErrors(IPC_CHANNELS.conversationsSetWorkspace, (event, request: SetConversationWorkspaceRequest) => {
      assertTrustedSender(event);

      if (request.mode !== undefined && !isWorkspaceMode(request.mode)) {
        throw new Error(`Unknown workspace mode: ${String(request.mode)}`);
      }

      if (request.projectId) {
        // Refuse an unknown id rather than storing a dangling reference that
        // would silently leave the conversation with no root.
        const project = projectsRepo.get(request.projectId);
        if (!project) {
          throw new Error(`Project ${request.projectId} not found.`);
        }
        projectsRepo.touch(project.id);
      }

      conversationsRepo.setWorkspace(request.conversationId, {
        mode: request.mode,
        projectId: request.projectId
      });

      // Remember the choice for the next new conversation, not for existing ones.
      if (request.mode !== undefined) {
        settingsRepo.setWorkspaceMode(request.mode);
      }

      if (request.projectId !== undefined) {
        settingsRepo.setLastProjectId(request.projectId);
      }

      return describeConversationWorkspace(database, request.conversationId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationsSetToolPermissionMode,
    withUserFacingErrors(
      IPC_CHANNELS.conversationsSetToolPermissionMode,
      (event, request: { conversationId: string; toolPermissionMode: import('../../shared/chatParameters').ToolPermissionMode }) => {
        assertTrustedSender(event);
        return conversationsRepo.setToolPermissionMode(request.conversationId, request.toolPermissionMode);
      }
    )
  );
}
