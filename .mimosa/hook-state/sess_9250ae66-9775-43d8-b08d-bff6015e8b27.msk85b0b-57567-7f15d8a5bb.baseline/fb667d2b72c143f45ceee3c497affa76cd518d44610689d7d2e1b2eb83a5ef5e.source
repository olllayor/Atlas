import { BrowserWindow, ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type {
  CreateSiteRequest,
  DeleteSiteFileRequest,
  ExportSiteRequest,
  ExportSiteResult,
  OpenSitePreviewRequest,
  PublishSiteRequest,
  ReadSiteFileRequest,
  RollbackSiteRequest,
  SiteDetail,
  SiteReviewChecklist,
  SitePreviewTarget,
  SiteSummary,
  WriteSiteFileRequest,
} from '../../shared/sites';
import type { SiteExporter } from '../sites/SiteExporter';
import type { SitePreviewHost } from '../sites/SitePreviewHost';
import type { SiteService } from '../sites/SiteService';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerSitesIpc({
  service,
  previewHost,
  exporter,
}: {
  service: SiteService;
  previewHost: SitePreviewHost;
  exporter: SiteExporter;
}) {
  const windowOf = (event: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle(
    IPC_CHANNELS.sitesList,
    withUserFacingErrors(IPC_CHANNELS.sitesList, (event, includeDeleted = false): SiteSummary[] => {
      assertTrustedSender(event);
      return service.listSites(includeDeleted);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesGet,
    withUserFacingErrors(IPC_CHANNELS.sitesGet, (event, siteId: string): SiteDetail => {
      assertTrustedSender(event);
      return service.getDetail(siteId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesCreate,
    withUserFacingErrors(IPC_CHANNELS.sitesCreate, async (event, request: CreateSiteRequest): Promise<SiteDetail> => {
      assertTrustedSender(event);
      return service.createSite(request);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesRename,
    withUserFacingErrors(IPC_CHANNELS.sitesRename, (event, siteId: string, title: string): SiteDetail => {
      assertTrustedSender(event);
      return service.renameSite(siteId, title);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesDelete,
    withUserFacingErrors(IPC_CHANNELS.sitesDelete, (event, siteId: string): void => {
      assertTrustedSender(event);
      previewHost.clearSite(siteId);
      service.deleteSite(siteId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesRestore,
    withUserFacingErrors(IPC_CHANNELS.sitesRestore, (event, siteId: string): SiteDetail => {
      assertTrustedSender(event);
      return service.restoreSite(siteId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesPurge,
    withUserFacingErrors(IPC_CHANNELS.sitesPurge, async (event, siteId: string): Promise<void> => {
      assertTrustedSender(event);
      previewHost.clearSite(siteId);
      await service.purgeSite(siteId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesReadFile,
    withUserFacingErrors(IPC_CHANNELS.sitesReadFile, async (event, request: ReadSiteFileRequest): Promise<string> => {
      assertTrustedSender(event);
      return service.readFile(request.siteId, request.path, request.versionId ?? null);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesWriteFile,
    withUserFacingErrors(
      IPC_CHANNELS.sitesWriteFile,
      async (event, request: WriteSiteFileRequest): Promise<SiteDetail> => {
        assertTrustedSender(event);
        return service.writeFile(request.siteId, request.path, request.contents);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesDeleteFile,
    withUserFacingErrors(
      IPC_CHANNELS.sitesDeleteFile,
      async (event, request: DeleteSiteFileRequest): Promise<SiteDetail> => {
        assertTrustedSender(event);
        return service.deleteFile(request.siteId, request.path);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesBuild,
    withUserFacingErrors(IPC_CHANNELS.sitesBuild, async (event, siteId: string): Promise<SiteDetail> => {
      assertTrustedSender(event);
      return service.buildDraft(siteId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesReview,
    withUserFacingErrors(IPC_CHANNELS.sitesReview, async (event, siteId: string): Promise<SiteReviewChecklist> => {
      assertTrustedSender(event);
      return service.getReviewChecklist(siteId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesPublish,
    withUserFacingErrors(IPC_CHANNELS.sitesPublish, async (event, request: PublishSiteRequest): Promise<SiteDetail> => {
      assertTrustedSender(event);
      return service.publish(request.siteId, {
        label: request.label ?? null,
        acknowledgedWarnings: request.acknowledgedWarnings ?? [],
      });
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesUnpublish,
    withUserFacingErrors(IPC_CHANNELS.sitesUnpublish, (event, siteId: string): SiteDetail => {
      assertTrustedSender(event);
      return service.unpublish(siteId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesRollback,
    withUserFacingErrors(IPC_CHANNELS.sitesRollback, async (event, request: RollbackSiteRequest): Promise<SiteDetail> => {
      assertTrustedSender(event);
      return service.rollback(request.siteId, request.versionId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesResetDraft,
    withUserFacingErrors(
      IPC_CHANNELS.sitesResetDraft,
      async (event, request: RollbackSiteRequest): Promise<SiteDetail> => {
        assertTrustedSender(event);
        return service.resetDraftTo(request.siteId, request.versionId);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesPreviewTarget,
    withUserFacingErrors(IPC_CHANNELS.sitesPreviewTarget, (event, request: OpenSitePreviewRequest): SitePreviewTarget => {
      assertTrustedSender(event);
      return previewHost.resolvePreviewTarget(request);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesOpenPreviewWindow,
    withUserFacingErrors(
      IPC_CHANNELS.sitesOpenPreviewWindow,
      async (event, request: OpenSitePreviewRequest): Promise<SitePreviewTarget> => {
        assertTrustedSender(event);
        return previewHost.openPreviewWindow(windowOf(event), request);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesExport,
    withUserFacingErrors(
      IPC_CHANNELS.sitesExport,
      async (event, request: ExportSiteRequest): Promise<ExportSiteResult> => {
        assertTrustedSender(event);
        return exporter.export(windowOf(event), request);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.sitesOpenInBrowser,
    withUserFacingErrors(
      IPC_CHANNELS.sitesOpenInBrowser,
      async (event, siteId: string, versionId?: string | null): Promise<string> => {
        assertTrustedSender(event);
        return exporter.openInBrowser(siteId, versionId ?? null);
      }
    )
  );
}
