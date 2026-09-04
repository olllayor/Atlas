import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { BrowserWindow, dialog, ipcMain } from 'electron/main';
import { clipboard, nativeImage } from 'electron/common';

import type { SaveImageRequest, SaveImageResult } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/**
 * Clipboard writes for images.
 *
 * Bytes never cross as paths or remote URLs: the renderer hands over an
 * image `data:` URL (it alone can read `blob:` sources), and this side only
 * decodes and writes. Anything that is not image data is refused before the
 * clipboard is touched.
 */

/** ~48 MB of image bytes once base64 is decoded. */
const MAX_IMAGE_DATA_URL_LENGTH = 64_000_000;

export function registerImagesIpc() {
  ipcMain.handle(
    IPC_CHANNELS.imagesCopy,
    withUserFacingErrors(IPC_CHANNELS.imagesCopy, async (event, dataUrl: unknown): Promise<void> => {
      assertTrustedSender(event);

      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        throw new Error('That is not an image Atlas can copy.');
      }

      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        throw new Error('That image is too large to copy.');
      }

      const image = nativeImage.createFromDataURL(dataUrl);

      if (image.isEmpty()) {
        throw new Error('That image could not be read.');
      }

      clipboard.writeImage(image);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.imagesSave,
    withUserFacingErrors(IPC_CHANNELS.imagesSave, async (event, request: unknown): Promise<SaveImageResult> => {
      assertTrustedSender(event);

      const dataUrl = (request as Partial<SaveImageRequest> | null)?.dataUrl;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        throw new Error('That is not an image Atlas can save.');
      }

      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        throw new Error('That image is too large to save.');
      }

      const comma = dataUrl.indexOf(',');
      if (comma === -1) {
        throw new Error('That image could not be read.');
      }

      // The dialog owns the destination: the suggested name is a leaf only,
      // so a hostile renderer cannot steer the write anywhere.
      const suggested = sanitizeImageFilename((request as Partial<SaveImageRequest> | null)?.filename);
      const window = BrowserWindow.fromWebContents(event.sender);
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, {
            title: 'Save image',
            defaultPath: suggested,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] }],
          })
        : await dialog.showSaveDialog({
            title: 'Save image',
            defaultPath: suggested,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] }],
          });

      if (canceled || !filePath) {
        return { saved: false };
      }

      await writeFile(filePath, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
      return { saved: true, path: filePath };
    })
  );
}

/**
 * The suggestion is a dialog seed, not a path: strip directories, illegal
 * characters and runaway length so only a leaf name reaches the dialog.
 */
function sanitizeImageFilename(filename: unknown): string {
  const fallback = 'image.png';
  if (typeof filename !== 'string') return fallback;
  const leaf = basename(filename).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 100);
  return leaf || fallback;
}
