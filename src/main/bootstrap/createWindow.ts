import { join } from 'node:path';
import { BrowserWindow, nativeTheme, type Event, type HandlerDetails } from 'electron/main';
import { shell } from 'electron/common';

import type { ThemeMode } from '../../shared/contracts';
import { getAppIconPath } from './iconPath';

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

export type CreateWindowOptions = {
  /** macOS-only: sidebar vibrancy so the desktop shows through translucent panels. */
  translucentSidebar?: boolean;
};

export function createWindow({ translucentSidebar = false }: CreateWindowOptions = {}) {
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
    ...(withVibrancy
      ? {
          vibrancy: 'sidebar' as const,
          // Without this the material desaturates to flat grey the moment the
          // app loses focus, which reads as the sidebar having changed colour
          // rather than as the window being in the background.
          visualEffectState: 'active' as const,
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
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }: HandlerDetails) => {
    void shell.openExternal(url);
    return { action: 'deny' };
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

  window.once('ready-to-show', () => {
    window.show();
  });

  return window;
}
