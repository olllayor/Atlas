import keytar from 'keytar';

import type { ProviderId } from '../../shared/contracts';

const PRIMARY_SERVICE_NAME = 'atlas-chat';
const LEGACY_SERVICE_NAMES = ['cheapchat'];

/**
 * Historical account names from when OpenRouter and GLM were built in. Kept so
 * the startup migration can still read those secrets and move them to the
 * user-configured provider that replaced them.
 */
const LEGACY_ACCOUNT_NAMES: Record<string, string> = {
  openrouter: 'openrouter-api-key',
  glm: 'glm-api-key',
  openai: 'openai-api-key',
  gemini: 'gemini-api-key'
};

function accountNameFor(providerId: ProviderId) {
  return LEGACY_ACCOUNT_NAMES[providerId] ?? `${providerId}-api-key`;
}

/**
 * Non-API-key secrets live under dedicated accounts so they can coexist with
 * the conventional `${providerId}-api-key` slot. First consumer: the opencode
 * integration's server password (deep-integration plan D3 — never in settings JSON).
 */
export const OPENCODE_SERVER_PASSWORD_ACCOUNT = 'opencode-server-password';
/** Antigravity Gemini/API key for non-browser auth methods (never in settings JSON). */
export const ANTIGRAVITY_API_KEY_ACCOUNT = 'antigravity-api-key';

/**
 * Account-addressed variants of the API above. Accounts are validated with
 * the same shape rule used elsewhere in Atlas config storage: conservative
 * identifier charset, bounded length.
 */
const ACCOUNT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/;

function assertAccountName(accountName: string) {
  if (!ACCOUNT_NAME_PATTERN.test(accountName)) {
    throw new Error(`Invalid keychain account name: ${JSON.stringify(accountName.slice(0, 8))}…`);
  }
}

export class KeychainStore {
  async getSecret(providerId: ProviderId) {
    const accountName = accountNameFor(providerId);
    const currentSecret = await keytar.getPassword(PRIMARY_SERVICE_NAME, accountName);
    if (currentSecret) {
      return currentSecret;
    }

    for (const serviceName of LEGACY_SERVICE_NAMES) {
      const legacySecret = await keytar.getPassword(serviceName, accountName);
      if (!legacySecret) {
        continue;
      }

      await keytar.setPassword(PRIMARY_SERVICE_NAME, accountName, legacySecret);
      return legacySecret;
    }

    return null;
  }

  async setSecret(providerId: ProviderId, secret: string) {
    await keytar.setPassword(PRIMARY_SERVICE_NAME, accountNameFor(providerId), secret);
  }

  /** Called when a user-configured provider is removed. */
  async deleteSecret(providerId: ProviderId) {
    const accountName = accountNameFor(providerId);
    await keytar.deletePassword(PRIMARY_SERVICE_NAME, accountName);

    for (const serviceName of LEGACY_SERVICE_NAMES) {
      await keytar.deletePassword(serviceName, accountName).catch(() => undefined);
    }
  }

  async getSecretByAccount(accountName: string): Promise<string | null> {
    assertAccountName(accountName);
    return keytar.getPassword(PRIMARY_SERVICE_NAME, accountName);
  }

  async setSecretByAccount(accountName: string, secret: string): Promise<void> {
    assertAccountName(accountName);
    await keytar.setPassword(PRIMARY_SERVICE_NAME, accountName, secret);
  }

  async deleteSecretByAccount(accountName: string): Promise<void> {
    assertAccountName(accountName);
    await keytar.deletePassword(PRIMARY_SERVICE_NAME, accountName);
  }
}
