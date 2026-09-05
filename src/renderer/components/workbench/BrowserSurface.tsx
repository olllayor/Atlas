/**
 * The Browser surface: a real Chromium guest, beside the transcript.
 *
 * Mostly here for the loop the app already implies — the agent starts a dev
 * server, you look at it without leaving the window. Everything the guest is
 * allowed to do is decided in main (`main/browser/webviewSecurity.ts`); this
 * file only draws the chrome around it and remembers where it was pointed.
 *
 * The address bar is not a search box. What gets typed into a coding tool is
 * as likely to be a path or a secret as a query, and sending that to a search
 * engine on a typo is not a trade worth making — `normalizeBrowserUrl`
 * returns null and the bar says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw } from 'lucide-react';

import type { DiscoveredServer } from '../../../shared/browser';
import {
  BROWSER_PARTITION,
  BROWSER_WEBVIEW_PREFERENCES,
  displayBrowserUrl,
  normalizeBrowserUrl,
} from '../../../shared/browser';
import { cn } from '../../lib/utils';
import { useBrowserStore, useBrowserView } from '../../stores/useBrowserStore';

export type BrowserSurfaceProps = {
  /** Identifies this tab's guest, so two browser tabs never share a page. */
  viewId: string;
};

export function BrowserSurface({ viewId }: BrowserSurfaceProps) {
  const view = useBrowserView(viewId);
  const navigate = useBrowserStore((state) => state.navigate);
  const setTitle = useBrowserStore((state) => state.setTitle);

  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [draft, setDraft] = useState(view.url ? displayBrowserUrl(view.url) : '');
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [history, setHistory] = useState({ canGoBack: false, canGoForward: false });

  // The address bar follows the page while the user is not editing it. A
  // redirect the page performed is the truth about where the tab is.
  useEffect(() => {
    setDraft(view.url ? displayBrowserUrl(view.url) : '');
  }, [view.url]);

  const submit = useCallback(() => {
    const url = normalizeBrowserUrl(draft);
    if (!url) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFailure(null);
    navigate(viewId, url);
  }, [draft, navigate, viewId]);

  useEffect(() => {
    const guest = webviewRef.current;
    if (!guest) return;

    const syncHistory = () => {
      setHistory({ canGoBack: guest.canGoBack(), canGoForward: guest.canGoForward() });
    };
    const onNavigated = (event: Electron.DidNavigateEvent) => {
      navigate(viewId, event.url);
      syncHistory();
    };
    const onInPageNavigated = (event: Electron.DidNavigateInPageEvent) => {
      if (!event.isMainFrame) return;
      navigate(viewId, event.url);
      syncHistory();
    };
    const onTitle = (event: Electron.PageTitleUpdatedEvent) => setTitle(viewId, event.title);
    const onStart = () => {
      setLoading(true);
      setFailure(null);
    };
    const onStop = () => {
      setLoading(false);
      syncHistory();
    };
    const onFail = (event: Electron.DidFailLoadEvent) => {
      // -3 is ERR_ABORTED, which is what a navigation the user replaced
      // reports. Showing an error for it would flash on every fast retype.
      if (!event.isMainFrame || event.errorCode === -3) return;
      setLoading(false);
      setFailure(event.errorDescription || 'That page could not be loaded.');
    };

    guest.addEventListener('did-navigate', onNavigated);
    guest.addEventListener('did-navigate-in-page', onInPageNavigated);
    guest.addEventListener('page-title-updated', onTitle);
    guest.addEventListener('did-start-loading', onStart);
    guest.addEventListener('did-stop-loading', onStop);
    guest.addEventListener('did-fail-load', onFail);

    return () => {
      guest.removeEventListener('did-navigate', onNavigated);
      guest.removeEventListener('did-navigate-in-page', onInPageNavigated);
      guest.removeEventListener('page-title-updated', onTitle);
      guest.removeEventListener('did-start-loading', onStart);
      guest.removeEventListener('did-stop-loading', onStop);
      guest.removeEventListener('did-fail-load', onFail);
    };
  }, [navigate, setTitle, viewId, view.url]);

  if (!view.url) {
    return (
      <BrowserEmptyState
        draft={draft}
        invalid={invalid}
        onDraftChange={(value) => {
          setDraft(value);
          setInvalid(false);
        }}
        onSubmit={submit}
        onOpen={(url) => navigate(viewId, url)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
        <NavButton
          label="Back"
          disabled={!history.canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
        </NavButton>
        <NavButton
          label="Forward"
          disabled={!history.canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight className="size-3.5" aria-hidden />
        </NavButton>
        <NavButton label="Reload" onClick={() => webviewRef.current?.reload()}>
          <RotateCw className={cn('size-3.5', loading && 'opacity-40')} aria-hidden />
        </NavButton>

        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              setDraft(view.url ? displayBrowserUrl(view.url) : '');
              setInvalid(false);
            }
          }}
          spellCheck={false}
          aria-label="Address"
          aria-invalid={invalid || undefined}
          className={cn(
            'min-w-0 flex-1 rounded-md border bg-bg-surface px-2 py-1 font-mono text-xs text-text-primary outline-none',
            invalid ? 'border-error' : 'border-border-subtle focus:border-border-strong'
          )}
        />

        <NavButton
          label="Open in browser"
          onClick={() => {
            if (view.url) void window.atlasChat.browser.openExternal(view.url).catch(() => {});
          }}
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </NavButton>
      </div>

      {failure ? (
        <p className="shrink-0 px-3 pb-1 text-xs text-error" role="status">
          {failure}
        </p>
      ) : null}

      {/* No backdrop of its own: the guest paints the page, and anything
          underneath is only visible for the frame before it does. */}
      <div className="min-h-0 flex-1">
        {/*
          `key` on the URL is deliberate: pointing an existing guest at a new
          address by mutating `src` leaves its back/forward history attached to
          the previous page, so a typed URL and a clicked link would behave
          differently. A fresh guest per typed address keeps that honest.
        */}
        <webview
          key={view.url}
          ref={(node) => {
            // React types `<webview>` as `HTMLWebViewElement`, a stub with no
            // members. The element Electron actually creates is `WebviewTag`,
            // which is where `goBack`, `reload` and the rest live.
            webviewRef.current = node as Electron.WebviewTag | null;
          }}
          src={view.url}
          partition={BROWSER_PARTITION}
          webpreferences={BROWSER_WEBVIEW_PREFERENCES}
          style={{ width: '100%', height: '100%', display: 'flex' }}
        />
      </div>
    </div>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * What a browser tab shows before it has an address: the servers running on
 * this machine right now, and a box for anything else.
 */
function BrowserEmptyState({
  draft,
  invalid,
  onDraftChange,
  onSubmit,
  onOpen,
}: {
  draft: string;
  invalid: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onOpen: (url: string) => void;
}) {
  const [servers, setServers] = useState<DiscoveredServer[] | null>(null);

  useEffect(() => {
    let disposed = false;
    void window.atlasChat.browser
      .discoverServers()
      .then((found) => {
        if (!disposed) setServers(found);
      })
      .catch(() => {
        if (!disposed) setServers([]);
      });

    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <h3 className="text-center text-base text-text-primary">Open a local app or URL</h3>

        <input
          value={draft}
          autoFocus
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onSubmit();
          }}
          spellCheck={false}
          placeholder="localhost:3000"
          aria-label="Address"
          aria-invalid={invalid || undefined}
          className={cn(
            'mt-3 w-full rounded-md border bg-bg-surface px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none placeholder:text-text-faint',
            invalid ? 'border-error' : 'border-border-subtle focus:border-border-strong'
          )}
        />
        {invalid ? (
          <p className="pt-1 text-xs text-error">
            That is not a URL. Try a port, a host, or a full address.
          </p>
        ) : null}

        {servers === null ? (
          <p className="pt-4 text-center text-xs text-text-faint">Looking for local servers</p>
        ) : servers.length === 0 ? (
          <p className="pt-4 text-center text-xs text-text-faint">
            Nothing is serving a page on this machine right now.
          </p>
        ) : (
          <ul className="pt-4">
            {servers.map((server) => (
              <li key={server.port}>
                <button
                  type="button"
                  onClick={() => onOpen(server.url)}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
                >
                  <span className="font-mono text-xs text-text-primary">
                    localhost:{server.port}
                  </span>
                  {server.command ? (
                    <span className="truncate text-xs text-text-faint">{server.command}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
