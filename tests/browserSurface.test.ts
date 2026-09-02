import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_WEBVIEW_PREFERENCES,
  displayBrowserUrl,
  hardenWebviewPreferences,
  isBrowsableUrl,
  normalizeBrowserUrl,
} from '../src/shared/browser.js';
import {
  PortDiscovery,
  parseLsofListeners,
  rankServers,
} from '../src/main/browser/PortDiscovery.js';
import { nextOrdinalResourceId } from '../src/renderer/components/workbench/rightPanelModel.js';

// ---------------------------------------------------------------------------
// Guest privileges — the part that must not regress quietly
// ---------------------------------------------------------------------------

test('main forces every guest privilege closed, whatever the renderer asked for', () => {
  const preferences: Record<string, unknown> = {
    nodeIntegration: true,
    nodeIntegrationInWorker: true,
    nodeIntegrationInSubFrames: true,
    contextIsolation: false,
    sandbox: false,
    webSecurity: false,
    allowRunningInsecureContent: true,
    experimentalFeatures: true,
    webviewTag: true,
    enableBlinkFeatures: 'SomeFeature',
    preload: '/tmp/evil.js',
    preloadURL: 'file:///tmp/evil.js',
  };

  hardenWebviewPreferences(preferences);

  assert.deepEqual(preferences, {
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    enableBlinkFeatures: '',
  });
  assert.equal('preload' in preferences, false);
  assert.equal('preloadURL' in preferences, false);
});

test('the element attribute string is whitespace-free with boolean values', () => {
  // Electron splits on `,` without trimming and parses values as JS booleans,
  // so a space or a "no" silently drops or inverts a setting.
  assert.equal(/\s/.test(BROWSER_WEBVIEW_PREFERENCES), false);
  for (const pair of BROWSER_WEBVIEW_PREFERENCES.split(',')) {
    const [key, value] = pair.split('=');
    assert.ok(key.length > 0, pair);
    assert.ok(value === 'true' || value === 'false', pair);
  }
  assert.ok(BROWSER_WEBVIEW_PREFERENCES.includes('contextIsolation=true'));
  assert.ok(BROWSER_WEBVIEW_PREFERENCES.includes('sandbox=true'));
  assert.ok(BROWSER_WEBVIEW_PREFERENCES.includes('nodeIntegration=false'));
});

test('only http and https are navigable', () => {
  assert.equal(isBrowsableUrl('http://localhost:3000'), true);
  assert.equal(isBrowsableUrl('https://example.com/x?y=1'), true);
  assert.equal(isBrowsableUrl('file:///etc/passwd'), false);
  assert.equal(isBrowsableUrl('javascript:alert(1)'), false);
  assert.equal(isBrowsableUrl('atlas://deep/link'), false);
  assert.equal(isBrowsableUrl('not a url'), false);
});

// ---------------------------------------------------------------------------
// The address bar
// ---------------------------------------------------------------------------

test('a bare port is the local dev server', () => {
  assert.equal(normalizeBrowserUrl('3000'), 'http://localhost:3000');
  assert.equal(normalizeBrowserUrl(':5173'), 'http://localhost:5173');
  assert.equal(normalizeBrowserUrl(':5173/app'), 'http://localhost:5173/app');
});

test('loopback defaults to http, everything else to https', () => {
  assert.equal(normalizeBrowserUrl('localhost:5173/app'), 'http://localhost:5173/app');
  assert.equal(normalizeBrowserUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeBrowserUrl('example.com'), 'https://example.com');
});

test('a full URL is left alone', () => {
  assert.equal(normalizeBrowserUrl('http://foo.test/a'), 'http://foo.test/a');
  assert.equal(normalizeBrowserUrl('  https://example.com  '), 'https://example.com');
});

test('the bar is not a search box, so a query is refused rather than sent anywhere', () => {
  assert.equal(normalizeBrowserUrl('how do i fix this'), null);
  assert.equal(normalizeBrowserUrl('notahost'), null);
  assert.equal(normalizeBrowserUrl(''), null);
  assert.equal(normalizeBrowserUrl('   '), null);
});

test('a non-http scheme never becomes a URL the guest could load', () => {
  assert.equal(normalizeBrowserUrl('file:///etc/passwd'), null);
  assert.equal(normalizeBrowserUrl('javascript:alert(1)'), null);
  assert.equal(normalizeBrowserUrl('/etc/passwd'), null);
});

test('a port past the end of the range is not a port', () => {
  assert.equal(normalizeBrowserUrl('99999'), null);
  assert.equal(normalizeBrowserUrl('0'), null);
});

