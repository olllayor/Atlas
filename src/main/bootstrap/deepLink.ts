import { protocol, app, ipcMain, BrowserWindow } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import { ATLAS_SCHEME, parseAtlasDeepLink } from '../../shared/atlasDeepLink';
import type { AtlasDeepLink } from '../../shared/contracts';
import { logger } from '../observability/logger';

/**
 * The `atlas://` deep-link scheme (t3code's `t3code://app` pattern): one
 * URL grammar that mirrors the app's views, so agents, toasts and OS
 * shortcuts can land the user on an exact state. Grammar lives in
 * `shared/atlasDeepLink.ts`; this module is the Electron plumbing around it.
 */

/** Must run before `app.ready` — privileged schemes cannot be added later. */
export function registerAtlasScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ATLAS_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: false },
    },
  ]);
}

/**
 * Serves the scheme and forwards every parsed link to all windows. The
 * response body is a dead end by design: navigation into the scheme must not
 * error, but the app is the UI.
 */
export function registerAtlasProtocolHandler(): void {
  protocol.handle(ATLAS_SCHEME, (request) => {
    const link = parseAtlasDeepLink(request.url);
    if (link) {
      broadcastDeepLink(link);
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Atlas</title><p>Opening Atlas…</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  });
}

export function broadcastDeepLink(link: AtlasDeepLink): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.appDeepLink, link);
  }
}

/*
  A link that lands before any window exists (cold start) would be broadcast
  into the void. Park the first one; the renderer pulls it over
  `deepLink:consume` as soon as its subscription is live.
*/
let pendingLaunchLink: AtlasDeepLink | null = null;

function deliverOrPark(link: AtlasDeepLink): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    pendingLaunchLink ??= link;
    logger.info('deeplink.parked', { kind: link.kind });
  } else {
    broadcastDeepLink(link);
  }
}

/** Scan a cold-start argv (Windows/Linux) for an `atlas://` URL and park it. */
export function parkColdStartLink(argv: string[]): void {
  const url = argv.find((entry) => entry.startsWith(`${ATLAS_SCHEME}://`));
  if (!url) return;
  const link = parseAtlasDeepLink(url);
  if (link) {
    logger.info('deeplink.cold-start', { url });
    deliverOrPark(link);
  }
}

/** Answers the renderer's one-time pull of a pre-window launch link. */
export function registerDeepLinkIpc(): void {
  ipcMain.handle(IPC_CHANNELS.deepLinkConsume, () => {
    const link = pendingLaunchLink;
    pendingLaunchLink = null;
    return link;
  });
}

/**
 * Cold/warm OS launches: macOS delivers `open-url`, Windows/Linux put the
 * URL in argv of a second instance. Wire both; unknown argv entries are
 * simply ignored by the parser.
 */
export function wireOsLaunchLinks(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const link = parseAtlasDeepLink(url);
    if (link) {
      logger.info('deeplink.open-url', { url });
      deliverOrPark(link);
    }
  });

  app.on('second-instance', (_event, argv) => {
    const url = argv.find((entry) => entry.startsWith(`${ATLAS_SCHEME}://`));
    if (!url) return;
    const link = parseAtlasDeepLink(url);
    if (link) {
      logger.info('deeplink.second-instance', { url });
      deliverOrPark(link);
    }
  });
}
