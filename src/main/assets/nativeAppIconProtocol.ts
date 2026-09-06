import { protocol } from 'electron/main';
import * as fs from 'node:fs';

import { NATIVE_APP_ICON_SCHEME, parseNativeAppIconUrl } from '../../shared/nativeAppIconUrl';
import type { NativeAppIconResolver } from './NativeAppIconResolver';

export function registerNativeAppIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: NATIVE_APP_ICON_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function registerNativeAppIconProtocolHandler(resolver: NativeAppIconResolver): void {
  protocol.handle(NATIVE_APP_ICON_SCHEME, async (request) => {
    const app = parseNativeAppIconUrl(request.url);
    if (!app) {
      return new Response('Invalid native app icon URL', { status: 400 });
    }

    const iconFilePath = await resolver.resolve(app);
    if (!iconFilePath || !fs.existsSync(iconFilePath)) {
      return new Response('Icon not found', { status: 404 });
    }

    try {
      const data = await fs.promises.readFile(iconFilePath);
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      });
    } catch {
      return new Response('Failed to read icon', { status: 500 });
    }
  });
}
