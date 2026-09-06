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

import { buildCompressionCandidates, MAX_COMPRESSIBLE_SOURCE_BYTES } from '../../shared/imageDownscale';
import { isHeicImageFile, MAX_HEIC_METADATA_BYTES, validateHeicMetadataBytes } from '../../shared/heic';

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
 *
 * `preferredMime` forces JPEG output: converted HEIC photos stay JPEG
 * through the shrink pass rather than coming back as WebP.
 */
export async function compressImageToByteLimit(
  file: File,
  limitBytes: number,
  options?: { preferredMime?: 'image/jpeg' },
): Promise<File> {
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
    const candidates = buildCompressionCandidates(bitmap.width, bitmap.height).filter(
      (candidate) => !options?.preferredMime || candidate.mime === options.preferredMime,
    );
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

/**
 * HEIC/HEIF photos become provider-compatible JPEG before the size limit
 * applies, ported from t3code PR #8161. Anything else flows straight into
 * the byte-limit compression. The decoder loads only when such a photo
 * arrives; every failure throws a named error for the attach path.
 */
export async function prepareImageForAttachment(file: File, limitBytes: number): Promise<File> {
  if (!isHeicImageFile(file)) {
    return compressImageToByteLimit(file, limitBytes);
  }

  const name = file.name || 'the image';
  if (file.size > MAX_COMPRESSIBLE_SOURCE_BYTES) {
    throw new Error(`${name} is too large to attach.`);
  }

  // Dimensions decide before the decoder allocates full RGBA buffers: a
  // corrupt head refuses as unreadable, an absurd one as too large.
  const head = new Uint8Array(await file.slice(0, MAX_HEIC_METADATA_BYTES).arrayBuffer());
  const verdict = validateHeicMetadataBytes(head);
  if (verdict === 'too-large') {
    throw new Error(`${name} is too large to attach.`);
  }
  if (verdict !== 'ok') {
    throw new Error(`Could not read ${name}.`);
  }

  let converted: Blob;
  try {
    // `/csp` is the bundler-safe entry point (no Worker/eval); it exposes
    // the converter on its default export in heic-to 1.x.
    const { default: heic } = await import('heic-to/csp');
    converted = await heic.heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  } catch {
    throw new Error(`Could not read ${name}.`);
  }

  const jpeg = new File([converted], withExtension(file.name || 'image', 'image/jpeg'), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
  // The intermediate can expand past the source; the original size already
  // cleared the decode ceiling, so only the output budget matters now. JPEG
  // stays JPEG through the shrink pass.
  return compressImageToByteLimit(jpeg, limitBytes, { preferredMime: 'image/jpeg' });
}
