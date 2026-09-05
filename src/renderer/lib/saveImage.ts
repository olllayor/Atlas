import { fetchImageAsDataUrl } from './copyImage';
import { notify } from './notify';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tif', 'tiff']);

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
};

/**
 * Suggested file name for the save dialog. Keeps the server's leaf name when
 * it already names an image (`…/photo.PNG` → `photo.PNG`); otherwise falls
 * back to `image.<ext>` from the MIME type. Never a path, never blank.
 */
export function suggestImageFilename(src: string, mimeType: string | null): string {
  const fallback = `image.${extensionForMime(mimeType)}`;

  let pathname: string | null = null;
  try {
    const url = new URL(src);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') {
      pathname = url.pathname;
    }
  } catch {
    pathname = null;
  }

  const leaf = pathname?.split('/').pop()?.trim() ?? '';
  const dot = leaf.lastIndexOf('.');
  if (dot > 0) {
    const ext = leaf.slice(dot + 1).toLowerCase();
    const name = leaf.slice(0, dot);
    if (name && IMAGE_EXTENSIONS.has(ext)) {
      return sanitizeLeaf(`${name}.${ext}`) ?? fallback;
    }
  }

  return fallback;
}

function extensionForMime(mimeType: string | null): string {
  if (mimeType) {
    const known = MIME_EXTENSION[mimeType.toLowerCase()];
    if (known) return known;
  }
  return 'png';
}

function sanitizeLeaf(leaf: string): string | null {
  const clean = leaf
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100);
  return clean || null;
}

/**
 * Saves an image source through the main-process save dialog.
 *
 * Mirrors the copy flow: the fetch happens here because only the renderer
 * can read every source the app shows (`blob:` object URLs for staged files,
 * `data:` URLs for stored attachments, remote URLs for anything else). A
 * cancelled dialog stays silent — dismissing is not an error.
 */
export async function saveImageSrc(src: string): Promise<boolean> {
  try {
    let dataUrl: string;
    let mimeType: string | null;
    if (src.startsWith('data:')) {
      dataUrl = src;
      mimeType = src.slice('data:'.length, src.indexOf(';')) || null;
    } else {
      ({ dataUrl, mimeType } = await fetchImageAsDataUrl(src));
    }

    const result = await window.atlasChat.images.save({
      dataUrl,
      filename: suggestImageFilename(src, mimeType),
    });

    if (result.saved) {
      notify({ tone: 'success', title: 'Image saved' });
      return true;
    }
    return false;
  } catch (error) {
    notify({
      tone: 'error',
      title: 'Could not save the image',
      description: error instanceof Error ? error.message : undefined,
    });
    return false;
  }
}
