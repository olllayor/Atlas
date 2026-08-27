import { ipcMain } from 'electron/main';

import type { JobSnapshotView } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { BackgroundJobRegistry, JobSnapshot } from '../ai/jobs/BackgroundJobRegistry';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * The registry's snapshot is already the renderer's projection; this is a
 * type-level bridge so the handler's return type names the shared contract,
 * not a main-process module.
 */
function toView(snapshot: JobSnapshot): JobSnapshotView {
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    label: snapshot.label,
    conversationId: snapshot.conversationId,
    status: snapshot.status,
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
    startedAt: snapshot.startedAt,
    ...(snapshot.finishedAt !== undefined ? { finishedAt: snapshot.finishedAt } : {}),
    ...(snapshot.tail !== undefined ? { tail: snapshot.tail } : {})
  };
}

/**
 * Renderer access to the background-job registry. Reads and kills are
 * conversation-fenced by the registry itself (`expectFenced`), so the
 * conversationId the renderer supplies is the ownership proof, not a secret.
 */
export function registerJobsIpc(registry: BackgroundJobRegistry) {
  ipcMain.handle(
    IPC_CHANNELS.jobsList,
    withUserFacingErrors(
      IPC_CHANNELS.jobsList,
      async (event, conversationId: string): Promise<JobSnapshotView[]> => {
        assertTrustedSender(event);
        return registry.list(conversationId).map(toView);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.jobsListAll,
    withUserFacingErrors(
      IPC_CHANNELS.jobsListAll,
      async (event): Promise<JobSnapshotView[]> => {
        assertTrustedSender(event);
        return registry.listAll().map(toView);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.jobsKill,
    withUserFacingErrors(
      IPC_CHANNELS.jobsKill,
      async (event, conversationId: string, jobId: string): Promise<JobSnapshotView> => {
        assertTrustedSender(event);
        return toView(registry.kill(jobId, conversationId, 'stopped from the jobs panel'));
      }
    )
  );
}