test('the bar shows the address without the noise', () => {
  assert.equal(displayBrowserUrl('http://localhost:3000/'), 'localhost:3000');
  assert.equal(displayBrowserUrl('https://example.com/a/b?c=1'), 'example.com/a/b?c=1');
  assert.equal(displayBrowserUrl('not a url'), 'not a url');
});

// ---------------------------------------------------------------------------
// Port discovery
// ---------------------------------------------------------------------------

const LSOF_OUTPUT = [
  'p501',
  'cnode',
  'n*:5173',
  'n127.0.0.1:24678',
  'p733',
  'cpostgres',
  'n127.0.0.1:5432',
  'p900',
  'cotherhost',
  'n192.168.1.20:9000',
  'p901',
  'cipv6app',
  'n[::1]:8080',
].join('\n');

test('lsof records are stateful: an address belongs to the process above it', () => {
  const listeners = parseLsofListeners(LSOF_OUTPUT);

  // Every loopback listener, including the database: deciding which of them
  // serves a *page* is the probe's job, not the parser's. Keeping that split
  // is what makes the parser testable without a network.
  assert.deepEqual(listeners, [
    { port: 5173, command: 'node' },
    { port: 5432, command: 'postgres' },
    { port: 8080, command: 'ipv6app' },
    { port: 24678, command: 'node' },
  ]);
});

test('a bind on a LAN interface is not something this machine browses', () => {
  const listeners = parseLsofListeners(LSOF_OUTPUT);
  assert.equal(
    listeners.some((listener) => listener.port === 9000),
    false
  );
});

test('privileged ports are left alone', () => {
  const listeners = parseLsofListeners(['p1', 'cwhatever', 'n*:80', 'n*:443'].join('\n'));
  assert.deepEqual(listeners, []);
});

test('the same port on IPv4 and IPv6 is one server', () => {
  const listeners = parseLsofListeners(
    ['p1', 'cvite', 'n127.0.0.1:5173', 'n[::1]:5173'].join('\n')
  );
  assert.deepEqual(listeners, [{ port: 5173, command: 'vite' }]);
});

test('junk in the port table is skipped, not guessed at', () => {
  const listeners = parseLsofListeners(['garbage', 'n', 'n*:notaport', 'p2', 'n*:4000'].join('\n'));
  assert.deepEqual(listeners, [{ port: 4000, command: null }]);
});

// ---------------------------------------------------------------------------
// Tab ids
// ---------------------------------------------------------------------------

test('a new browser tab takes the lowest unused number', () => {
  assert.equal(nextOrdinalResourceId('view', []), 'view-1');
  assert.equal(nextOrdinalResourceId('view', ['view-1']), 'view-2');
  assert.equal(nextOrdinalResourceId('view', ['view-1', 'view-3']), 'view-2');
});

test('only listeners that answer with a page are offered', async () => {
  const probed: string[] = [];
  const discovery = new PortDiscovery(
    () => 0,
    async (url) => {
      probed.push(url);
      return url.includes('5173');
    },
    async () => [
      { port: 5173, command: 'vite' },
      { port: 5432, command: 'postgres' },
    ]
  );

  assert.deepEqual(await discovery.scan(), [
    { url: 'http://localhost:5173', port: 5173, command: 'vite' },
  ]);
  // Probed on the loopback address, so a host where `localhost` resolves to
  // IPv6 only cannot make every IPv4 server look dead.
  assert.deepEqual(probed, ['http://127.0.0.1:5173/', 'http://127.0.0.1:5432/']);
});

test('a second ask inside the cache window does not re-probe', async () => {
  let scans = 0;
  const discovery = new PortDiscovery(
    () => 0,
    async () => true,
    async () => {
      scans += 1;
      return [{ port: 3000, command: null }];
    }
  );

  await discovery.scan();
  await discovery.scan();
  assert.equal(scans, 1);
});

test('well-known dev ports lead, and the ephemeral range comes last', () => {
  const ranked = rankServers([
    { url: 'http://localhost:58608', port: 58608, command: 'opencode' },
    { url: 'http://localhost:8080', port: 8080, command: 'caddy' },
    { url: 'http://localhost:10100', port: 10100, command: 'bun' },
    { url: 'http://localhost:5173', port: 5173, command: 'vite' },
  ]);

  assert.deepEqual(
    ranked.map((server) => server.port),
    [5173, 8080, 10100, 58608]
  );
});

test('a machine holding a dozen ports offers a readable few', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    url: `http://localhost:${50_000 + index}`,
    port: 50_000 + index,
    command: 'opencode',
  }));

  assert.equal(rankServers(many).length, 8);
});
