import assert from 'node:assert/strict';
import test from 'node:test';

import { McpUiStore } from '../src/main/ai/mcp/McpUiStore.js';
import {
  MCP_UI_MAX_HEIGHT,
  MCP_UI_MAX_HTML_BYTES,
  MCP_UI_MAX_SUBMIT_CHARS,
  MCP_UI_MIN_HEIGHT,
  buildWidgetCsp,
  buildWidgetDocument,
  clampWidgetHeight,
  isMcpUiMessage,
  isMcpUiResourceUri,
  mcpWidgetUrl
} from '../src/shared/mcpUi.js';

const TOKEN = 'tok-abc';

/* ------------------------------------------------------------------ *
 * The message vocabulary. Everything a widget can say to the host.
 * ------------------------------------------------------------------ */

test('the three known messages are accepted when the token matches', () => {
  assert.ok(isMcpUiMessage({ type: 'ready', token: TOKEN }, TOKEN));
  assert.ok(isMcpUiMessage({ type: 'resize', token: TOKEN, height: 240 }, TOKEN));
  assert.ok(isMcpUiMessage({ type: 'submit', token: TOKEN, value: 'hello' }, TOKEN));
});

test('a message from another frame cannot pass as this one', () => {
  assert.equal(isMcpUiMessage({ type: 'ready', token: 'other' }, TOKEN), false);
  assert.equal(isMcpUiMessage({ type: 'ready' }, TOKEN), false);
});

test('an empty expected token rejects everything rather than accepting everything', () => {
  // The failure mode this guards: a caller that has not generated a token yet
  // would otherwise match every message carrying no token at all.
  assert.equal(isMcpUiMessage({ type: 'ready', token: '' }, ''), false);
  assert.equal(isMcpUiMessage({ type: 'ready' }, ''), false);
});

test('unknown message types are ignored, not passed through', () => {
  assert.equal(isMcpUiMessage({ type: 'callTool', token: TOKEN, name: 'rm' }, TOKEN), false);
  assert.equal(isMcpUiMessage({ type: 'navigate', token: TOKEN, url: 'https://evil' }, TOKEN), false);
  assert.equal(isMcpUiMessage({ token: TOKEN }, TOKEN), false);
});

test('malformed payloads for known types are rejected', () => {
  assert.equal(isMcpUiMessage({ type: 'resize', token: TOKEN, height: '400' }, TOKEN), false);
  assert.equal(isMcpUiMessage({ type: 'resize', token: TOKEN, height: Number.NaN }, TOKEN), false);
  assert.equal(isMcpUiMessage({ type: 'resize', token: TOKEN, height: Infinity }, TOKEN), false);
  assert.equal(isMcpUiMessage({ type: 'submit', token: TOKEN, value: 42 }, TOKEN), false);
  assert.equal(
    isMcpUiMessage({ type: 'submit', token: TOKEN, value: 'x'.repeat(MCP_UI_MAX_SUBMIT_CHARS + 1) }, TOKEN),
    false,
    'submit is not a bulk transport'
  );
});

test('non-objects are not messages', () => {
  for (const value of [null, undefined, 'ready', 42, ['ready']]) {
    assert.equal(isMcpUiMessage(value, TOKEN), false);
  }
});

test('a widget cannot choose its own height', () => {
  assert.equal(clampWidgetHeight(1), MCP_UI_MIN_HEIGHT);
  assert.equal(clampWidgetHeight(-9_000), MCP_UI_MIN_HEIGHT);
  assert.equal(clampWidgetHeight(10_000_000), MCP_UI_MAX_HEIGHT);
  assert.equal(clampWidgetHeight(Number.NaN), MCP_UI_MIN_HEIGHT);
  assert.equal(clampWidgetHeight(240), 240);
});

/* ------------------------------------------------------------------ *
 * The policy. This is the half a `srcdoc` frame could not guarantee.
 * ------------------------------------------------------------------ */

