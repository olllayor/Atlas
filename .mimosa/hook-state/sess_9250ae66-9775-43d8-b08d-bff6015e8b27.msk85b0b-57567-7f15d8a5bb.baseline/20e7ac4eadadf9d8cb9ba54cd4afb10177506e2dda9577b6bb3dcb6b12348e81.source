import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { BrowserWindow, dialog } from 'electron/main';
import { shell } from 'electron/common';

import type { ExportSiteRequest, ExportSiteResult } from '../../shared/sites';
import type { SiteService } from './SiteService';

const execFileAsync = promisify(execFile);

/**
 * Phase 1 publishing surface: sites leave Atlas as local artifacts only.
 *
 * There is no Atlas backend, so there is nothing to deploy to. Export writes
 * the immutable bytes of a version to a folder or archive the user picks; a
 * hosting adapter can be added later behind this same entry point without
 * changing callers.
 */
export class SiteExporter {
  constructor(private readonly service: SiteService) {}

  async export(parent: BrowserWindow | null, request: ExportSiteRequest): Promise<ExportSiteResult> {
    const detail = this.service.getDetail(request.siteId);
    const version = this.service.resolveServableVersion(request.siteId, request.versionId ?? null);
    const folderName = `${detail.site.slug}-v${version.versionNo}`;

    if (request.format === 'zip') {
      return this.exportZip(parent, request.siteId, version.id, folderName);
    }
    return this.exportFolder(parent, request.siteId, version.id, folderName);
  }

  /** Open a version in the user's default browser via a throwaway copy. */
  async openInBrowser(siteId: string, versionId?: string | null): Promise<string> {
    const version = this.service.resolveServableVersion(siteId, versionId ?? null);
    const staging = await mkdtemp(join(tmpdir(), 'atlas-site-'));
    await this.service.exportVersionTo(siteId, version.id, staging);
    await shell.openPath(join(staging, 'index.html'));
    return staging;
  }

  private async exportFolder(
    parent: BrowserWindow | null,
    siteId: string,
    versionId: string,
    folderName: string
  ): Promise<ExportSiteResult> {
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Export site to folder',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Export here',
        })
      : await dialog.showOpenDialog({
          title: 'Export site to folder',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Export here',
        });

    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true, destination: null, format: 'folder' };
    }

    const destination = join(result.filePaths[0], folderName);
    await this.service.exportVersionTo(siteId, versionId, destination);
    return { cancelled: false, destination, format: 'folder' };
  }

  private async exportZip(
    parent: BrowserWindow | null,
    siteId: string,
    versionId: string,
    folderName: string
  ): Promise<ExportSiteResult> {
    const options = {
      title: 'Export site as archive',
      defaultPath: `${folderName}.zip`,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return { cancelled: true, destination: null, format: 'zip' };
    }

    // Stage the version in a temp directory so the archive root is the site
    // folder rather than an absolute path from the app's data directory.
    const staging = await mkdtemp(join(tmpdir(), 'atlas-site-export-'));
    const stagedRoot = join(staging, folderName);

    try {
      await this.service.exportVersionTo(siteId, versionId, stagedRoot);
      await this.compress(stagedRoot, result.filePath);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }

    return { cancelled: false, destination: result.filePath, format: 'zip' };
  }

  private async compress(sourceDirectory: string, archivePath: string): Promise<void> {
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path "${sourceDirectory}\\*" -DestinationPath "${archivePath}" -Force`,
      ]);
      return;
    }

    // `zip` ships with macOS and virtually every Linux desktop; running it from
    // the staging parent keeps paths inside the archive relative.
    await execFileAsync('zip', ['-r', '-q', archivePath, basename(sourceDirectory)], {
      cwd: dirname(sourceDirectory),
    });
  }
}
