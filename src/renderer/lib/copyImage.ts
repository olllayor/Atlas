import { notify } from './notify';

/**
 * Copies an image source to the clipboard as image data.
 *
 * The fetch happens here because only the renderer can read every source the
 * app shows: `blob:` object URLs for staged files, `data:` URLs for stored
 * attachments, remote URLs for anything else. The main process then writes
 * the clipboard from a `data:` URL it validates before touching.
 */
export async function copyImageSrc(src: string): Promise<boolean> {
  try {
    const { dataUrl } = src.startsWith('data:')
      ? { dataUrl: src }
      : await fetchImageAsDataUrl(src);
    await window.atlasChat.images.copy(dataUrl);
    notify({ tone: 'success', title: 'Image copied' });
    return true;
  } catch (error) {
    notify({
      tone: 'error',
      title: 'Could not copy the image',
      description: error instanceof Error ? error.message : undefined,
    });
    return false;
  }
}

/** Fetched image bytes plus the MIME type the server claimed. */
export async function fetchImageAsDataUrl(src: string): Promise<{ dataUrl: string; mimeType: string }> {
  const dataUrl = await fetchToDataUrl(src);
  const mimeType = dataUrl.slice('data:'.length, dataUrl.indexOf(';'));
  return { dataUrl, mimeType };
}

async function fetchToDataUrl(src: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(src);
  } catch {
    throw new Error('The image could not be read.');
  }

  if (!response.ok) {
    throw new Error(`The image could not be read (${response.status}).`);
  }

  const blob = await response.blob();

  if (!blob.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('That image could not be read.'));
      }
    };
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(blob);
  });
}
