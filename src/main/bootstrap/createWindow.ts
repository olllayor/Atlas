import { join } from 'node:path';
import { BrowserWindow, type Event, type HandlerDetails } from 'electron/main';
import { shell } from 'electron/common';

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
      ? { vibrancy: 'sidebar' as const, backgroundColor: '#00000000' }
      : { backgroundColor: '#060709' }),
    ...titleBarOptions(),
    ...(icon && process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
