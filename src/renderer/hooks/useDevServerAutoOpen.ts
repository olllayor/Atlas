/**
 * Closes the agent → browser loop the panel already promises.
 *
 * `WorkbenchPanel` says the browser exists so "the agent starts a dev
 * server, you look at it without leaving the window" — but nothing watched
 * for that server. The user had to notice terminal output, open the panel,
 * land on the picker, press B, wait for discovery, and click the port.
 *
 * This hook is the browser equivalent of App's agents auto-open (0 → N
 * running agents opens `agents`): it polls `browser.discoverServers` for the
 * selected conversation, treats the first scan as a baseline, and when a
 * *newly* serving port appears after an agent has run, it opens a Browser
 * surface on it with a quiet toast/undo.
 *
 * Deliberate limits, so a convenience never becomes a hijack:
 * - baseline first: a server already running when the conversation opens or
 *   when watching starts never auto-opens. Only arrivals count.
 * - agents first: a new port only qualifies when this conversation has had a
 *   running agent since watching started. A background tool binding a port
 *   while the user types elsewhere is not the preview loop.
 * - once per port: each `conversation:port` auto-opens at most once, even if
 *   the server restarts. Undo is the way back, not a re-trigger.
 * - already there wins: when a browser tab already points at the port, the
 *   surface is activated without a toast rather than opening a duplicate.
 * - empty reuse: an empty browser tab is pointed rather than left beside a
 *   second tab showing the same server. Undo restores its emptiness.
 */

import { useEffect, useRef } from 'react';

import type { DiscoveredServer } from '../../shared/browser';
import {
  nextOrdinalResourceId,
  surfaceResourceId,
  type SurfaceId,
} from '../components/workbench/rightPanelModel';
import { notify } from '../lib/notify';
import { useBrowserStore } from '../stores/useBrowserStore';
import { useRightPanelStore } from '../stores/useRightPanelStore';

/**
 * How often a watched conversation re-asks main what serves a page. Just over
 * `PortDiscovery`'s 5s cache so each tick gets a fresh answer without
 * hammering `lsof` and the probe pool between ticks.
 */
export const DEV_SERVER_POLL_MS = 7_000;

/** Browser view state is keyed by conversation *and* view, mirroring WorkbenchPanel. */
export function browserViewKey(conversationId: string, viewId: string): string {
  return `${conversationId}:${viewId}`;
}

export function autoOpenedKey(conversationId: string, port: number): string {
  return `${conversationId}:${port}`;
}

/**
 * Ports in `servers` the watcher has not seen yet. A null baseline means
 * "first scan for this conversation" — it establishes what is already there
 * and opens nothing, so a long-running server never ambushes the panel.
 */
export function findNewServers(
  knownPorts: Set<number> | null,
  servers: readonly DiscoveredServer[]
): DiscoveredServer[] {
  if (knownPorts === null) return [];
  return servers.filter((server) => !knownPorts.has(server.port));
}

