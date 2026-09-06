/**
 * HEIC photos convert to JPEG before staging (t3code PR #8161). Detection
 * must trust a concrete MIME over a misleading extension, and corrupt or
 * absurd metadata must refuse before the decoder allocates buffers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHeicImageFile,
  MAX_HEIC_DECODE_PIXELS,
  validateHeicMetadataBytes,
} from '../src/shared/heic';

const encoder = new TextEncoder();

function box(name: string, ...contents: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(8 + contents.reduce((size, content) => size + content.length, 0));
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(encoder.encode(name), 4);
  let offset = 8;
  for (const content of contents) {
    out.set(content, offset);
    offset += content.length;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function heicHead(width: number, height: number): Uint8Array {
  const dimensions = new Uint8Array(12);
  const view = new DataView(dimensions.buffer);
  view.setUint32(4, width);
  view.setUint32(8, height);
  const properties = box('iprp', box('ipco', box('ispe', dimensions)));
  return concat(
    box('ftyp', encoder.encode('heic'), new Uint8Array(4)),
    box('meta', new Uint8Array(4), properties),
  );
}

test('recognizes HEIC and HEIF MIME types and bare extensions', () => {
  assert.equal(isHeicImageFile({ name: 'photo.bin', type: 'image/heic' }), true);
  assert.equal(isHeicImageFile({ name: 'photo.bin', type: 'image/heif' }), true);
  assert.equal(isHeicImageFile({ name: 'IMG_1234.HEIC', type: '' }), true);
  assert.equal(isHeicImageFile({ name: 'photo.heif', type: 'application/octet-stream' }), true);
});

test('a concrete MIME type wins over a misleading HEIC filename', () => {
  assert.equal(isHeicImageFile({ name: 'photo.heic', type: 'image/png' }), false);
  assert.equal(isHeicImageFile({ name: 'photo.heif', type: 'image/jpeg' }), false);
  assert.equal(isHeicImageFile({ name: 'photo.png', type: 'image/png' }), false);
});

test('sequence variants are not still photos to convert', () => {
  assert.equal(isHeicImageFile({ name: 'photo.heic', type: 'image/heic-sequence' }), false);
  assert.equal(isHeicImageFile({ name: 'photo.heif', type: 'image/heif-sequence' }), false);
});

test('accepts full-resolution phone photos', () => {
  assert.equal(validateHeicMetadataBytes(heicHead(4000, 3000)), 'ok');
  assert.equal(validateHeicMetadataBytes(heicHead(5712, 4284)), 'ok');
  assert.equal(validateHeicMetadataBytes(heicHead(8064, 6048)), 'ok');
  assert.ok((8064 * 6048) < MAX_HEIC_DECODE_PIXELS);
});

test('rejects absurd dimensions before the decoder loads', () => {
  assert.equal(validateHeicMetadataBytes(heicHead(16_000, 4001)), 'too-large');
  assert.equal(validateHeicMetadataBytes(heicHead(0, 3000)), 'unreadable');
});

test('rejects corrupt or missing metadata as unreadable', () => {
  assert.equal(validateHeicMetadataBytes(new Uint8Array([1, 2, 3])), 'unreadable');
  assert.equal(validateHeicMetadataBytes(new Uint8Array(0)), 'unreadable');
  // A meta box with no property containers carries no dimensions.
  const bare = concat(
    box('ftyp', encoder.encode('heic'), new Uint8Array(4)),
    box('meta', new Uint8Array(4)),
  );
  assert.equal(validateHeicMetadataBytes(bare), 'unreadable');
});
