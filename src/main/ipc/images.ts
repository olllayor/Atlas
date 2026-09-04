import { ipcMain } from 'electron/main';
import { clipboard, nativeImage } from 'electron/common';

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
}
