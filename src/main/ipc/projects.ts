import { resolve } from 'node:path';

import { shell } from 'electron/common';
import { BrowserWindow, app, dialog, ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { CreateWorkspaceProjectRequest, DetectedIde } from '../../shared/contracts';
import type { ProjectsRepo } from '../db/repositories/projectsRepo';
import type { SettingsRepo } from '../db/repositories/settingsRepo';
import { readAppIcon } from '../workspace/AppIconReader';
import type { IdeLauncher } from '../workspace/IdeLauncher';
import { pickPreferredIde } from '../workspace/IdeLauncher';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

import type { ConversationsRepo } from '../db/repositories/conversationsRepo';
import type { WorktreeService } from '../workspace/WorktreeService';

type ProjectsIpcDeps = {
  projectsRepo: ProjectsRepo;
  settingsRepo: SettingsRepo;
  ideLauncher: IdeLauncher;
  conversationsRepo?: ConversationsRepo;
  worktreeService?: WorktreeService;
};

/**
 * Application icons, keyed by the bundle they came from.
 *
 * Held for the process lifetime rather than behind a TTL: an app's icon changes
 * when the app is updated, which is rare enough that a stale mark until the next
 * launch is a better trade than re-encoding a dozen PNGs every time the menu
 * opens.
 */
const iconCache = new Map<string, string | null>();

async function loadIcon(iconPath: string | null) {
  if (!iconPath) return null;

  const cached = iconCache.get(iconPath);
  if (cached !== undefined) return cached;

  // macOS reads the bundle instead: `getFileIcon` answers there with the generic
  // application badge for every app, which is a menu of identical grey squares.
  // See `AppIconReader`.
  let dataUrl = await readAppIcon(iconPath);

  if (!dataUrl) {
    try {
      // `normal` is 32px — still sharp on a 2x display at the 16px the title bar
      // draws it at. Deliberately not `large`: on Electron 41 / macOS 26 that size
      // aborts the browser process from a thread-pool worker (SIGTRAP), taking the
      // whole app down a few seconds after the first scan.
      const image = await app.getFileIcon(iconPath, { size: 'normal' });
      dataUrl = image.isEmpty() ? null : image.toDataURL();
    } catch {
      // A missing icon is not a reason to drop the entry — the menu falls back to
      // a generic mark and the app still opens.
      dataUrl = null;
    }
  }

  iconCache.set(iconPath, dataUrl);
  return dataUrl;
}

/**
 * Project management. Attaching a folder is the one place Atlas asks the OS for
 * a path, so the native picker lives here rather than in the renderer, and the
 * chosen path is normalised once before anything stores it.
 */
export function registerProjectsIpc({
  projectsRepo,
  settingsRepo,
  ideLauncher,
  conversationsRepo,
  worktreeService
}: ProjectsIpcDeps) {
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
    withUserFacingErrors(IPC_CHANNELS.projectsDelete, async (event, projectId: string) => {
      assertTrustedSender(event);

      const project = projectsRepo.get(projectId);
      if (conversationsRepo) {
        const affected = conversationsRepo.resetWorkspaceForProject(projectId);
        if (project?.exists && worktreeService) {
          for (const item of affected) {
            if (item.worktreeRoot) {
              try {
                await worktreeService.removeWorktree(project.root, { path: item.worktreeRoot, force: true });
              } catch {
                // Ignore individual worktree removal failure
              }
            }
          }
        }
      }

      if (settingsRepo.getLastProjectId() === projectId) {
        settingsRepo.setLastProjectId(null);
      }

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

  ipcMain.handle(
    IPC_CHANNELS.projectsListIdes,
    withUserFacingErrors(IPC_CHANNELS.projectsListIdes, async (event): Promise<DetectedIde[]> => {
      assertTrustedSender(event);

      const ides = ideLauncher.list();
      const preferred = pickPreferredIde(ides, settingsRepo.getPreferredIdeId());
      const icons = await Promise.all(ides.map((ide) => loadIcon(ide.iconPath)));

      // Only the name, the id and a picture cross the bridge; the launch target
      // stays on this side.
      return ides.map((ide, index) => ({
        id: ide.id,
        name: ide.name,
        preferred: ide.id === preferred?.id,
        iconDataUrl: icons[index] ?? null
      }));
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.projectsOpenInIde,
    withUserFacingErrors(IPC_CHANNELS.projectsOpenInIde, async (event, projectId: string, ideId?: string) => {
      assertTrustedSender(event);

      const project = projectsRepo.get(projectId);
      if (!project?.exists) {
        throw new Error('That folder is no longer on disk.');
      }

      const ides = ideLauncher.list();
      if (ides.length === 0) {
        throw new Error('No supported editor was found on this machine.');
      }

      // An explicit id is matched against the detected set rather than trusted:
      // this is the only renderer-supplied value anywhere near a spawn, and it
      // must never be able to name a program that was not found by detection.
      const ide = ideId
        ? ides.find((entry) => entry.id === ideId)
        : pickPreferredIde(ides, settingsRepo.getPreferredIdeId());

      if (!ide) {
        throw new Error('That editor is no longer installed.');
      }

      await ideLauncher.open(ide, project.root);

      // Remembered only when the user picked deliberately, so a one-off open in
      // another editor does not silently repoint the default.
      if (ideId) {
        settingsRepo.setPreferredIdeId(ide.id);
      }
    })
  );
}
