/**
 * What the in-app browser is, in the terms both processes need.
 *
 * The guest's privileges are stated twice here, because Electron wants them
 * twice: once as the `webpreferences` attribute the renderer puts on the
 * element, and once as the object main overwrites in `will-attach-webview`.
 * Keeping both in one file is what stops them drifting apart, which is the
 * failure mode that matters — the attribute is silently forgiving and the
 * object is the one that actually decides.
 *
 * Also here: what the address bar accepts. It is not a search box. A coding
 * tool's preview pane exists to reach a local app or a URL someone pasted, and
 * quietly turning a typo into a web search would send whatever was typed —
 * which in this app is as likely to be a file path or a secret as a query — to
 * a third party.
 */

/** A local server the user can open, as discovered by main. */
export type DiscoveredServer = {
  url: string;
  port: number;
  /** The process listening, when the OS would say. */
  command: string | null;
};

/**
 * Guests live in their own persistent partition. Persistent so a login to a
 * local app survives a restart; separate so a page can never see a cookie,
 * cache entry or storage key belonging to Atlas itself.
 *
 * Shared because the renderer puts it on the element and main refuses any
 * other value — one constant, checked on both sides.
 */
export const BROWSER_PARTITION = 'persist:atlas-browser';

/**
 * The `webpreferences` attribute the renderer puts on the element.
 *
 * The format is unforgiving and silent when wrong: Electron splits on `,`
 * without trimming, so a stray space turns a key into an unknown one and drops
 * it, and values are parsed as JS booleans — `"no"` is a truthy *string*,
 * which would quietly enable whatever it was meant to disable. Keep it
 * whitespace-free, `true`/`false` only.
 *
 * Main enforces the same values on the real preferences object anyway; this
 * string exists so the guest never momentarily exists with defaults.
 */
export const BROWSER_WEBVIEW_PREFERENCES =
  'contextIsolation=true,sandbox=true,nodeIntegration=false,webviewTag=false';

type MutableWebPreferences = Record<string, unknown>;

/**
 * The privileges a guest gets, decided in main and not negotiable.
 *
 * `preload` is deleted rather than set: an empty string is still a preload
 * entry, and the guest needs no bridge of any kind.
 */
export function hardenWebviewPreferences(preferences: MutableWebPreferences): void {
  preferences.nodeIntegration = false;
  preferences.nodeIntegrationInWorker = false;
  preferences.nodeIntegrationInSubFrames = false;
  preferences.contextIsolation = true;
  preferences.sandbox = true;
  preferences.webSecurity = true;
  preferences.allowRunningInsecureContent = false;
  preferences.experimentalFeatures = false;
  preferences.enableBlinkFeatures = '';
  // A guest that can itself host guests is a way around every rule above.
  preferences.webviewTag = false;
  delete preferences.preload;
  delete preferences.preloadURL;
}

/** Schemes a guest may reach: no `file:`, no custom scheme, no `javascript:`. */
export function isBrowsableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * Turns what a person types into a URL, or null when it is not one.
 *
 *   3000                 -> http://localhost:3000
 *   localhost:5173/app   -> http://localhost:5173/app
 *   example.com          -> https://example.com
 *   http://foo.test      -> unchanged
 *
 * Loopback defaults to `http`, because a dev server almost never has a
 * certificate; everything else defaults to `https`, because in 2026 a bare
 * hostname that only speaks plaintext is the exception.
 */
export function normalizeBrowserUrl(raw: string): string | null {
  const input = raw.trim();
  if (!input || /\s/.test(input)) return null;

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    return isHttpUrl(input) ? input : null;
  }

  // A bare port number is the most common thing to type here.
  if (/^\d{1,5}$/.test(input)) {
    const port = Number(input);
    return port > 0 && port <= 65_535 ? `http://localhost:${port}` : null;
  }

  // ":3000" and "/health" are both shorthand people reach for; only the first
  // names a server.
  if (/^:\d{1,5}(\/|$)/.test(input)) return `http://localhost${input}`;
  if (input.startsWith('/')) return null;

  const host = input.split(/[/?#]/, 1)[0].split(':', 1)[0].toLowerCase();
  const scheme = LOOPBACK_HOSTS.has(host) ? 'http' : 'https';
  const candidate = `${scheme}://${input}`;

  if (!isHttpUrl(candidate)) return null;
  // Something with no dot and no port is a word, not a host.
  if (!host.includes('.') && !LOOPBACK_HOSTS.has(host) && !/:\d+/.test(input)) return null;

  return candidate;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/** What the address bar shows: the URL, minus the noise every URL carries. */
export function displayBrowserUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}
