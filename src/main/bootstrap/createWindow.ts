import { join } from 'node:path';
import {
  BrowserWindow,
  nativeTheme,
  type Event,
  type HandlerDetails,
  type RenderProcessGoneDetails
} from 'electron/main';
import { shell } from 'electron/common';

import type { DesignTheme, ThemeColorOverride, ThemeMode } from '../../shared/contracts';
import { installWebviewHardening } from '../browser/webviewSecurity';
import {
  chromeStateSignature as chromeSignature,
  resolveChromeBackground,
  resolveChromeSymbolColor,
  type WindowChromeState,
} from './windowChrome';
import { getAppIconPath } from './iconPath';
import { perfMark } from './perfTrace';
import { IPC_CHANNELS } from '../../shared/ipc';
import { attachContextMenu } from '../ipc/contextMenu';

/**
 * The renderer paints its own titlebar (52px, `--titlebar-height`), so the
 * native frame is hidden — but "hidden" means something different on every
 * platform:
 *
 * - macOS: `hiddenInset` keeps the traffic lights, which we position
 *   explicitly so they sit on the vertical centre of the 52px bar instead of
 *   drifting into the conversation title when the sidebar is collapsed.
 * - Windows/Linux: `hiddenInset` is a no-op and there are no traffic lights,
 *   so without `titleBarOverlay` the build ships with **no minimise, maximise
 *   or close button at all**. The overlay draws native controls over our bar,
 *   tinted to match the panel background.
 */
const TITLEBAR_HEIGHT = 52;

/**
 * Window background used whenever vibrancy is off. Exported because the
 * settings IPC has to restore the same value when the setting is turned back
 * off mid-session, and the two had drifted apart once already.
 */
export const OPAQUE_WINDOW_BACKGROUND = '#060709';

/** Fully transparent, so the vibrancy layer behind the page can be seen. */
export const VIBRANT_WINDOW_BACKGROUND = '#00000000';

/**
 * Points the native window appearance at the app's own theme setting.
 *
 * This matters for exactly one thing today, and it is not cosmetic: the macOS
 * vibrancy material follows the *native* appearance, not the page. Left at the
 * default the material tracked the OS, so running the app in light mode on a
 * dark desktop put a near-white translucent sidebar over a dark grey material
 * and the sidebar came out mid-grey. `ThemeMode` and Electron's `themeSource`
 * share their three values, so this is a straight pass-through.
 */
export function syncNativeTheme(mode: ThemeMode) {
  nativeTheme.themeSource = mode;
}

export type { WindowChromeState };
export { chromeStateSignature } from './windowChrome';

/*
 * Keeps the native frame on the same palette as the page. The page background
 * covers everything after first paint, but the window background shows during
 * startup/resize, and the overlay controls sit outside the page entirely.
 * Vibrancy owns the background while active, so leave it transparent there.
 *
 * Deduped per window by state signature (t3code's lastDesktopTheme guard):
 * settings IPC fires on every appearance patch, and most patches change no
 * color. A failure resets the guard so the next change retries instead of
 * latching a stale frame.
 */
const lastChromeSignature = new WeakMap<BrowserWindow, string>();

export function syncWindowChrome(window: BrowserWindow, state: WindowChromeState) {
  const systemDark = nativeTheme.shouldUseDarkColors;
  const signature = chromeSignature(state, systemDark);
  if (lastChromeSignature.get(window) === signature) return;
  const vibrant = state.translucentSidebar && process.platform === 'darwin';
  const background = vibrant ? VIBRANT_WINDOW_BACKGROUND : resolveChromeBackground(state, systemDark);
  try {
    window.setBackgroundColor(background);
  } catch {
    // Headless/test windows may not support it; page theme still applies.
    // Guard stays unset so the next change retries.
    return;
  }
  if (process.platform !== 'darwin') {
    try {
      window.setTitleBarOverlay({
        color: background,
        symbolColor: resolveChromeSymbolColor(state, systemDark),
        height: TITLEBAR_HEIGHT,
      });
    } catch {
      // Older Electron or test doubles; overlay stays at creation value.
      return;
    }
  }
  lastChromeSignature.set(window, signature);
}

function titleBarOptions() {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset' as const,
      // 16px traffic lights centred in a 52px bar.
      trafficLightPosition: { x: 16, y: 18 }
    };
  }

  return {
    titleBarStyle: 'hidden' as const,
    titleBarOverlay: {
      color: '#07080b',
      symbolColor: '#9aa3b2',
      height: TITLEBAR_HEIGHT
    }
  };
}

/**
 * Renderer crashes we answer with a reload, and the ceiling on how often.
 *
 * `clean-exit` and `killed` are excluded: the first is an orderly teardown and
 * the second is someone (or the OS) deliberately ending the process, and
 * resurrecting either would fight the intent.
 */
const RECOVERABLE_EXIT_REASONS = new Set(['crashed', 'oom', 'abnormal-exit', 'launch-failed']);

/**
 * A crash *during boot* would otherwise reload into the same crash forever, so
 * recovery is capped rather than unconditional. Three inside a rolling minute
 * is enough to ride out a one-off OOM and few enough that a reproducible boot
 * crash gives up quickly and leaves the failure visible.
 */
