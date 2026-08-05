import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { McpServerConfig } from '../../../shared/mcp';
import { buildMcpServerEnv, isValidMcpCommand } from '../../../shared/mcp';
import { logger } from '../../observability/logger';

/** Codex's defaults, kept so a server tuned for one behaves the same in the other. */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_TIMEOUT_MS = 300_000;
/** How long a discovered tool list is trusted before it is fetched again. */
const CATALOG_TTL_MS = 30 * 60_000;

export type McpToolDefinition = {
  serverId: string;
  serverName: string;
  /** The server's own name for the tool, unnamespaced. */
  toolName: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint?: boolean } | undefined;
};

export type McpServerHealth = {
  serverId: string;
  name: string;
  status: 'ready' | 'failed' | 'disabled';
  toolCount: number;
  error: string | null;
};

type Connection = {
  client: Client;
  close: () => Promise<void>;
};

/**
 * Owns every live MCP connection.
 *
 * Servers are connected on first use rather than at app start: these are
 * arbitrary local processes, and launching them for a user who never opens a
 * conversation would be spending their CPU on nothing.
 *
 * Nothing here is allowed to fail a turn. A server that will not start, or
 * hangs, or answers with nonsense contributes zero tools and a logged warning;
 * the turn proceeds with whatever else is available.
 */
export class McpClientManager {
  private readonly connections = new Map<string, Connection>();
  private readonly connecting = new Map<string, Promise<Connection | null>>();
  private readonly catalogs = new Map<string, { at: number; tools: McpToolDefinition[] }>();
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly listServers: () => McpServerConfig[],
    /**
     * Literal environment values, fetched at spawn time.
     *
     * A hook rather than a field on the config: these are keychain reads, and
     * the configuration a server is listed from must stay free of secrets.
     */
    private readonly resolveEnv: (serverId: string) => Promise<Record<string, string>> = async () => ({}),
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Every tool from every enabled server, skipping the ones that are down.
   *
   * `allSettled` is the point: one server timing out must not decide whether
   * the others' tools reach the model.
   */
  async listTools(): Promise<McpToolDefinition[]> {
    const servers = this.listServers().filter((server) => server.enabled);

    const results = await Promise.allSettled(
      servers.map((server) => this.toolsFor(server))
    );

    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }

  /**
   * Connects every enabled server ahead of the first turn.
   *
   * Connections are otherwise opened on first tool use, which puts the whole
   * startup cost — up to `startupTimeoutMs`, per server — in front of the
   * user's first message. Running it once the window is already interactive
   * spends the same time while nobody is waiting on it, and a user with no
   * servers configured pays nothing because there is nothing to connect.
   *
   * Cannot fail: `listTools` already reduces a server that will not start to a
   * logged warning, and a prewarm that failed looks the same as one that never
   * ran — the next use reconnects either way.
   */
  async prewarm(): Promise<void> {
    const enabled = this.listServers().filter((server) => server.enabled);

    if (enabled.length === 0) {
      return;
    }

    const startedAt = this.now();
    const tools = await this.listTools();

    logger.info('mcp.prewarmed', {
      servers: enabled.length,
      tools: tools.length,
      ms: this.now() - startedAt
    });
  }

  async health(): Promise<McpServerHealth[]> {
    const servers = this.listServers();

    return Promise.all(
      servers.map(async (server): Promise<McpServerHealth> => {
        if (!server.enabled) {
          return { serverId: server.id, name: server.name, status: 'disabled', toolCount: 0, error: null };
        }

        const tools = await this.toolsFor(server).catch(() => [] as McpToolDefinition[]);

        // Asked of the failure record rather than of `tools`: `toolsFor`
        // deliberately swallows errors so one bad server cannot fail a turn,
        // which means an empty list here is ambiguous — it is either a server
        // that offers nothing or one that never answered. Only `failures`
        // tells the two apart.
        const error = this.failures.get(server.id);

        if (error) {
          return {
            serverId: server.id,
            name: server.name,
            status: 'failed',
            toolCount: 0,
            error
          };
        }

        return {
          serverId: server.id,
          name: server.name,
          status: 'ready',
          toolCount: tools.length,
          error: null
        };
      })
    );
  }

  private async toolsFor(server: McpServerConfig): Promise<McpToolDefinition[]> {
    const cached = this.catalogs.get(server.id);
    if (cached && this.now() - cached.at < CATALOG_TTL_MS) {
      return cached.tools;
    }

    const connection = await this.connect(server);
    if (!connection) {
      return [];
    }

    try {
      const listed = await connection.client.listTools();

      const tools: McpToolDefinition[] = (listed.tools ?? []).map((entry) => ({
        serverId: server.id,
        serverName: server.name,
        toolName: entry.name,
        description: entry.description ?? '',
        inputSchema: entry.inputSchema,
        annotations: entry.annotations as { readOnlyHint?: boolean } | undefined
      }));

      this.catalogs.set(server.id, { at: this.now(), tools });
      this.failures.delete(server.id);
      return tools;
    } catch (error) {
      this.recordFailure(server, error);
      return [];
    }
  }

