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
}
