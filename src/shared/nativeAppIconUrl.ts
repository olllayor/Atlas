import type { ToolActivityNativeAppReference } from './contracts';

export const NATIVE_APP_ICON_SCHEME = 'atlas-native-app-icon';

export function buildNativeAppIconUrl(app: ToolActivityNativeAppReference): string {
  if (app._tag === 'app-id') {
    return `${NATIVE_APP_ICON_SCHEME}://app-id/${encodeURIComponent(app.appId)}`;
  }
  return `${NATIVE_APP_ICON_SCHEME}://display-name/${encodeURIComponent(app.displayName)}`;
}

export function parseNativeAppIconUrl(rawUrl: string): ToolActivityNativeAppReference | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${NATIVE_APP_ICON_SCHEME}:`) return null;
    const host = url.host || url.hostname;
    const pathValue = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!pathValue) return null;

    if (host === 'app-id') {
      return { _tag: 'app-id', appId: pathValue };
    }
    if (host === 'display-name') {
      return { _tag: 'display-name', displayName: pathValue };
    }
    return null;
  } catch {
    return null;
  }
}
