import keytar from 'keytar';

import type { ProviderId } from '../../shared/contracts';

const SERVICE_NAME = 'cheapchat';

const ACCOUNT_NAMES: Record<ProviderId, string> = {
  openrouter: 'openrouter-api-key',
  openai: 'openai-api-key',
  gemini: 'gemini-api-key'
};

export class KeychainStore {
  async getSecret(providerId: ProviderId) {
    return keytar.getPassword(SERVICE_NAME, ACCOUNT_NAMES[providerId]);
  }

  async setSecret(providerId: ProviderId, secret: string) {
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAMES[providerId], secret);
  }
}