test('the widget policy denies every network destination', () => {
  const csp = buildWidgetCsp();

  assert.match(csp, /default-src 'none'/);
  assert.equal(csp.includes('connect-src'), false, "nothing may re-open what default-src 'none' closed");
  assert.match(csp, /sandbox allow-scripts/);
  assert.equal(csp.includes('allow-same-origin'), false, 'an origin is the one thing a widget must not have');
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /frame-src 'none'/, 'a widget may not embed a frame of its own');
  assert.match(csp, /object-src 'none'/);
  // Inline artwork is allowed; a remote host would make img-src a beacon.
  assert.match(csp, /img-src data:/);
  assert.equal(/img-src[^;]*https?:/.test(csp), false);
});

test('the served document carries the policy and the shim, ahead of widget markup', () => {
  const document = buildWidgetDocument('<button id="go">Go</button>', TOKEN);

  assert.match(document, /Content-Security-Policy/);
  assert.match(document, /<button id="go">Go<\/button>/, 'the markup is served as written');
  assert.ok(
    document.indexOf('window.atlas') < document.indexOf('<button'),
    'the shim is installed before any widget code can run'
  );
  assert.match(document, /Object\.freeze/, 'so widget code cannot replace the sender');
  assert.match(document, /tok-abc/, 'the token is injected, not left to the widget to supply');
});

test('the widget URL names the call and carries the token', () => {
  const url = mcpWidgetUrl('call-1', TOKEN);

  assert.match(url, /^atlas-widget:\/\/widget\/call-1\?token=tok-abc$/);
  assert.match(mcpWidgetUrl('a/b?c', 't&t'), /^atlas-widget:\/\/widget\/a%2Fb%3Fc\?token=t%26t$/);
});

test('only ui:// resources are treated as components', () => {
  assert.ok(isMcpUiResourceUri('ui://demo/hello'));
  assert.equal(isMcpUiResourceUri('file:///etc/passwd'), false);
  assert.equal(isMcpUiResourceUri('https://example.com'), false);
  assert.equal(isMcpUiResourceUri(undefined), false);
});

/* ------------------------------------------------------------------ *
 * The store. Bounded, keyed by call, and never the model's problem.
 * ------------------------------------------------------------------ */

test('a component is kept under the call that produced it', () => {
  const store = new McpUiStore();

  assert.ok(store.put({ toolCallId: 'c1', uri: 'ui://demo', serverName: 'demo', html: '<p>hi</p>' }));
  assert.equal(store.get('c1')?.html, '<p>hi</p>');
  assert.deepEqual(store.describe('c1'), { toolCallId: 'c1', uri: 'ui://demo', serverName: 'demo' });
});

test('the renderer is described the component but never handed its markup', () => {
  const store = new McpUiStore();
  store.put({ toolCallId: 'c1', uri: 'ui://demo', serverName: 'demo', html: '<script>evil()</script>' });

  assert.equal(JSON.stringify(store.describe('c1')).includes('script'), false);
});

test('two calls to the same tool are two components, not one overwriting the other', () => {
  const store = new McpUiStore();
  store.put({ toolCallId: 'c1', uri: 'ui://demo', serverName: 'demo', html: '<p>first</p>' });
  store.put({ toolCallId: 'c2', uri: 'ui://demo', serverName: 'demo', html: '<p>second</p>' });

  assert.equal(store.get('c1')?.html, '<p>first</p>');
  assert.equal(store.get('c2')?.html, '<p>second</p>');
});

test('an oversized or empty component is refused rather than stored', () => {
  const store = new McpUiStore();

  assert.equal(
    store.put({
      toolCallId: 'big',
      uri: 'ui://demo',
      serverName: 'demo',
      html: 'x'.repeat(MCP_UI_MAX_HTML_BYTES + 1)
    }),
    false
  );
  assert.equal(store.put({ toolCallId: 'empty', uri: 'ui://demo', serverName: 'demo', html: '  ' }), false);
  assert.equal(store.size, 0);
});

test('the store is bounded, and the oldest component is the one that goes', () => {
  const store = new McpUiStore();

  for (let index = 0; index < 200; index += 1) {
    store.put({ toolCallId: `c${index}`, uri: 'ui://demo', serverName: 'demo', html: '<p>x</p>' });
  }

  assert.ok(store.size <= 64, `store grew to ${store.size}`);
  assert.equal(store.get('c0'), null, 'the first is gone');
  assert.ok(store.get('c199'), 'the most recent is kept');
});

test('an unknown call describes as nothing rather than throwing', () => {
  assert.equal(new McpUiStore().describe('never-happened'), null);
});
