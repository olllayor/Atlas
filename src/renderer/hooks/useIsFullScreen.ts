import { useEffect, useState } from 'react';

/**
 * Whether the window is in native fullscreen.
 *
 * Chromium's `display-mode` media query does not track macOS fullscreen in a
 * frameless Electron window, so the main process is the only source: it answers
 * the first paint over `getFullScreen` and pushes every transition after that.
 */
export function useIsFullScreen(): boolean {
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    const bridge = window.atlasChat?.window;
    if (!bridge) return;

    let cancelled = false;
    void bridge
      .getFullScreen()
      .then((value) => {
        if (!cancelled) setIsFullScreen(value);
      })
      .catch(() => {
        // Chrome state is cosmetic: a failed read leaves the strip reserved,
        // which is the windowed layout and always safe.
      });

    const unsubscribe = bridge.onFullScreenChange(setIsFullScreen);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return isFullScreen;
}
