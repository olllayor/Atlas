import { ipcMain } from 'electron/main';

import type { EnvVarItem, ProjectContextInfo } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import type { EnvStore } from '../workspace/EnvStore';
import type { ProjectDetector } from '../workspace/ProjectDetector';
import { describeConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerWorkspaceIpc(
  db: AppDatabase,
  projectDetector: ProjectDetector,
  envStore: EnvStore
) {
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
            mode: workspace.mode
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
          mode: workspace.mode
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
}
