import { extname } from 'node:path';

/**
 * Naming a plugin's artwork, without pulling in Electron.
 *
 * Split from the protocol handler for the reason `attachmentProtocol.ts` states
 * about itself: importing `electron/main` makes a module unloadable outside an
 * Electron process, and the view builders that call this are imported directly
 * by tests.
 */
export const PLUGIN_ICON_SCHEME = 'atlas-plugin-icon';

export const PLUGIN_ICON_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

/**
 * The URL for an icon file, or `null` when it is not one.
 *
 * Built in main, where the absolute path is known, so the renderer never sees
 * or constructs a path — it receives an opaque URL and hands it to an `img`.
 */
export function pluginIconUrl(absolutePath: string | null): string | null {
  if (!absolutePath || !(extname(absolutePath).toLowerCase() in PLUGIN_ICON_MEDIA_TYPES)) {
    return null;
  }

  return `${PLUGIN_ICON_SCHEME}://icon/${encodeURIComponent(absolutePath)}`;
}