const MAX_RELOADS = 3;
const RELOAD_WINDOW_MS = 60_000;

/**
 * Bring the window back after the renderer process dies.
 *
 * V8 has a hard heap ceiling, and a long session with a large transcript can
 * reach it. When it does, the renderer is gone but the window frame survives —
 * the user is left staring at a white rectangle while agents carry on working
 * invisibly behind it. Electron reports this and does nothing else.
 *
 * A reload is a complete fix here in a way it would not be in a browser: every
 * piece of durable state lives in SQLite in the main process, so the renderer
 * holds nothing that is not re-readable. The white screen becomes a blink.
 *
 * `now` is injected so the rolling window is testable without waiting a minute.
 */
export function attachRendererRecovery(
  window: BrowserWindow,
  now: () => number = () => Date.now()
) {
  let reloadTimestamps: number[] = [];

  window.webContents.on(
    'render-process-gone',
    (_event: Event, details: RenderProcessGoneDetails) => {
      if (!RECOVERABLE_EXIT_REASONS.has(details.reason)) return;
      if (window.isDestroyed()) return;

      const at = now();
      reloadTimestamps = reloadTimestamps.filter((stamp) => at - stamp < RELOAD_WINDOW_MS);

      if (reloadTimestamps.length >= MAX_RELOADS) {
        console.error(
          `[window] renderer gone (${details.reason}); ${MAX_RELOADS} reloads inside ${RELOAD_WINDOW_MS}ms already, not retrying.`
        );
        return;
      }

      reloadTimestamps.push(at);
      console.warn(
        `[window] renderer gone (${details.reason}); reloading (${reloadTimestamps.length}/${MAX_RELOADS}).`
      );
      window.webContents.reload();
    }
  );
}

export type CreateWindowOptions = {
  /** macOS-only: sidebar vibrancy so the desktop shows through translucent panels. */
  translucentSidebar?: boolean;
  themeMode?: ThemeMode;
  designTheme?: DesignTheme;
  backgroundColor?: ThemeColorOverride;
  foregroundColor?: ThemeColorOverride;
};

export function createWindow({
  translucentSidebar = false,
  themeMode = 'dark',
  designTheme = 'atlas',
  backgroundColor = null,
  foregroundColor = null,
}: CreateWindowOptions = {}) {
  const icon = getAppIconPath();
  // Vibrancy only reads through where the page paints transparent pixels, so
  // the window background must be transparent too. Everything except the
  // sidebar keeps an opaque themed background and is unaffected.
  const withVibrancy = translucentSidebar && process.platform === 'darwin';
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    // Passed unconditionally: the constructor stores it and re-applies it when
    // vibrancy is switched on mid-session (settings IPC), so a live toggle gets
    // the same always-active material a restart would have created. Inert while
    // no vibrancy view exists.
    visualEffectState: 'active',
    ...(withVibrancy
      ? {
          vibrancy: 'sidebar' as const,
          // Without this the material desaturates to flat grey the moment the
          // app loses focus, which reads as the sidebar having changed colour
          // rather than as the window being in the background.
          backgroundColor: VIBRANT_WINDOW_BACKGROUND,
        }
      : { backgroundColor: OPAQUE_WINDOW_BACKGROUND }),
    ...titleBarOptions(),
    ...(icon && process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only uses `contextBridge` and `ipcRenderer` (both available
      // inside a sandboxed renderer) and electron-vite bundles it into one
      // self-contained file, so the renderer runs fully sandboxed. This keeps
      // the UI process from ever reaching Node/Electron host APIs directly.
      sandbox: true,
      // The right panel's Browser surface hosts third-party pages in a
      // `<webview>`. This flag only lets the renderer *create* a guest; what
      // the guest is allowed to do is decided in main by
      // `installWebviewHardening`, which overwrites the guest's preferences
      // and refuses any partition but the browser one. The renderer's own
      // privileges are unchanged.
      webviewTag: true
    }
  });

  installWebviewHardening(window);

  window.webContents.setWindowOpenHandler(({ url }: HandlerDetails) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  attachRendererRecovery(window);
  attachContextMenu(window);
  // Paint the native frame (background + overlay controls) in the active theme
  // from the first frame, not just after the first settings change.
  syncWindowChrome(window, {
    themeMode,
    designTheme,
    backgroundColor,
    foregroundColor,
    translucentSidebar,
  });

  window.webContents.on('will-navigate', (event: Event, url: string) => {
    const isLocalFile = url.startsWith('file://');
    const isDevServer = url.startsWith('http://localhost:');

    if (!isLocalFile && !isDevServer) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Native fullscreen hides the traffic lights and the system menu bar, so the
  // 52px drag strip the sidebar reserves for them becomes dead space. The
  // renderer collapses it, and only this process is told when the state flips.
  const sendFullScreenState = () => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.windowFullScreenChanged, window.isFullScreen());
  };
  window.on('enter-full-screen', sendFullScreenState);
  window.on('leave-full-screen', sendFullScreenState);

  window.once('ready-to-show', () => {
    perfMark('window:ready-to-show (first paint possible)');
    window.show();
  });

  window.webContents.once('did-finish-load', () => {
    perfMark('window:did-finish-load');
  });

  return window;
}
