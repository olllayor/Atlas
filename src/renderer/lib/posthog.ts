import type { PostHog } from 'posthog-js';

import { POSTHOG_CONFIG } from '../../shared/posthog';

/*
  `posthog-js` is ~175 kB and nothing on the first frame depends on it, so the
  client is imported dynamically instead of riding in the entry chunk. Everything
  below is written against a client that may not exist yet: `initPostHog` starts
  the load and returns immediately, and events captured before it lands are held
  in `pendingEvents` and replayed in order once it does.
*/
let client: PostHog | null = null;
let clientLoad: Promise<void> | null = null;
let telemetryEnabled = true;

type PendingEvent = { event: string; properties?: Record<string, unknown> };

// Bounded: telemetry is not worth unbounded retention if the client never loads.
const MAX_PENDING_EVENTS = 50;
const pendingEvents: PendingEvent[] = [];

/**
 * Starts loading the PostHog client. Safe to call more than once — subsequent
 * calls join the in-flight load.
 */
export function initPostHog() {
  if (clientLoad) return clientLoad;

  const { apiKey, host } = POSTHOG_CONFIG;
  if (!apiKey) {
    // No key: drop whatever queued, and never look again.
    pendingEvents.length = 0;
    clientLoad = Promise.resolve();
    return clientLoad;
  }

  clientLoad = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(apiKey, {
        api_host: host,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        persistence: 'localStorage',
      });

      client = posthog;
      applyTelemetryStateToClient();
      flushPendingEvents();
    })
    .catch((err) => {
      console.warn('[PostHog] Failed to initialize:', err);
      pendingEvents.length = 0;
    });

  return clientLoad;
}

function flushPendingEvents() {
  if (!client || !telemetryEnabled) {
    pendingEvents.length = 0;
    return;
  }

  for (const { event, properties } of pendingEvents.splice(0)) {
    try {
      client.capture(event, properties);
    } catch (err) {
      console.warn('[PostHog] Failed to capture event:', err);
    }
  }
}

export async function syncTelemetryStatus(): Promise<boolean> {
  try {
    telemetryEnabled = await window.atlasChat.posthog.isTelemetryEnabled();
    applyTelemetryStateToClient();
    return telemetryEnabled;
  } catch {
    // Default to enabled
    telemetryEnabled = true;
    return telemetryEnabled;
  }
}

export async function setTelemetryEnabled(enabled: boolean): Promise<boolean> {
  try {
    const next = await window.atlasChat.posthog.setTelemetryEnabled(enabled);
    telemetryEnabled = next;
    applyTelemetryStateToClient();
    return next;
  } catch (err) {
    console.warn('[PostHog] Failed to update telemetry preference:', err);
    return telemetryEnabled;
  }
}

function applyTelemetryStateToClient() {
  if (!client) return;
  if (telemetryEnabled) {
    client.opt_in_capturing();
  } else {
    client.opt_out_capturing();
    pendingEvents.length = 0;
  }
}

export async function identifyUser() {
  await clientLoad;
  if (!client || !telemetryEnabled) return;

  try {
    const anonymousId = await window.atlasChat.posthog.getAnonymousId();
    client.identify(anonymousId);
  } catch (err) {
    console.warn('[PostHog] Failed to identify user:', err);
  }
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (!telemetryEnabled) return;

  if (!client) {
    // The client is still loading (or was never started). Hold the event so a
    // launch-time capture is not lost to the import.
    if (clientLoad && pendingEvents.length < MAX_PENDING_EVENTS) {
      pendingEvents.push({ event, properties });
    }
    return;
  }

  try {
    client.capture(event, properties);
  } catch (err) {
    console.warn('[PostHog] Failed to capture event:', err);
  }
}
