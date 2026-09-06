/**
 * A 3.7 MB screenshot becomes ~4.9 MB of base64 in the request body, which is
 * what stalled a gateway past the 180s first-response watchdog. These pin the
 * rule that decides what gets re-encoded.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_IMAGE_EDGE_PX, buildCompressionCandidates, planImageDownscale } from '../src/shared/imageDownscale';

test('a small image is left exactly as attached', () => {
  assert.equal(planImageDownscale({ width: 800, height: 600, bytes: 120_000 }), null);
});

test('an oversized image is scaled to the long edge, keeping its aspect ratio', () => {
  const plan = planImageDownscale({ width: 4000, height: 2000, bytes: 3_683_809 });

  assert.deepEqual(plan, { width: MAX_IMAGE_EDGE_PX, height: MAX_IMAGE_EDGE_PX / 2 });
});

test('the long edge is the constraint whichever way the image is oriented', () => {
  const plan = planImageDownscale({ width: 1000, height: 5000, bytes: 4_000_000 });

  assert.equal(plan?.height, MAX_IMAGE_EDGE_PX);
  assert.ok(plan!.width < MAX_IMAGE_EDGE_PX);
});

test('a heavy but small-in-pixels image is re-encoded at its own size', () => {
  // Nothing to resize, but 2 MB of PNG for 900×900 is worth recompressing.
  assert.deepEqual(planImageDownscale({ width: 900, height: 900, bytes: 2_000_000 }), {
    width: 900,
    height: 900,
  });
});

test('an extreme aspect ratio never scales an edge to zero', () => {
  const plan = planImageDownscale({ width: 8000, height: 1, bytes: 2_000_000 });

  assert.equal(plan?.width, MAX_IMAGE_EDGE_PX);
  assert.equal(plan?.height, 1);
});

test('unusable dimensions are left alone rather than guessed at', () => {
  assert.equal(planImageDownscale({ width: 0, height: 0, bytes: 5_000_000 }), null);
  assert.equal(planImageDownscale({ width: Number.NaN, height: 100, bytes: 5_000_000 }), null);
});

test('compression candidates start within the vision long edge', () => {
  const candidates = buildCompressionCandidates(4000, 2000);

  assert.ok(candidates.length > 0);
  assert.ok(Math.max(candidates[0]!.width, candidates[0]!.height) <= MAX_IMAGE_EDGE_PX);
});

test('compression candidates try WebP before JPEG at each size', () => {
  const candidates = buildCompressionCandidates(1600, 1200);
  const firstSize = candidates.filter(
    (candidate) => candidate.width === candidates[0]!.width && candidate.height === candidates[0]!.height,
  );

  assert.ok(firstSize.length > 1);
  assert.equal(firstSize[0]!.mime, 'image/webp');
  assert.ok(firstSize.some((candidate) => candidate.mime === 'image/jpeg'));
  const firstJpeg = firstSize.findIndex((candidate) => candidate.mime === 'image/jpeg');
  assert.ok(firstSize.slice(firstJpeg).every((candidate) => candidate.mime === 'image/jpeg'));
});

test('compression candidates shrink dimensions when quality alone is not enough', () => {
  const candidates = buildCompressionCandidates(1568, 1568);
  const last = candidates[candidates.length - 1]!;

  assert.ok(last.width < 1568 && last.height < 1568);
});

test('compression candidates never scale an edge to zero', () => {
  for (const candidate of buildCompressionCandidates(8000, 1)) {
    assert.ok(candidate.width >= 1 && candidate.height >= 1);
  }
});

test('compression candidates are empty for unusable dimensions', () => {
  assert.deepEqual(buildCompressionCandidates(0, 100), []);
  assert.deepEqual(buildCompressionCandidates(Number.NaN, 100), []);
});
