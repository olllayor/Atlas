/**
 * How large an image may be before it is re-encoded for sending.
 *
 * Vision models downscale on their side regardless — our own cost estimate
 * caps at `IMAGE_TOKENS_MAX` — so a 3.7 MB screenshot buys nothing over a
 * 1568px one. What it does buy is a ~4.9 MB base64 body in a JSON request,
 * which is enough to stall an OpenAI-compatible gateway past the 180s
 * first-response watchdog and turn a send into minutes of silent retrying.
 *
 * 1568px is the long edge the major vision APIs quote as the point beyond
 * which they resize anyway.
 */
export const MAX_IMAGE_EDGE_PX = 1568;

/** Below this an image is left exactly as the user attached it. */
export const IMAGE_REENCODE_BYTES = 1_000_000;

export type ImageDownscalePlan = {
  width: number;
  height: number;
};

/**
 * The dimensions an image should be re-encoded at, or null to leave it alone.
 *
 * Small images are untouched whatever their dimensions, and a large-in-bytes
 * but small-in-pixels image is re-encoded at its own size — that is a
 * compression win, not a resize.
 */
export function planImageDownscale({
  width,
  height,
  bytes,
}: {
  width: number;
  height: number;
  bytes: number;
}): ImageDownscalePlan | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const longEdge = Math.max(width, height);
  const oversizedInPixels = longEdge > MAX_IMAGE_EDGE_PX;
  const oversizedInBytes = bytes > IMAGE_REENCODE_BYTES;

  if (!oversizedInPixels && !oversizedInBytes) {
    return null;
  }

  if (!oversizedInPixels) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = MAX_IMAGE_EDGE_PX / longEdge;

  return {
    // At least one pixel each way: a 4000×1 panorama must not scale to zero.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
