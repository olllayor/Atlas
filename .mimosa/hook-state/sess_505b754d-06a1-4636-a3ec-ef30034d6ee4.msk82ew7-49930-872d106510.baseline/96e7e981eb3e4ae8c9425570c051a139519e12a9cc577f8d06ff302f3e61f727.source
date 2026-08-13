import { protocol } from 'electron/main';

import { MCP_UI_SCHEME, buildWidgetCsp, buildWidgetDocument } from '../../../shared/mcpUi';
import type { McpUiStore } from './McpUiStore';

/**
 * Serving a plugin's UI component to the renderer.
 *
 * The alternative was `srcdoc`, and it is worth writing down why it was
 * rejected: a `srcdoc` document inherits the *embedding page's* CSP. Atlas's
 * renderer policy has to allow `http://localhost:*`, `blob:` and the analytics
 * host for the app's own sake, and a widget that simply left out its own
 * `<meta>` policy would inherit all three. Since the widget author writes the
 * markup, "the widget declares its own restrictions" is not a security control
 * at all.
 *
 * Served from a scheme instead, the policy is a response header written here,
 * in a process the widget has no reach into. It cannot be omitted, overridden
 * or negotiated by its own content. The scheme also gives the frame a real
 * origin distinct from the app's, which is what makes the renderer's
 * `event.source` check mean something.
 */

export function registerMcpUiScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MCP_UI_SCHEME,
      privileges: {
        standard: true,
        // "Secure" in the sense that powerful-feature gating treats it as a
        // trustworthy origin. It grants nothing on its own: the CSP below still
        // denies every network destination, and the frame is sandboxed.
        secure: true,
        supportFetchAPI: false,
        // No CORS allowance and no stream support. A widget has nothing to
        // fetch — `default-src 'none'` sees to that — so neither is needed, and
        // both would be surface.
        corsEnabled: false
      }
    }
  ]);
}

export function registerMcpUiProtocolHandler(store: McpUiStore): void {
  protocol.handle(MCP_UI_SCHEME, (request) => {
    let url: URL;

    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad widget URL', { status: 400, headers: refuse() });
    }

    // Only ever a GET of a document. A widget has no API here to reach.
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: refuse() });
    }

    const toolCallId = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const token = url.searchParams.get('token') ?? '';
    const entry = toolCallId ? store.get(toolCallId) : null;

    // One answer for "no such call", "expired" and "malformed". The difference
    // tells a caller nothing it needs and an attacker something it wants.
    if (!entry || !token) {
      return new Response('Not found', { status: 404, headers: refuse() });
    }

    return new Response(buildWidgetDocument(entry.html, token), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': buildWidgetCsp(),
        // The token is per-frame and the markup can change under the same call
        // id when a server re-renders, so nothing here is cacheable.
        'Cache-Control': 'no-store',
        // Belt and braces against a response ever being sniffed as something
        // with different execution rules than the type says.
        'X-Content-Type-Options': 'nosniff'
      }
    });
  });
}

/**
 * Headers for a refusal.
 *
 * An error body is still a document the frame will parse, so it gets the same
 * policy as a real one — a 404 is not an excuse to serve something unpoliced.
 */
function refuse(): Record<string, string> {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Security-Policy': buildWidgetCsp(),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}
