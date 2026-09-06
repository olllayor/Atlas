/**
 * HEIC/HEIF photo handling, ported from t3code PR #8161.
 *
 * Providers cannot consume Apple's format and renderers cannot decode it, so
 * HEIC photos are converted to JPEG before staging. The ISO BMFF metadata is
 * validated before the decoder loads: dimensions decide whether decoding is
 * safe, and corrupt metadata refuses early instead of OOMing on garbage.
 *
 * Pure and free of DOM APIs so the metadata walk can be unit-tested directly.
 */

const HEIC_IMAGE_MIME_TYPE = /^image\/hei(?:c|f)$/i;
const HEIC_IMAGE_EXTENSION = /\.(?:heic|heif)$/i;

/** Full-resolution phone photos: 24 MP and 48 MP must pass. */
export const MAX_HEIC_DECODE_PIXELS = 64_000_000;
/** The meta box lives near the head; no need to read the whole file. */
export const MAX_HEIC_METADATA_BYTES = 1024 * 1024;

export type HeicMetadataVerdict = 'ok' | 'unreadable' | 'too-large';

/**
 * Finder and some browsers omit the MIME type on dragged HEIC photos, so the
 * extension counts when the type is empty or a generic octet-stream. A
 * concrete image MIME always wins: a PNG misnamed `.heic` is a PNG, not a
 * photo to convert.
 */
export function isHeicImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (HEIC_IMAGE_MIME_TYPE.test(file.type)) {
    return true;
  }
  return (
    (file.type === '' || file.type.toLowerCase() === 'application/octet-stream') &&
    HEIC_IMAGE_EXTENSION.test(file.name)
  );
}

type MetadataBox = {
  payloadOffset: number;
  endOffset: number;
};

const BOX_META = 0x6d657461;
const BOX_IPRP = 0x69707270;
const BOX_IPCO = 0x6970636f;
const BOX_ISPE = 0x69737065;

function findBox(view: DataView, startOffset: number, endOffset: number, type: number): MetadataBox | null {
  let offset = startOffset;
  while (offset + 8 <= endOffset) {
    let size = view.getUint32(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > endOffset) return null;
      const extendedSize = view.getBigUint64(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = endOffset - offset;
    }
    if (size < headerSize || size > endOffset - offset) return null;

    const nextOffset = offset + size;
    if (view.getUint32(offset + 4) === type) {
      return { payloadOffset: offset + headerSize, endOffset: nextOffset };
    }
    offset = nextOffset;
  }
  return null;
}

/**
 * Read HEIC image dimensions from the metadata head before the decoder
 * allocates full RGBA buffers. Missing or corrupt boxes read as unreadable;
 * dimensions past the decode ceiling read as too-large.
 */
export function validateHeicMetadataBytes(bytes: Uint8Array): HeicMetadataVerdict {
  if (bytes.length < 8) return 'unreadable';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const meta = findBox(view, 0, view.byteLength, BOX_META);
  if (!meta || meta.payloadOffset + 4 > meta.endOffset) return 'unreadable';
  // The meta box opens with four version/flags bytes before its children.
  const properties = findBox(view, meta.payloadOffset + 4, meta.endOffset, BOX_IPRP);
  if (!properties) return 'unreadable';
  const containers = findBox(view, properties.payloadOffset, properties.endOffset, BOX_IPCO);
  if (!containers) return 'unreadable';

  let offset = containers.payloadOffset;
  let foundImageDimensions = false;
  while (offset < containers.endOffset) {
    const image = findBox(view, offset, containers.endOffset, BOX_ISPE);
    if (!image) break;
    if (image.payloadOffset + 12 > image.endOffset) return 'unreadable';
    const width = view.getUint32(image.payloadOffset + 4);
    const height = view.getUint32(image.payloadOffset + 8);
    if (width === 0 || height === 0) return 'unreadable';
    if (width > MAX_HEIC_DECODE_PIXELS / height) return 'too-large';
    foundImageDimensions = true;
    offset = image.endOffset;
  }
  return foundImageDimensions ? 'ok' : 'unreadable';
}
