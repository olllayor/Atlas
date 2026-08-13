import { protocol } from 'electron/main';
import { readFileSync, realpathSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

import { PLUGIN_ICON_MEDIA_TYPES, PLUGIN_ICON_SCHEME } from './pluginIconUrl';

export { PLUGIN_ICON_SCHEME } from './pluginIconUrl';

/**
 * Serving plugin artwork to the renderer.
 *
 * A plugin's icon is a file inside its bundle, and the renderer has neither a
 * filesystem nor permission to load `file://` under the app's CSP. The same
 * problem attachments had, solved the same way — its own scheme rather than
 * widening `img-src`.
 *
 * The security property that matters: a bundle names its icon in a manifest it
 * controls, so the URL is effectively attacker-chosen. Every request is
 * therefore resolved and proven to sit inside one of a fixed set of roots
 * before a byte is read. Nothing outside those roots is reachable, whatever the
 * manifest says.
 */

/** Icons are small. A bundle offering something enormous is not sending an icon. */
const MAX_ICON_BYTES = 2 * 1024 * 1024;

export function registerPluginIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_ICON_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ]);
}

/**
 * @param roots Directories icons may be served from — the plugins directory and
 * the marketplace checkouts. Read on every request so a newly added
 * marketplace does not need a restart.
 */
export function registerPluginIconProtocolHandler(roots: () => string[]): void {
  protocol.handle(PLUGIN_ICON_SCHEME, (request) => {
    let requested: string;

    try {
      requested = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad icon URL', { status: 400 });
    }

    const path = resolveWithin(requested, roots());

    if (!path) {
      // The same answer for "no such file" and "outside every root". A caller
      // learns nothing useful from the difference, and an attacker would.
      return new Response('Not found', { status: 404 });
    }

    let data: Buffer;

    try {
      data = readFileSync(path);
    } catch {
      return new Response('Not found', { status: 404 });
    }

    if (data.byteLength > MAX_ICON_BYTES) {
      return new Response('Too large', { status: 413 });
    }

    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': PLUGIN_ICON_MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        // Short rather than immutable: a path is not a content address here, and
        // reinstalling a plugin can change the bytes behind the same one.
        'Cache-Control': 'private, max-age=60'
      }
    });
  });
}

/** An absolute path proven to sit inside one of the allowed roots. */
function resolveWithin(requested: string, roots: string[]): string | null {
  let real: string;

  try {
    real = realpathSync(resolve(requested));
  } catch {
    return null;
  }

  for (const root of roots) {
    let realRoot: string;

    try {
      realRoot = realpathSync(root);
    } catch {
      continue;
    }

    // The separator matters: without it `/plugins-evil` reads as inside
    // `/plugins`.
    if (real.startsWith(realRoot + sep)) {
      return real;
    }
  }

  return null;
}
