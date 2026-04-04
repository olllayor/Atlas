import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { PostHog } from 'posthog-node';

import { POSTHOG_CONFIG } from '../../shared/posthog';

const ANONYMOUS_ID_FILENAME = 'anonymous_id';

function resolveAnonymousIdPath() {
  return join(app.getPath('userData'), ANONYMOUS_ID_FILENAME);
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

export async function shutdownPostHog() {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
