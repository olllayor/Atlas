/**
 * Squeeze an over-cap image under a byte limit, ported from t3code PR #4967.
 *
 * Pastes/drops over `MAX_ATTACHMENT_SIZE_BYTES` used to fail outright — even
 * big retina screenshots that compress with no meaningful quality loss. Now
 * they walk `buildCompressionCandidates` (WebP first, JPEG fallback, then
 * smaller) and the first encode within budget wins.
 *
 * Renderer-only: canvas decode/encode lives here, the attempt ladder stays in
 * `shared/imageDownscale.ts` so it can be unit-tested without a DOM.
 */

import { buildCompressionCandidates } from '../../shared/imageDownscale';

const encodeCanvas = (canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> => {
  // Canvas toBlob is callback-based; wrapping in a Promise is unavoidable.
  // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
};

/**
 * Re-encode `file` so it fits `limitBytes`. Non-images pass through
 * untouched; decode failures throw so the caller can surface a named error.
 * The returned file keeps the source name apart from its extension, which
 * always matches the new bytes (`.webp`/`.jpg`).
 */
export async function compressImageToByteLimit(file: File, limitBytes: number): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Could not read ${file.name || 'the image'}.`);
  }

  try {
    const candidates = buildCompressionCandidates(bitmap.width, bitmap.height);
    if (candidates.length === 0) {
      return file;
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    let smallest: Blob | null = null;
    let smallestMime = 'image/jpeg';
    let webpSupported = true;

    for (const candidate of candidates) {
      if (candidate.mime === 'image/webp' && !webpSupported) {
        continue;
      }
      canvas.width = candidate.width;
      canvas.height = candidate.height;
      context.drawImage(bitmap, 0, 0, candidate.width, candidate.height);
      const blob = await encodeCanvas(canvas, candidate.mime, candidate.quality);
      if (!blob) {
        // No WebP encoder here: skip the rest of the WebP attempts and fall
        // through to JPEG rather than failing the attach.
        if (candidate.mime === 'image/webp') {
          webpSupported = false;
        }
        continue;
      }
      if (blob.size <= limitBytes) {
        return new File([blob], withExtension(file.name, candidate.mime), {
          type: blob.type || candidate.mime,
          lastModified: file.lastModified,
        });
      }
      if (!smallest || blob.size < smallest.size) {
        smallest = blob;
        smallestMime = candidate.mime;
      }
    }

    if (!smallest) {
      throw new Error(`Could not read ${file.name || 'the image'}.`);
    }
    // Nothing fit: hand back the smallest encode so the caller can report
    // the miss against the real residue, not the uncompressed source.
    return new File([smallest], withExtension(file.name, smallestMime), {
      type: smallest.type || smallestMime,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap?.close();
  }
}

function withExtension(name: string, mime: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${mime === 'image/webp' ? 'webp' : 'jpg'}`;
}