  /** Invokes a tool, bounded by the server's tool timeout. */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const server = this.listServers().find((entry) => entry.id === serverId);

    if (!server) {
      throw new Error('This MCP server is no longer configured.');
    }

    if (!server.enabled) {
      throw new Error(`The MCP server "${server.name}" is disabled.`);
    }

    const connection = await this.connect(server);

    if (!connection) {
      throw new Error(
        `The MCP server "${server.name}" is unavailable: ${this.failures.get(server.id) ?? 'could not connect'}`
      );
    }

    return connection.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { timeout: server.toolTimeoutMs || DEFAULT_TOOL_TIMEOUT_MS }
    );
  }

  /**
   * One connection attempt at a time per server.
   *
   * Several tools from the same server are resolved in the same turn, and
   * without this dedupe each would spawn its own copy of the process.
   */
  private connect(server: McpServerConfig): Promise<Connection | null> {
    const existing = this.connections.get(server.id);
    if (existing) {
      return Promise.resolve(existing);
    }

    const inFlight = this.connecting.get(server.id);
    if (inFlight) {
      return inFlight;
    }

    const attempt = this.openConnection(server)
      .then((connection) => {
        if (connection) {
          this.connections.set(server.id, connection);
        }
        return connection;
      })
      .catch((error: unknown) => {
        this.recordFailure(server, error);
        return null;
      })
      .finally(() => {
        this.connecting.delete(server.id);
      });

    this.connecting.set(server.id, attempt);
    return attempt;
  }

  private async openConnection(server: McpServerConfig): Promise<Connection | null> {
    const client = new Client(
      { name: 'atlas', version: '1.0.0' },
      { capabilities: {} }
    );

    // Set before the handshake so a transport that dies mid-connect is cleaned
    // up by the same path as one that dies later.
    client.onclose = () => {
      this.handleDisconnect(server, client);
    };

    const transport = await this.buildTransport(server);
    const timeoutMs = server.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS;

    // A server that never completes its handshake would otherwise hold the
    // turn open for as long as it likes.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s starting "${server.name}".`)),
        timeoutMs
      );
    });

    try {
      await Promise.race([client.connect(transport), timeout]);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    logger.info('mcp.connected', { serverId: server.id, name: server.name });

    return {
      client,
      close: async () => {
        await client.close().catch(() => undefined);
      }
    };
  }

  private async buildTransport(server: McpServerConfig) {
    if (server.transport === 'http') {
      if (!server.url) {
        throw new Error(`The MCP server "${server.name}" has no URL.`);
      }

      return new StreamableHTTPClientTransport(new URL(server.url));
    }

    if (!server.command || !isValidMcpCommand(server.command)) {
      throw new Error(
        `The MCP server "${server.name}" has no valid command. Commands run without a shell, so they cannot contain shell syntax.`
      );
    }

    // The environment is rebuilt from an allowlist rather than inherited:
    // this process holds the user's provider API keys, and a third-party
    // binary has no reason to see them.
    const env = await this.resolveEnv(server.id).catch(() => ({}));

    return new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: buildMcpServerEnv({ env, envVars: server.envVars }),
      cwd: server.cwd ?? undefined,
      stderr: 'pipe'
    });
  }

  /**
   * Forgets a connection that has gone away.
   *
   * A stdio child can exit — crash, OOM, a user killing it — and an HTTP
   * session can be dropped by the far end, neither of which this process
   * initiated. Without eviction the dead client stays in the map with a warm
   * catalog beside it, so the server keeps reporting `ready` with its old tool
   * count while every call fails against a transport nobody is listening to.
   * Dropping both makes the next use reconnect instead.
   */
  private handleDisconnect(server: McpServerConfig, client: Client) {
    // A reconnect may already have replaced this entry; only the connection
    // that actually closed is removed.
    if (this.connections.get(server.id)?.client !== client) {
      return;
    }

    this.connections.delete(server.id);
    this.catalogs.delete(server.id);

    logger.info('mcp.disconnected', { serverId: server.id, name: server.name });
  }

  private recordFailure(server: McpServerConfig, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.failures.set(server.id, message);

    logger.warn('mcp.server_failed', { serverId: server.id, name: server.name, error: message });
  }

  /** Drops a server's connection and cached tools, so the next use reconnects. */
  async reset(serverId: string): Promise<void> {
    this.catalogs.delete(serverId);
    this.failures.delete(serverId);

    const connection = this.connections.get(serverId);
    this.connections.delete(serverId);
    await connection?.close();
  }

  /** Closes every connection. Called on app quit. */
  async disposeAll(): Promise<void> {
    const open = [...this.connections.values()];
    this.connections.clear();
    this.catalogs.clear();

    await Promise.allSettled(open.map((connection) => connection.close()));
  }
}
