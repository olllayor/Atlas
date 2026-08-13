import keytar from 'keytar';

const SERVICE_NAME = 'atlas-chat';

function accountNameFor(serverId: string) {
  return `mcp-server-${serverId}-env`;
}

/**
 * The literal environment values a user typed for an MCP server.
 *
 * Stored in the OS keychain as one JSON blob per server rather than in SQLite:
 * the settings form invites people to paste API tokens into it, and the
 * database file has no protection worth relying on. The names of the variables
 * stay in SQLite so the list can be shown without unlocking anything.
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
}