function viewPort(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const port = Number(new URL(url).port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Every `conversation:port` the watcher has already handled, across remounts.
 * Module-level so switching conversations and coming back never re-fires for
 * the same server — the toast's Undo is the way back, not a second toast.
 */
const autoOpenedPorts = new Set<string>();

/** Test seam: resets the once-per-port memory. */
export function resetDevServerAutoOpened(): void {
  autoOpenedPorts.clear();
}

export function useDevServerAutoOpen(
  conversationId: string | null | undefined,
  runningAgentsCount: number
): void {
  const baselineConvRef = useRef<string | null>(null);
  const knownPortsRef = useRef<Set<number> | null>(null);
  const hasSeenAgentsRef = useRef(false);
  const scanningRef = useRef(false);

  useEffect(() => {
    if (!conversationId) return;

    // A new conversation is a new baseline: what serves already is context,
    // not an arrival, and agent history does not carry across threads.
    if (baselineConvRef.current !== conversationId) {
      baselineConvRef.current = conversationId;
      knownPortsRef.current = null;
      hasSeenAgentsRef.current = false;
    }
    if (runningAgentsCount > 0) hasSeenAgentsRef.current = true;

    const convId = conversationId;
    let disposed = false;

    const scanOnce = async () => {
      if (disposed || (typeof document !== 'undefined' && document.hidden)) return;
      if (scanningRef.current) return;
      const discover = window.atlasChat?.browser?.discoverServers;
      if (!discover) return;

      scanningRef.current = true;
      try {
        const servers = await discover();
        if (disposed || baselineConvRef.current !== convId) return;

        const known = knownPortsRef.current;
        if (known === null) {
          knownPortsRef.current = new Set(servers.map((server) => server.port));
          return;
        }

        const fresh = findNewServers(known, servers).filter(
          (server) => !autoOpenedPorts.has(autoOpenedKey(convId, server.port))
        );
        knownPortsRef.current = new Set(servers.map((server) => server.port));
        if (fresh.length === 0 || !hasSeenAgentsRef.current) return;

        // `scan()` returns ranked output, so the first arrival is the one the
        // empty state would have offered first.
        autoOpenBrowser(convId, fresh[0]);
      } catch {
        // Discovery is best-effort by contract (empty means none found, not
        // failure). A failed tick leaves the baseline alone; the next one
        // retries without ever opening on stale data.
      } finally {
        scanningRef.current = false;
      }
    };

    void scanOnce();
    const timer = setInterval(() => {
      void scanOnce();
    }, DEV_SERVER_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [conversationId, runningAgentsCount]);
}

/**
 * Points a Browser surface at a newly arrived server, reusing an empty tab
 * when one exists. The toast names the port and offers the way back; the
 * open itself follows `openSurface` semantics (panel opens, tab activates).
 */
function autoOpenBrowser(conversationId: string, server: DiscoveredServer): void {
  const rightPanel = useRightPanelStore.getState();
  const browser = useBrowserStore.getState();

  const panel = rightPanel.byConversationId[conversationId];
  const surfaces = panel?.surfaces ?? [];
  const previousActiveId = panel?.activeSurfaceId ?? null;

  // Already showing this port somewhere: bring that tab forward, no toast.
  // Marked handled either way — the user is already looking at it, so a
  // restart of the same port must not nag them with a duplicate tab.
  for (const surface of surfaces) {
    if (surface.kind !== 'browser') continue;
    const viewId = surfaceResourceId(surface);
    if (!viewId) continue;
    if (viewPort(browser.byViewId[browserViewKey(conversationId, viewId)]?.url) === server.port) {
      if (surface.id !== previousActiveId) rightPanel.activateSurface(conversationId, surface.id);
      autoOpenedPorts.add(autoOpenedKey(conversationId, server.port));
      return;
    }
  }

  const emptySurface = surfaces.find((surface) => {
    if (surface.kind !== 'browser') return false;
    const viewId = surfaceResourceId(surface);
    if (!viewId) return false;
    return !browser.byViewId[browserViewKey(conversationId, viewId)]?.url;
  });

  if (emptySurface) {
    const viewId = surfaceResourceId(emptySurface) ?? 'view-1';
    const key = browserViewKey(conversationId, viewId);
    browser.navigate(key, server.url);
    rightPanel.activateSurface(conversationId, emptySurface.id);
    autoOpenedPorts.add(autoOpenedKey(conversationId, server.port));
    notify({
      tone: 'success',
      title: 'Dev server ready',
      description: `localhost:${server.port} opened in Browser`,
      actionLabel: 'Undo',
      id: `dev-server:${conversationId}:${server.port}`,
      onAction: () => {
        useBrowserStore.getState().forget(key);
        if (previousActiveId && previousActiveId !== emptySurface.id) {
          const stillThere = useRightPanelStore
            .getState()
            .byConversationId[conversationId]?.surfaces.some(
              (surface) => surface.id === previousActiveId
            );
          if (stillThere) {
            useRightPanelStore.getState().activateSurface(conversationId, previousActiveId);
          }
        }
      },
    });
    return;
  }

  const openViewIds = surfaces
    .filter((surface) => surface.kind === 'browser')
    .map((surface) => surfaceResourceId(surface) ?? '');
  const nextViewId = nextOrdinalResourceId('view', openViewIds);
  const nextSurfaceId: SurfaceId = `browser:${nextViewId}`;
  const key = browserViewKey(conversationId, nextViewId);

  rightPanel.openSurface(conversationId, 'browser', nextViewId);
  useBrowserStore.getState().navigate(key, server.url);
  autoOpenedPorts.add(autoOpenedKey(conversationId, server.port));

  notify({
    tone: 'success',
    title: 'Dev server ready',
    description: `localhost:${server.port} opened in Browser`,
    actionLabel: 'Undo',
    id: `dev-server:${conversationId}:${server.port}`,
    onAction: () => {
      useBrowserStore.getState().forget(key);
      useRightPanelStore.getState().closeSurface(conversationId, nextSurfaceId);
      if (previousActiveId) {
        const stillThere = useRightPanelStore
          .getState()
          .byConversationId[conversationId]?.surfaces.some(
            (surface) => surface.id === previousActiveId
          );
        if (stillThere) {
          useRightPanelStore.getState().activateSurface(conversationId, previousActiveId);
        }
      }
    },
  });
}
