import posthog from 'posthog-js';

import { POSTHOG_CONFIG } from '../../shared/posthog';

let initialized = false;
let telemetryEnabled = true;

export function initPostHog() {
  if (initialized) return;

  const { apiKey, host } = POSTHOG_CONFIG;
  if (!apiKey) return;

  try {
    posthog.init(apiKey, {
      api_host: host,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      persistence: 'localStorage',
    });

    initialized = true;
  } catch (err) {
    console.warn('[PostHog] Failed to initialize:', err);
  }
}

export async function syncTelemetryStatus() {
  try {
    telemetryEnabled = await window.atlasChat.posthog.isTelemetryEnabled();
  } catch {
    // Default to enabled
    telemetryEnabled = true;
  }
}

export async function identifyUser() {
  if (!initialized || !telemetryEnabled) return;

  try {
    const anonymousId = await window.atlasChat.posthog.getAnonymousId();
    posthog.identify(anonymousId);
  } catch (err) {
    console.warn('[PostHog] Failed to identify user:', err);
  }
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized || !telemetryEnabled) return;
  try {
    posthog.capture(event, properties);
  } catch (err) {
    console.warn('[PostHog] Failed to capture event:', err);
  }
}

export { posthog };
