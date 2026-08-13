import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { PostHog } from 'posthog-node';

import { POSTHOG_CONFIG, isTelemetryEnabled } from '../../shared/posthog';

const ANONYMOUS_ID_FILENAME = 'anonymous_id';
const FIRST_LAUNCH_FLAG_FILENAME = 'first_launch_done';
const TELEMETRY_PREFERENCE_FILENAME = 'telemetry_enabled';

function resolveAnonymousIdPath() {
  return join(app.getPath('userData'), ANONYMOUS_ID_FILENAME);
}

function resolveFirstLaunchFlagPath() {
  return join(app.getPath('userData'), FIRST_LAUNCH_FLAG_FILENAME);
}

function resolveTelemetryPreferencePath() {
  return join(app.getPath('userData'), TELEMETRY_PREFERENCE_FILENAME);
}

function readTelemetryPreferenceFile(): boolean | null {
  try {
    const path = resolveTelemetryPreferencePath();
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8').trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function telemetryEnabledWithPreference(): boolean {
  const fileValue = readTelemetryPreferenceFile();
  if (fileValue !== null) return fileValue;
  return isTelemetryEnabled();
}

function isFirstLaunch(): boolean {
  return !existsSync(resolveFirstLaunchFlagPath());
}

function markFirstLaunchComplete(): void {
  try {
    const userDataDir = app.getPath('userData');
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(resolveFirstLaunchFlagPath(), new Date().toISOString(), 'utf-8');
  } catch {
    // Non-critical, ignore
  }
}

function getOrCreateAnonymousId(): string {
  const filePath = resolveAnonymousIdPath();

  if (existsSync(filePath)) {
    try {
      const stored = readFileSync(filePath, 'utf-8').trim();
      if (stored) return stored;
    } catch {
      // Fall through to generate new ID
    }
  }

  const newId = `anon_${randomUUID()}`;
  try {
    const userDataDir = app.getPath('userData');
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(filePath, newId, 'utf-8');
  } catch {
    // If we can't persist, just return the ID anyway
  }

  return newId;
}

let client: PostHog | null = null;
let anonymousId: string | null = null;

export function getPostHogClient() {
  if (!client) {
    const apiKey = POSTHOG_CONFIG.apiKey;
    if (!apiKey) {
      return null;
    }

    client = new PostHog(apiKey, {
      host: POSTHOG_CONFIG.host,
      flushAt: 20,
      flushInterval: 10_000,
      disableGeoip: true,
    });

    client.on('error', (err) => {
      console.error('[PostHog] Error:', err);
    });
  }

  return client;
}

export function getAnonymousId() {
  if (!anonymousId) {
    anonymousId = getOrCreateAnonymousId();
  }

  return anonymousId;
}

export function capturePostHogEvent(event: string, properties?: Record<string, unknown>) {
  if (!telemetryEnabledWithPreference()) return;

  const posthog = getPostHogClient();
  if (!posthog) return;

  posthog.capture({
    distinctId: getAnonymousId(),
    event,
    properties: {
      $process_person_profile: false,
      app_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      ...properties,
    },
  });
}

export function captureFirstLaunchIfNeeded() {
  if (!isFirstLaunch()) return;
  if (!telemetryEnabledWithPreference()) {
    markFirstLaunchComplete();
    return;
  }

  markFirstLaunchComplete();
  capturePostHogEvent('first launch', {
    install_date: new Date().toISOString(),
  });
}

export function getTelemetryEnabled(): boolean {
  return telemetryEnabledWithPreference();
}

export function setTelemetryEnabled(enabled: boolean): boolean {
  try {
    const userDataDir = app.getPath('userData');
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(resolveTelemetryPreferencePath(), enabled ? 'true' : 'false', 'utf-8');
    return enabled;
  } catch (err) {
    console.warn('[PostHog] Failed to persist telemetry preference:', err);
    return isTelemetryEnabled();
  }
}

export async function shutdownPostHog() {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
