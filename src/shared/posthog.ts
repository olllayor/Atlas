const DEFAULT_POSTHOG_API_KEY = 'phc_mk77dSEfsouqEzCWE3eUi3wFVgCK6qNgYm7CcTdDboQX';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

function getEnv(key: string, fallback: string) {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }

  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }

  return fallback;
}

export function isTelemetryEnabled(): boolean {
  if (typeof process === 'undefined') return true;
  const value = process.env.ATLAS_TELEMETRY_ENABLED;
  if (value !== undefined) {
    return value !== 'false' && value !== '0';
  }
  return true;
}

export const POSTHOG_CONFIG = {
  apiKey: getEnv('POSTHOG_API_KEY', DEFAULT_POSTHOG_API_KEY),
  host: getEnv('POSTHOG_HOST', DEFAULT_POSTHOG_HOST),
} as const;

export const POSTHOG_EVENTS = {
  FIRST_LAUNCH: 'first launch',
  APP_LAUNCHED: 'app launched',
  APP_CLOSED: 'app closed',
  ONBOARDING_STARTED: 'onboarding started',
  ONBOARDING_COMPLETED: 'onboarding completed',
  CONVERSATION_CREATED: 'conversation created',
  CONVERSATION_DELETED: 'conversation deleted',
  CONVERSATION_LOADED: 'conversation loaded',
  MESSAGE_SENT: 'message sent',
  MESSAGE_ABORTED: 'message aborted',
  PROVIDER_KEY_SAVED: 'provider key saved',
  PROVIDER_KEY_VALIDATED: 'provider key validated',
  PREFERENCES_UPDATED: 'preferences updated',
  MODELS_REFRESHED: 'models refreshed',
  MODEL_SELECTED: 'model selected',
  SETTINGS_OPENED: 'settings opened',
  SETTINGS_CLOSED: 'settings closed',
  COMMAND_PALETTE_OPENED: 'command palette opened',
  UPDATE_CHECKED: 'update checked',
  UPDATE_DOWNLOADED: 'update downloaded',
  ERROR_OCCURRED: 'error occurred',
} as const;
