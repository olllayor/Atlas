import { protocol } from 'electron/main';
import { extname } from 'node:path';

import { ATTACHMENT_SCHEME, type AttachmentStore } from './AttachmentStore';

/**
 * This lives apart from `AttachmentStore` on purpose: the store is plain fs
 * work that the repository tests import directly, and pulling `electron/main`
 * into it makes the module unloadable outside an Electron process.
 */

const EXTENSION_TO_MEDIA_TYPE: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

/**
 * Must run before `app.whenReady()`, like the site preview scheme.
 *
 * Attachments used to reach the renderer as `file://` URLs, which the app's
 * CSP does not allow — so every stored image rendered as its filename and no
 * picture. Serving them over their own scheme fixes that without opening the
 * renderer up to the whole filesystem the way `img-src file:` would.
 */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ATTACHMENT_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** Call once, after `app.whenReady()`. */
export function registerAttachmentProtocolHandler(
  store: Pick<AttachmentStore, 'readAttachmentData'>
): void {
  protocol.handle(ATTACHMENT_SCHEME, (request) => {
    let storageKey: string;

    try {
      storageKey = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad attachment URL', { status: 400 });
    }

    const data = store.readAttachmentData(storageKey);

    if (!data) {
      // Also the answer for a key that resolved outside the root:
      // `readAttachmentData` refuses those, and "not found" is all a caller
      // needs to learn from either case.
      return new Response('Attachment not found', { status: 404 });
    }

    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': EXTENSION_TO_MEDIA_TYPE[extname(storageKey).toLowerCase()] ?? 'application/octet-stream',
        // Immutable: a storage key names one set of bytes, forever.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });
}
