/**
 * A plugin's UI component, in a box it cannot get out of.
 *
 * The frame carries `sandbox="allow-scripts"` and deliberately not
 * `allow-same-origin`, which gives the document an opaque origin: no access to
 * this renderer's DOM, storage, cookies, or `'self'`. Its markup arrives over
 * the `atlas-widget:` scheme with a CSP response header the widget cannot edit
 * (see `mcpUiProtocol.ts` for why that beats `srcdoc`), so it has no network of
 * any kind.
 *
 * That leaves exactly one channel out — `postMessage` — and this component is
 * the only thing listening. Three message types, validated for shape and for a
 * per-frame token, none of which names anything executable. In particular a
 * widget cannot call an MCP tool: `submit` hands the host a short string and
 * the host decides, in code, what if anything that means. The moment a message
 * body starts choosing what runs, the sandbox stops being worth having.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  MCP_UI_MAX_HEIGHT,
  MCP_UI_MIN_HEIGHT,
  MCP_UI_READY_TIMEOUT_MS,
  type McpUiDescriptor,
  clampWidgetHeight,
  isMcpUiMessage,
  mcpWidgetUrl
} from '../../../shared/mcpUi';
import { cn } from '../../lib/utils';

type McpUiFrameProps = {
  descriptor: McpUiDescriptor;
};

export function McpUiFrame({ descriptor }: McpUiFrameProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(MCP_UI_MIN_HEIGHT);
  const [failed, setFailed] = useState(false);

  // One token per mounted frame. Not a secret — the widget is handed it, and an
  // opaque-origin document can read its own URL regardless. It exists so that
  // some *other* window posting into this renderer cannot be mistaken for this
  // frame. Regenerated per tool call id so a re-rendered card cannot be spoofed
  // with a token scraped from an earlier one.
  const token = useMemo(() => crypto.randomUUID(), [descriptor.toolCallId]);
  const src = useMemo(() => mcpWidgetUrl(descriptor.toolCallId, token), [descriptor.toolCallId, token]);

  useEffect(() => {
    // The virtualizer unmounts transcript rows that scroll out of view, and an
    // in-flight message arriving after that would set state on a dead
    // component. Cheaper to ignore it than to reason about when it can happen.
    let mounted = true;
    let ready = false;

    const timer = setTimeout(() => {
      if (mounted && !ready) {
        setFailed(true);
      }
    }, MCP_UI_READY_TIMEOUT_MS);

    function onMessage(event: MessageEvent) {
      if (!mounted) {
        return;
      }

      // The primary check. `event.source` is set by the browser and cannot be
      // forged by the sender, so this alone establishes which frame spoke.
      // Comparing `event.origin` to the string "null" was considered and
      // dropped: opaque-origin serialisation is not something to depend on.
      if (event.source !== frame.current?.contentWindow) {
        return;
      }

      if (!isMcpUiMessage(event.data, token)) {
        return;
      }

      switch (event.data.type) {
        case 'ready':
          ready = true;
          clearTimeout(timer);
          break;

        case 'resize':
          // Clamped, always. The number is chosen by the widget, and unbounded
          // it is a way to push the rest of the conversation off screen.
          setHeight(clampWidgetHeight(event.data.height));
          break;

        case 'submit':
          // Deliberately inert. Wiring this to `callTool` is the next piece of
          // work and it needs the host to decide the tool and validate every
          // argument — never the widget's string deciding either.
          console.info('[mcp-ui] widget submitted', {
            uri: descriptor.uri,
            server: descriptor.serverName,
            value: event.data.value
          });
          break;
      }
    }

    window.addEventListener('message', onMessage);

    return () => {
      mounted = false;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [descriptor.serverName, descriptor.uri, token]);

  return (
    <div className="my-2">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-text-tertiary">
        {/* Attribution, always. A card rendered inside the transcript looks like
            the app said it, and the user is entitled to know which server drew it. */}
        <span className="truncate" title={descriptor.uri}>
          {descriptor.serverName}
        </span>
        <span aria-hidden>·</span>
        <span>plugin UI</span>
      </div>

      {failed ? (
        <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-text-tertiary">
          This component did not load. The tool&apos;s text result is still above.
        </div>
      ) : null}

      <iframe
        ref={frame}
        src={src}
        title={`UI component from ${descriptor.serverName}`}
        // The whole isolation model in one attribute. `allow-same-origin` is
        // absent on purpose: adding it would hand the widget this renderer's
        // origin, and with it storage, cookies and same-origin DOM access.
        sandbox="allow-scripts"
        // Belt and braces with the CSP: no camera, mic, geolocation, payment,
        // clipboard, or anything else a widget could ask the user for.
        allow=""
        referrerPolicy="no-referrer"
        loading="lazy"
        className={cn(
          'block w-full rounded-md border border-border-subtle bg-surface-raised',
          failed && 'hidden'
        )}
        style={{ height, maxHeight: MCP_UI_MAX_HEIGHT }}
      />
    </div>
  );
}
