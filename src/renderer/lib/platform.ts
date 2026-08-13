/**
 * Renderer-side platform check.
 *
 * Kept in one place because two unrelated features branch on it and had each
 * grown their own copy: the macOS traffic-light inset in the header, and the
 * translucent sidebar (vibrancy is a macOS-only window material — everywhere
 * else the window is opaque, so a translucent panel would blend into a
 * hardcoded window colour rather than the desktop).
 */
export const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
