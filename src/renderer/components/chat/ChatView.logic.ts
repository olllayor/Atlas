import {
  ANTIGRAVITY_CHAT_DEFAULT_MODEL,
  ANTIGRAVITY_DEFAULT_MODEL
} from '../../../shared/antigravityModels.js';

export interface ProviderAuthStatus {
  status: 'unknown' | 'authenticated' | 'unauthenticated' | string;
}

export interface ProviderModelRef {
  id: string;
  name?: string;
  label?: string;
}

export interface ServerProvider {
  driver?: string;
  instanceId?: string;
  installed?: boolean;
  status: 'ready' | 'warning' | 'error' | 'disabled' | string;
  auth: ProviderAuthStatus;
  models: ProviderModelRef[];
  message?: string | null;
}

/**
 * Returns a human-readable reason if Antigravity should block sending, or null if send is allowed.
 *
 * After a restart, Antigravity often reports auth as unknown and an empty model catalog
 * even when saved Google credentials are valid. We allow session startup to check the saved
 * credentials and validate the chosen model rather than blocking sending.
 */
export function getAntigravitySendBlockReason(
  provider: Pick<ServerProvider, 'installed' | 'auth' | 'models'> & { status?: string },
  model: string
): string | null {
  if (!provider.installed) {
    return 'Install Antigravity in provider settings before sending.';
  }
  if (provider.auth.status === 'unauthenticated') {
    return 'Sign in to Antigravity in provider settings before sending.';
  }
  const slug = model.trim();
  if (slug.length === 0) return 'Choose an Antigravity model before sending.';
  // A restart clears the account status and catalog. Session startup checks
  // saved credentials and validates the model before sending the prompt.
  if (provider.auth.status === 'unknown') return null;
  if (provider.models.length === 0) {
    return 'Refresh Antigravity models in provider settings before sending.';
  }
  // A saved model that left the catalog is kept in the picker as unavailable
  // so the user sees what the thread used. The server rejects it at turn
  // start, so block here unless the provider is in an error state, where a
  // refresh might bring it back.
  if (!provider.models.some((m) => m.id === slug) && provider.status !== 'error') {
    return `Model "${slug}" is not available. Choose another model before sending.`;
  }
  return null;
}

export { ANTIGRAVITY_DEFAULT_MODEL, ANTIGRAVITY_CHAT_DEFAULT_MODEL };
