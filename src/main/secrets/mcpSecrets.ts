import keytar from 'keytar';

import type { OAuthStateStore } from '../ai/mcp/mcpOAuth';

const SERVICE_NAME = 'atlas-chat';

function accountNameFor(serverId: string) {
  return `mcp-server-${serverId}-env`;
}

function pluginAccountNameFor(pluginName: string) {
  return `atlas-plugin-${pluginName}-credentials`;
}

/**
 * The literal environment and credential values stored securely in OS Keychain.
 */
export class McpSecretStore {
  async getEnv(serverId: string): Promise<Record<string, string>> {
    const raw = await keytar.getPassword(SERVICE_NAME, accountNameFor(serverId)).catch(() => null);

    if (!raw) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, value]) => typeof value === 'string')
          .map(([key, value]) => [key, value as string])
      );
    } catch {
      return {};
    }
  }

  async setEnv(serverId: string, env: Record<string, string>): Promise<void> {
    if (Object.keys(env).length === 0) {
      await this.deleteEnv(serverId);
      return;
    }

    await keytar.setPassword(SERVICE_NAME, accountNameFor(serverId), JSON.stringify(env));
  }

  async deleteEnv(serverId: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, accountNameFor(serverId)).catch(() => undefined);
  }

  async getPluginCredentials(pluginName: string): Promise<Record<string, string>> {
    const raw = await keytar.getPassword(SERVICE_NAME, pluginAccountNameFor(pluginName)).catch(() => null);

    if (!raw) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, value]) => typeof value === 'string')
          .map(([key, value]) => [key, value as string])
      );
    } catch {
      return {};
    }
  }

  async setPluginCredentials(pluginName: string, credentials: Record<string, string>): Promise<void> {
    if (Object.keys(credentials).length === 0) {
      await this.deletePluginCredentials(pluginName);
      return;
    }

    await keytar.setPassword(SERVICE_NAME, pluginAccountNameFor(pluginName), JSON.stringify(credentials)).catch(() => undefined);
  }

  async deletePluginCredentials(pluginName: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, pluginAccountNameFor(pluginName)).catch(() => undefined);
  }
}

/**
 * OAuth flow state, kept in the keychain under the same service.
 *
 * Tokens, client registrations, PKCE verifiers and discovery caches are all
 * secrets or near-secrets; the store interface keeps `mcpOAuth.ts` testable
 * without the keychain underneath it.
 */
export function createKeychainOAuthStore(): OAuthStateStore {
  return {
    get: (key) => keytar.getPassword(SERVICE_NAME, key).catch(() => null),
    set: (key, value) => keytar.setPassword(SERVICE_NAME, key, value),
    remove: async (key) => {
      await keytar.deletePassword(SERVICE_NAME, key).catch(() => undefined);
    }
  };
}

