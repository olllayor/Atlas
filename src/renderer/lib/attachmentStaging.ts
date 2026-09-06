/**
 * Reads a staged `blob:` URL back into a `data:` URL for the stage IPC.
 *
 * Only the renderer can read `blob:` sources, so the bytes cross to the
 * main process as a data URL — the same arrangement as the images
 * clipboard/save bridge. Any attachment kind works; FileReader sniffs
 * nothing, it just encodes.
 */
export async function stagedBlobToDataUrl(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error('That file could not be read. Remove it and attach it again.');
  }
  if (!response.ok) {
    throw new Error('That file could not be read. Remove it and attach it again.');
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('That file could not be read. Remove it and attach it again.'));
      }
    };
    reader.onerror = () => reject(new Error('That file could not be read. Remove it and attach it again.'));
    reader.readAsDataURL(blob);
  });
}

export function stagingErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'That file could not be saved. Retry to try again.';
}
