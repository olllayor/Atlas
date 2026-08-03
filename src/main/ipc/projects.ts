import { resolve } from 'node:path';

import { shell } from 'electron/common';
import { BrowserWindow, dialog, ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { CreateWorkspaceProjectRequest } from '../../shared/contracts';
import type { ProjectsRepo } from '../db/repositories/projectsRepo';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * Project management. Attaching a folder is the one place Atlas asks the OS for
 * a path, so the native picker lives here rather than in the renderer, and the
 * chosen path is normalised once before anything stores it.
 */
export function registerProjectsIpc(projectsRepo: ProjectsRepo) {
  ipcMain.handle(
    IPC_CHANNELS.projectsList,
    withUserFacingErrors(IPC_CHANNELS.projectsList, (event) => {
      assertTrustedSender(event);
      return projectsRepo.list();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.projectsCreate,
    withUserFacingErrors(IPC_CHANNELS.projectsCreate, async (event, request: CreateWorkspaceProjectRequest | undefined) => {
      assertTrustedSender(event);

      if (request?.root?.trim()) {
        return projectsRepo.create({ root: resolve(request.root.trim()), title: request.title });
      }

      const parent = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Choose a project folder',
        buttonLabel: 'Attach folder',
        properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
      };

      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);

      const [selected] = result.filePaths;
      if (result.canceled || !selected) {
        // Cancelling is a normal outcome, not an error the renderer has to catch.
        return null;
      }

      return projectsRepo.create({ root: selected, title: request?.title });
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.projectsRename,
    withUserFacingErrors(IPC_CHANNELS.projectsRename, (event, projectId: string, title: string) => {
      assertTrustedSender(event);
      return projectsRepo.rename(projectId, title);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.projectsDelete,
    withUserFacingErrors(IPC_CHANNELS.projectsDelete, (event, projectId: string) => {
      assertTrustedSender(event);
      // Only the attachment is removed; nothing on disk is touched.
      projectsRepo.delete(projectId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.projectsReveal,
    withUserFacingErrors(IPC_CHANNELS.projectsReveal, async (event, projectId: string) => {
      assertTrustedSender(event);
      const project = projectsRepo.get(projectId);

      if (!project?.exists) {
        throw new Error('That folder is no longer on disk.');
      }

      await shell.openPath(project.root);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.projectsSetPinned,
    withUserFacingErrors(IPC_CHANNELS.projectsSetPinned, (event, projectId: string, pinned: boolean) => {
      assertTrustedSender(event);

      if (typeof projectId !== 'string' || typeof pinned !== 'boolean') {
        throw new Error('A project id and a pinned flag are required.');
      }

      return projectsRepo.setPinned(projectId, pinned);
    })
  );
}
