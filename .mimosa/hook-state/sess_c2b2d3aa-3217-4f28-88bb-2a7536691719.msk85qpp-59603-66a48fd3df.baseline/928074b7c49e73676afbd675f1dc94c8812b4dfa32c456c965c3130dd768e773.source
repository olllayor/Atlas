import { BrowserWindow, protocol } from 'electron/main';
import { shell } from 'electron/common';

import {
  SITE_ENTRY_FILE,
  buildSitePreviewCsp,
  getSiteMimeType,
  normalizeSitePath,
  type OpenSitePreviewRequest,
  type SitePreviewTarget,
} from '../../shared/sites';
import type { SiteFileStore } from './SiteFileStore';
import type { SiteService } from './SiteService';

export const SITE_PREVIEW_SCHEME = 'atlas-site';

/**
 * Must run before `app.whenReady()`. Marking the scheme `standard` is what
 * gives previewed sites a real origin, so relative and root-relative URLs
 * resolve inside the version directory instead of leaking to the filesystem.
 */
export function registerSitePreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SITE_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Serves site artifacts to preview surfaces over `atlas-site://<siteId>/<path>`.
 *
 * Files are never handed to a renderer over `file://`: that would grant the
 * generated page the same origin as the app shell. Instead each site gets its
 * own opaque origin, every response carries the site CSP, and the host keeps a
 * siteId → versionId map so root-relative links keep working without encoding
 * the version into every URL.
 */
export class SitePreviewHost {
  private readonly servedVersionBySiteId = new Map<string, string>();
  private readonly windowsBySiteId = new Map<string, BrowserWindow>();
  private registered = false;

  constructor(
    private readonly service: SiteService,
    private readonly store: SiteFileStore
  ) {}

  /** Call once, after `app.whenReady()`. */
  registerProtocolHandler(): void {
    if (this.registered) return;
    this.registered = true;

    protocol.handle(SITE_PREVIEW_SCHEME, async (request) => {
      try {
        return await this.handleRequest(request);
      } catch {
        return new Response('Site preview error', { status: 500 });
      }
    });
  }

  /** Point a site's preview origin at a specific version and return its URL. */
  setServedVersion(siteId: string, versionId: string): SitePreviewTarget {
    this.servedVersionBySiteId.set(siteId, versionId);
    return { url: `${SITE_PREVIEW_SCHEME}://${siteId}/`, siteId, versionId };
  }

  resolvePreviewTarget(request: OpenSitePreviewRequest): SitePreviewTarget {
    const version = this.service.resolveServableVersion(request.siteId, request.versionId ?? null);
    return this.setServedVersion(request.siteId, version.id);
  }

  clearSite(siteId: string): void {
    this.servedVersionBySiteId.delete(siteId);
    const window = this.windowsBySiteId.get(siteId);
    if (window && !window.isDestroyed()) window.close();
    this.windowsBySiteId.delete(siteId);
  }

  /** Open (or refocus) a standalone preview window for a site. */
  async openPreviewWindow(
    parent: BrowserWindow | null,
    request: OpenSitePreviewRequest
  ): Promise<SitePreviewTarget> {
    const target = this.resolvePreviewTarget(request);
    const detail = this.service.getDetail(request.siteId);

    const existing = this.windowsBySiteId.get(request.siteId);
    if (existing && !existing.isDestroyed()) {
      await existing.loadURL(target.url);
      existing.focus();
      return target;
    }

    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 640,
      minHeight: 480,
      autoHideMenuBar: true,
      title: `${detail.site.title} — preview`,
      backgroundColor: '#ffffff',
      ...(parent ? { parent } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    this.hardenPreviewWindow(window);
    this.windowsBySiteId.set(request.siteId, window);
    window.on('closed', () => this.windowsBySiteId.delete(request.siteId));

    await window.loadURL(target.url);
    window.show();
    return target;
  }

  private hardenPreviewWindow(window: BrowserWindow): void {
    const contents = window.webContents;

    // Generated pages get no capabilities: no camera, no clipboard, no geo.
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);

    // Links out open in the user's browser; the preview window itself never
    // navigates off the site origin.
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${SITE_PREVIEW_SCHEME}://`)) {
        event.preventDefault();
        if (url.startsWith('http://') || url.startsWith('https://')) {
          void shell.openExternal(url);
        }
      }
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const siteId = url.hostname;
    const versionId = this.servedVersionBySiteId.get(siteId);

    if (!versionId) {
      return new Response('No preview is active for this site.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += SITE_ENTRY_FILE;
    const requestedPath = normalizeSitePath(pathname) ?? SITE_ENTRY_FILE;

    let body: Buffer;
    try {
      body = await this.store.readSiteFile(siteId, versionId, requestedPath);
    } catch {
      return new Response('Not found', {
        status: 404,
        headers: this.securityHeaders('text/plain; charset=utf-8'),
      });
    }

    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
      status: 200,
      headers: this.securityHeaders(getSiteMimeType(requestedPath)),
    });
  }

  private securityHeaders(contentType: string): Record<string, string> {
    return {
      'Content-Type': contentType,
      'Content-Security-Policy': buildSitePreviewCsp(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // Drafts change on every keystroke of the agent; never serve a stale copy.
      'Cache-Control': 'no-store',
    };
  }
}
