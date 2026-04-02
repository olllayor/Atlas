import keytar from 'keytar';

import type { ProviderId } from '../../shared/contracts';

const PRIMARY_SERVICE_NAME = 'atlas-chat';
const LEGACY_SERVICE_NAMES = ['cheapchat'];

const ACCOUNT_NAMES: Record<ProviderId, string> = {
  openrouter: 'openrouter-api-key',
  glm: 'glm-api-key',
  openai: 'openai-api-key',
  gemini: 'gemini-api-key'
};

export class KeychainStore {
  async getSecret(providerId: ProviderId) {
    const accountName = ACCOUNT_NAMES[providerId];
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
    await keytar.setPassword(PRIMARY_SERVICE_NAME, ACCOUNT_NAMES[providerId], secret);
  }
}
