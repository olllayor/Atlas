import assert from 'node:assert/strict';
import test from 'node:test';

import { suggestImageFilename } from '../src/renderer/lib/saveImage.js';

test('keeps the server leaf name when it already names an image', () => {
  assert.equal(suggestImageFilename('https://cdn.example/photo.png', 'image/png'), 'photo.png');
  assert.equal(suggestImageFilename('https://cdn.example/a/b/shot.JPG?w=800', 'image/jpeg'), 'shot.jpg');
  assert.equal(suggestImageFilename('file:///tmp/export.webp', 'image/webp'), 'export.webp');
});

test('falls back to image.<ext> from the MIME type otherwise', () => {
  assert.equal(suggestImageFilename('https://cdn.example/thumb?id=9', 'image/jpeg'), 'image.jpg');
  assert.equal(suggestImageFilename('https://cdn.example/no-ext', 'image/svg+xml'), 'image.svg');
  assert.equal(suggestImageFilename('blob:https://atlas/1234', 'image/png'), 'image.png');
  assert.equal(suggestImageFilename('not a url at all', 'image/gif'), 'image.gif');
  assert.equal(suggestImageFilename('https://cdn.example/x.bin', 'application/octet-stream'), 'image.png');
});

test('never returns a path or a blank name', () => {
  assert.equal(suggestImageFilename('https://cdn.example/../evil.png', 'image/png'), 'evil.png');
  assert.equal(suggestImageFilename('https://cdn.example/.png', 'image/png'), 'image.png');
});
