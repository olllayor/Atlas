/**
 * Rendering a plugin's UI without trusting a byte of it.
 *
 * An MCP server may answer a tool call with a `ui://` resource: markup meant to
 * be shown to the user, written by the same third party that wrote the server.
 * The published architecture makes this the optional fourth plugin shape, and
 * is explicit that tools must stay useful without it — so this module is a
 * display path only. Nothing here can make a tool call, reach the filesystem,
 * or read anything the conversation did not already put on screen.
 *
 * The whole isolation story is three properties, and each is enforced in a
 * different place because any one of them alone is defeatable:
 *
 * 1. **Opaque origin.** The frame carries `sandbox="allow-scripts"` and
 *    deliberately not `allow-same-origin`, so the document cannot reach the
 *    renderer's DOM, storage, or `'self'`.
 * 2. **A policy the widget cannot edit.** The CSP arrives as a response header
 *    on the `atlas-widget:` scheme. This is why the markup is served rather
 *    than inlined with `srcdoc`: a `srcdoc` document *inherits* the embedding
 *    page's CSP, and Atlas's renderer policy allows `http://localhost:*` and
 *    the analytics host. A hostile widget that simply omitted its own `<meta>`
 *    policy would inherit those. A header cannot be omitted by its content.
 * 3. **A closed message vocabulary.** Three message types, each validated for
 *    shape and for a per-frame token, and none of them executes anything.
 *
 * Kept free of Electron and React imports so both sides and the tests can read
 * the same definitions.
 */

/** Its own scheme, for the same reason plugin icons have one: to avoid widening the app's CSP. */
export const MCP_UI_SCHEME = 'atlas-widget';

/** The URI prefix that marks an embedded resource as a UI component. */
export const MCP_UI_URI_PREFIX = 'ui://';

/**
 * Frame height bounds, in CSS pixels.
 *
 * A widget asks for its own height, which means the number is attacker-chosen:
 * unclamped, `resize` is a way to push the rest of the transcript off screen or
 * to hang the layout with a ten-million-pixel frame.
 */
export const MCP_UI_MIN_HEIGHT = 80;
export const MCP_UI_MAX_HEIGHT = 600;

/** A widget that has not spoken by now is treated as broken rather than waited on forever. */
export const MCP_UI_READY_TIMEOUT_MS = 5_000;

/** Ceiling on served markup. A UI component is a card, not an application bundle. */
export const MCP_UI_MAX_HTML_BYTES = 512 * 1024;

/** Ceiling on a `submit` payload, so the channel cannot be used as a bulk transport. */
export const MCP_UI_MAX_SUBMIT_CHARS = 200;

export function isMcpUiResourceUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.startsWith(MCP_UI_URI_PREFIX);
}

/**
 * Everything a widget is allowed to say.
 *
 * Not a general RPC. `ready` reports that the frame booted, `resize` asks for
 * room, and `submit` hands the host a short string. None of the three names a
 * tool, a file, or a URL, which is the property that makes the host's job
 * possible: there is no message whose *contents* decide what runs.
 */
export type McpUiMessage =
  | { type: 'ready'; token: string }
  | { type: 'resize'; token: string; height: number }
  | { type: 'submit'; token: string; value: string };

/**
 * Whether an arbitrary `MessageEvent.data` is a message this host handles.
 *
 * The token is checked here rather than by the caller so there is exactly one
 * place a message can be admitted from. It is not a secret — the widget is told
 * it, and an opaque-origin frame can read its own URL anyway — it exists so a
 * *different* window cannot post into the same handler and be taken for this
 * frame. `event.source` is the primary check; the token is what survives if a
 * future refactor loses the source comparison.
 */
export function isMcpUiMessage(value: unknown, token: string): value is McpUiMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;

  // An empty expected token would make every message with a missing token
  // valid, which is exactly backwards. Refuse rather than degrade.
  if (!token || message.token !== token) {
    return false;
  }

  switch (message.type) {
    case 'ready':
      return true;
    case 'resize':
      return typeof message.height === 'number' && Number.isFinite(message.height);
    case 'submit':
      return typeof message.value === 'string' && message.value.length <= MCP_UI_MAX_SUBMIT_CHARS;
    default:
      return false;
  }
}

