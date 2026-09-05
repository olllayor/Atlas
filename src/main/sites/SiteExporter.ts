import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { BrowserWindow } from 'electron/main';

import type {
  AnalyzeWorkspaceRequest,
  DetectedPackage,
  ExportSiteRequest,
  ExportSiteResult,
  ExportSiteToWorkspaceRequest,
  ExportSiteToWorkspaceResult,
  WorkspaceProjectAnalysis,
} from '../../shared/sites';
import { isTextSiteFile } from '../../shared/sites';
import type { SiteService } from './SiteService';

const KNOWN_LIBRARIES: Array<{
  name: string;
  category: DetectedPackage['category'];
  patterns: RegExp[];
}> = [
  { name: 'lucide-react', category: 'icons', patterns: [/lucide-react/, /\blucide\b/, /data-lucide/] },
  { name: '@radix-ui/react-icons', category: 'icons', patterns: [/@radix-ui\/react-icons/] },
  { name: '@radix-ui/react-slot', category: 'components', patterns: [/@radix-ui\/react-slot/] },
  { name: 'clsx', category: 'utility', patterns: [/\bclsx\b/] },
  { name: 'tailwind-merge', category: 'utility', patterns: [/tailwind-merge/] },
  { name: 'tailwindcss', category: 'styling', patterns: [/@tailwind/, /cdn\.tailwindcss\.com/, /tailwindcss/] },
  { name: 'framer-motion', category: 'animation', patterns: [/framer-motion/] },
  { name: 'canvas-confetti', category: 'animation', patterns: [/canvas-confetti/] },
  { name: 'sonner', category: 'components', patterns: [/\bsonner\b/] },
  { name: 'class-variance-authority', category: 'utility', patterns: [/class-variance-authority/, /\bcva\(/] },
  { name: 'cmdk', category: 'components', patterns: [/\bcmdk\b/] },
];

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
    const { shell } = await import('electron/common');
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
    const { dialog } = await import('electron/main');
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
    const { dialog } = await import('electron/main');
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

  /**
   * Scans a site's design files and compares them against the workspace project's
   * package.json to identify needed packages, installed status, and installation commands.
   */
  async analyzeWorkspace(request: AnalyzeWorkspaceRequest): Promise<WorkspaceProjectAnalysis> {
    const detail = this.service.getDetail(request.siteId);
    const version = this.service.resolveServableVersion(request.siteId, request.versionId ?? null);
    const files = this.service.listFiles(version.id);

    const detectedMap = new Map<string, DetectedPackage>();

    // 1. Scan text files for package imports and library signatures
    for (const file of files) {
      if (!isTextSiteFile(file.path)) continue;
      try {
        const contents = await this.service.readTextFile(request.siteId, version.id, file.path);

        // Check known libraries
        for (const lib of KNOWN_LIBRARIES) {
          if (lib.patterns.some((p) => p.test(contents))) {
            if (!detectedMap.has(lib.name)) {
              detectedMap.set(lib.name, {
                name: lib.name,
                category: lib.category,
                installed: false,
              });
            }
          }
        }

        // Generic import / require scan
        const importMatches = contents.matchAll(
          /(?:import\s+(?:[\w*\s{},]*from\s+)?['"](@?[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?)['"]|require\s*\(\s*['"](@?[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?)['"]\))/gi
        );
        for (const match of importMatches) {
          const rawName = match[1] || match[2];
          if (!rawName || rawName.startsWith('.') || rawName.startsWith('/')) continue;
          if (['fs', 'path', 'child_process', 'os', 'util', 'events', 'crypto', 'http', 'https'].includes(rawName)) continue;
          if (rawName.startsWith('node:')) continue;

          if (!detectedMap.has(rawName)) {
            detectedMap.set(rawName, {
              name: rawName,
              category: 'utility',
              installed: false,
            });
          }
        }
      } catch {
        // Skip unreadable files gracefully
      }
    }

    const projectRoot = resolve(request.projectRoot);
    const packageJsonPath = join(projectRoot, 'package.json');
    let packageJsonFound = false;
    let projectTitle = basename(projectRoot);
    let installedDependencies: Record<string, string> = {};

    if (existsSync(packageJsonPath)) {
      try {
        const rawJson = await readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(rawJson);
        packageJsonFound = true;
        if (pkg.name) projectTitle = pkg.name;
        installedDependencies = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
      } catch {
        // Ignore corrupted or unparseable package.json
      }
    }

    // Mark installed status
    for (const [name, detected] of detectedMap.entries()) {
      if (installedDependencies[name]) {
        detected.installed = true;
        detected.version = installedDependencies[name];
      }
    }

    // Detect package manager from lockfiles
    let packageManager: WorkspaceProjectAnalysis['packageManager'] = 'npm';
    if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm';
    } else if (existsSync(join(projectRoot, 'yarn.lock'))) {
      packageManager = 'yarn';
    } else if (existsSync(join(projectRoot, 'bun.lockb')) || existsSync(join(projectRoot, 'bun.lock'))) {
      packageManager = 'bun';
    }

    const detectedPackages = Array.from(detectedMap.values());
    const missingPackages = detectedPackages.filter((p) => !p.installed).map((p) => p.name);

    let installCommand = '';
    if (missingPackages.length > 0) {
      if (packageManager === 'pnpm') {
        installCommand = `pnpm add ${missingPackages.join(' ')}`;
      } else if (packageManager === 'yarn') {
        installCommand = `yarn add ${missingPackages.join(' ')}`;
      } else if (packageManager === 'bun') {
        installCommand = `bun add ${missingPackages.join(' ')}`;
      } else {
        installCommand = `npm install ${missingPackages.join(' ')}`;
      }
    }

    // Recommend natural subpath
    let defaultExportSubpath = `src/components/design/${detail.site.slug}`;
    if (existsSync(join(projectRoot, 'src', 'components'))) {
      defaultExportSubpath = `src/components/design/${detail.site.slug}`;
    } else if (existsSync(join(projectRoot, 'components'))) {
      defaultExportSubpath = `components/design/${detail.site.slug}`;
    } else if (existsSync(join(projectRoot, 'src'))) {
      defaultExportSubpath = `src/design/${detail.site.slug}`;
    } else {
      defaultExportSubpath = `design/${detail.site.slug}`;
    }

    return {
      projectRoot,
      projectTitle,
      packageJsonFound,
      packageManager,
      defaultExportSubpath,
      detectedPackages,
      missingPackages,
      installCommand,
    };
  }

  /**
   * Exports the design version files directly into the target workspace project folder.
   */
  async exportToWorkspace(request: ExportSiteToWorkspaceRequest): Promise<ExportSiteToWorkspaceResult> {
    const projectRoot = resolve(request.projectRoot);
    const rootStat = await stat(projectRoot);
    if (!rootStat.isDirectory()) {
      throw new Error(`Project root is not a directory: ${projectRoot}`);
    }

    const cleanSubpath = request.subpath.trim().replace(/^[\/\\]+/, '');
    if (!cleanSubpath) {
      throw new Error('Export subpath cannot be empty');
    }

    const destination = resolve(projectRoot, cleanSubpath);
    const rel = relative(projectRoot, destination);
    if (rel.startsWith('..') || isAbsolute(rel) || rel === '') {
      throw new Error('Export destination must be inside the project root');
    }

    const version = this.service.resolveServableVersion(request.siteId, request.versionId ?? null);
    await this.service.exportVersionTo(request.siteId, version.id, destination);

    // List written files and sum byte size
    const writtenFiles: string[] = [];
    let totalBytes = 0;

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const entryStat = await stat(full);
          writtenFiles.push(relative(destination, full).split('\\').join('/'));
          totalBytes += entryStat.size;
        }
      }
    };

    await walk(destination);
    writtenFiles.sort();

    this.service.recordEvent(request.siteId, version.id, 'site.exported_to_workspace', {
      projectRoot,
      subpath: cleanSubpath,
      destination,
      fileCount: writtenFiles.length,
      totalBytes,
    });

    return {
      destination,
      writtenFiles,
      totalBytes,
    };
  }
}
