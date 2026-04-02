import { app, ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { DiagnosticsSnapshot } from '../../shared/contracts';
import type { ConversationsRepo } from '../db/repositories/conversationsRepo';
import { assertTrustedSender } from './security';

export function registerDiagnosticsIpc(conversationsRepo: ConversationsRepo) {
  ipcMain.handle(IPC_CHANNELS.diagnosticsGetSnapshot, (event) => {
    assertTrustedSender(event);

    const usage = process.memoryUsage();
    const stats = conversationsRepo.getStats();

    return {
      collectedAt: new Date().toISOString(),
      build: {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? null,
        chromeVersion: process.versions.chrome ?? null,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch
      },
      mainProcess: {
        rssBytes: usage.rss,
        heapTotalBytes: usage.heapTotal,
        heapUsedBytes: usage.heapUsed,
        externalBytes: usage.external,
        arrayBuffersBytes: usage.arrayBuffers
      },
      databaseSizeBytes: stats.databaseSizeBytes
    } satisfies DiagnosticsSnapshot;
  });
}