export function clampWidgetHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return MCP_UI_MIN_HEIGHT;
  }

  return Math.min(Math.max(Math.round(height), MCP_UI_MIN_HEIGHT), MCP_UI_MAX_HEIGHT);
}

/**
 * The policy served with every widget.
 *
 * `default-src 'none'` is the whole point: no fetch, no XHR, no websocket, no
 * remote script, style, font, or frame. `'unsafe-inline'` for script and style
 * is not a concession — the frame has an opaque origin and no network, so the
 * only code it can run is the markup it was already served, and forbidding
 * inline would just mean forbidding widgets.
 *
 * `sandbox` is repeated here as a header directive as well as on the element.
 * The element attribute is set by the renderer and the header by the main
 * process, so neither one being edited alone drops the guarantee.
 */
export function buildWidgetCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    // Inline artwork only. No host is reachable, so this cannot become a beacon.
    'img-src data:',
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    'sandbox allow-scripts'
  ].join('; ');
}

/** Where the renderer points a frame for one tool call. */
export function mcpWidgetUrl(toolCallId: string, token: string): string {
  return `${MCP_UI_SCHEME}://widget/${encodeURIComponent(toolCallId)}?token=${encodeURIComponent(token)}`;
}

/** What the renderer is told about a finished tool call that produced a component. */
export type McpUiDescriptor = {
  toolCallId: string;
  /** The component's own `ui://` name, shown to the user so the frame is attributable. */
  uri: string;
  /** The server the component came from, as the approval ladder names it. */
  serverName: string;
};

/**
 * The shim injected above every widget.
 *
 * Two reasons it exists rather than letting widgets call `postMessage`
 * directly. It keeps the token out of widget source — an author writes
 * `atlas.resize(200)` and never handles, stores, or can forget to send it. And
 * it means the wire format is Atlas's to change: today's three messages can
 * become the MCP Apps vocabulary without every installed bundle rewriting.
 *
 * Frozen, and captured before widget code runs, so a widget cannot replace the
 * shim and hand a *different* widget on the page a forged sender. There is only
 * ever one widget per frame, but the frame is the boundary being relied on and
 * this costs a line.
 */
export function buildWidgetBootstrap(token: string): string {
  return `(function () {
  var token = ${JSON.stringify(token)};
  var send = window.parent.postMessage.bind(window.parent);
  function post(message) { message.token = token; send(message, '*'); }
  window.atlas = Object.freeze({
    ready: function () { post({ type: 'ready' }); },
    resize: function (height) { post({ type: 'resize', height: Number(height) || 0 }); },
    submit: function (value) { post({ type: 'submit', value: String(value).slice(0, ${MCP_UI_MAX_SUBMIT_CHARS}) }); }
  });
  window.addEventListener('DOMContentLoaded', function () { window.atlas.ready(); });
})();`;
}

/**
 * The document actually served for a widget.
 *
 * The widget's markup is placed in the body verbatim — it is not sanitised,
 * because sanitising is the wrong boundary here and pretending otherwise would
 * invite trusting it. The frame is the boundary: with no origin, no network and
 * no parent access, arbitrary markup is arbitrary markup inside a box.
 */
export function buildWidgetDocument(html: string, token: string): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    // Repeated from the header for the same belt-and-braces reason as `sandbox`.
    `<meta http-equiv="Content-Security-Policy" content="${buildWidgetCsp().replace(/"/g, '&quot;')}">`,
    '<style>html,body{margin:0;padding:0;font:13px/1.5 system-ui,sans-serif;color-scheme:light dark}</style>',
    `<script>${buildWidgetBootstrap(token)}</script>`,
    '</head><body>',
    html,
    '</body></html>'
  ].join('\n');
}
