import keytar from 'keytar';

const SERVICE_NAME = 'atlas-cloud-sandbox';
const ACCOUNT_NAME = 'worker-secret';

/**
 * Thin wrapper over keytar for the Cloud Sandbox bearer token.
 *
 * Kept separate from `KeychainStore` because the token is not a provider API
 * key — it uses a different keychain item name, and treating it as one would
 * leak it into the provider-credential UI flows.
 */
export class CloudSandboxSecretStore {
  static async read(): Promise<string | null> {
    const value = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    return value && value.trim() ? value : null;
  }

  static async write(secret: string | null): Promise<void> {
    if (!secret) {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
      return;
    }
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, secret);
  }
}
