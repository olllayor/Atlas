/**
 * The security boundary around the in-app browser.
 *
 * The Browser surface renders third-party pages — a local dev server today,
 * whatever the user types tomorrow — inside the app window. That is the only
 * place in Atlas where hostile content gets to run, so every decision here is
 * "deny, then allow what the feature actually needs".
 *
 * Three layers, because the first two can be got at from the renderer:
 *
 *   1. The `<webview>` element's own `webpreferences` attribute
 *      (`BROWSER_WEBVIEW_PREFERENCES` in `shared/browser.ts`), which is
 *      what the renderer asks for.
 *   2. `will-attach-webview` in main, which overwrites those preferences on
 *      the real object and refuses any guest that is not on the browser
 *      partition. A renderer bug — or a compromised renderer — cannot widen
 *      the guest's privileges, because main has the last word.
 *   3. The guest session itself: every permission denied, popups denied,
 *      navigation limited to http(s).
 *
 * Notably *unlike* t3code (`apps/desktop/src/preview/WebviewPreferences.ts`),
 * context isolation stays ON. They turn it off so an element-picker preload
 * can share `globalThis` with the page and read the React DevTools hook.
 * Atlas ships no picker, so it pays none of that cost: no preload is attached
 * to a guest at all, which is a strictly smaller attack surface.
 */

import type { BrowserWindow, Session, WebContents } from 'electron';
import { shell } from 'electron/common';
import { session as electronSession } from 'electron/main';

import { BROWSER_PARTITION, hardenWebviewPreferences, isBrowsableUrl } from '../../shared/browser';

/**
 * Installs the main-process half on a window that hosts browser surfaces.
 *
 * Attaching a guest on any other partition is refused outright: the whole
 * isolation story rests on the guest not sharing a session with the app, and
 * a `partition` attribute lives in renderer-controlled markup.
 */
export function installWebviewHardening(window: BrowserWindow): void {
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.partition !== BROWSER_PARTITION) {
      event.preventDefault();
      console.warn('[browser] refused a webview outside the browser partition:', params.partition);
      return;
    }

    hardenWebviewPreferences(webPreferences as unknown as Record<string, unknown>);
    // Popups are handled by the window-open handler below, which opens them
    // in the user's real browser instead of an unsupervised child window.
    // The attribute is markup, so its value is a string.
    params.allowpopups = 'false';
  });

  window.webContents.on('did-attach-webview', (_event, guest) => {
    hardenGuestContents(guest);
  });
}

/**
 * Per-guest rules that can only be set once the contents exist.
 *
 * A link to a non-http scheme is dropped rather than handed to the OS:
 * `shell.openExternal` on a URL the page chose is a way to launch things
 * outside the sandbox without the user meaning to.
 */
function hardenGuestContents(guest: WebContents): void {
  guest.setWindowOpenHandler(({ url }) => {
    // Opening a new tab is a real intent, so it is honoured — in the user's
    // own browser, where they can see the address bar and their own
    // extensions, rather than in an unsupervised child window here.
    if (isBrowsableUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  guest.on('will-navigate', (event, url) => {
    if (isBrowsableUrl(url)) return;
    event.preventDefault();
  });

  guest.on('will-redirect', (event, url) => {
    if (isBrowsableUrl(url)) return;
    event.preventDefault();
  });
}

/**
 * Session-wide denials for the browser partition. Call once, after the app is
 * ready and before the first guest attaches.
 *
 * Everything is refused: camera, microphone, geolocation, notifications,
 * clipboard reads, MIDI, the lot. A preview pane exists to look at a page,
 * and a "localhost wants to use your microphone" prompt from inside a coding
 * tool is a prompt nobody can evaluate.
 */
export function hardenBrowserSession(target: Session = electronSession.fromPartition(BROWSER_PARTITION)): Session {
  target.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  target.setPermissionCheckHandler(() => false);

  // A page asking to inspect the host's devices learns nothing it can use.
  target.setDevicePermissionHandler(() => false);

  return target;
}
