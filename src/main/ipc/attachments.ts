import { ipcMain } from 'electron/main';

import type { DeleteStagedAttachmentRequest, StageAttachmentRequest } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AttachmentStore } from '../attachments/AttachmentStore';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * Upload-before-send for composer attachments (t3code PR #8048, adapted).
 *
 * t3 mints signed HTTP upload URLs because its client is remote. Atlas is
 * local and its renderer trusted, so staging is a plain IPC call: the
 * renderer reads the `blob:` URL only it can see and hands over a `data:`
 * URL, exactly like the images bridge. The turn then carries a storage key
 * instead of inline base64 — retries and the durable follow-up queue stop
 * hauling megabytes around.
 */

/** ~20 MB of bytes once base64 is decoded, with headroom for the prefix. */
const MAX_STAGE_DATA_URL_LENGTH = 24_000_000;

function asStageRequest(request: unknown): StageAttachmentRequest {
  const candidate = request as Partial<StageAttachmentRequest> | null;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('That attachment could not be read.');
  }
  if (typeof candidate.conversationId !== 'string' || !candidate.conversationId) {
    throw new Error('That attachment has nowhere to be staged.');
  }
  if (typeof candidate.mediaType !== 'string' || !candidate.mediaType) {
    throw new Error('That attachment has no usable file type.');
  }
  if (typeof candidate.dataUrl !== 'string' || !candidate.dataUrl.startsWith('data:')) {
    throw new Error('That attachment could not be read.');
  }
  if (candidate.dataUrl.length > MAX_STAGE_DATA_URL_LENGTH) {
    throw new Error(`${candidate.filename ?? 'That file'} exceeds the attachment size limit.`);
  }
  return {
    conversationId: candidate.conversationId,
    ...(candidate.filename ? { filename: candidate.filename } : {}),
    mediaType: candidate.mediaType,
    dataUrl: candidate.dataUrl,
  };
}

export function registerAttachmentsIpc(attachmentStore: AttachmentStore) {
  ipcMain.handle(
    IPC_CHANNELS.attachmentsStage,
    withUserFacingErrors(IPC_CHANNELS.attachmentsStage, async (event, request: unknown) => {
      assertTrustedSender(event);
      const staged = asStageRequest(request);
      return attachmentStore.stageAttachment(staged.conversationId, {
        ...(staged.filename ? { filename: staged.filename } : {}),
        mediaType: staged.mediaType,
        dataUrl: staged.dataUrl,
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.attachmentsDeleteStaged,
    withUserFacingErrors(
      IPC_CHANNELS.attachmentsDeleteStaged,
      async (event, request: DeleteStagedAttachmentRequest) => {
        assertTrustedSender(event);
        if (!request || typeof request.storageKey !== 'string' || typeof request.conversationId !== 'string') {
          return;
        }
        attachmentStore.deleteStagedAttachment(request.conversationId, request.storageKey);
      },
    ),
  );
}
