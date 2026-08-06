import type { ToolSet } from 'ai';

import type { McpServerConfig } from '../../../shared/mcp';
import type { McpToolsProvider } from '../core/ChatSessionRuntime';
import type { McpClientManager } from './McpClientManager';
import { createMcpTools } from './mcpTools';

/**
 * Bridges the connection manager into a turn's tool set.
 *
 * Keeps the last successfully built set so the synchronous context meter has
 * something to measure. The first turn after a server is added measures
 * without it — an estimate being briefly low is a far better failure than
 * making the meter block on spawning a process.
 */
export function createMcpToolsProvider(
  manager: Pick<McpClientManager, 'listTools' | 'callTool'>,
  listServers: () => McpServerConfig[],
  /**
   * Which servers this conversation may use.
   *
   * A gated plugin's servers are neither connected nor described here, so the
   * saving is both the process and the tool schema. Absent means everything is
   * allowed, which is what the tests and any caller without a conversation get.
   */
  serverFilter?: (conversationId: string) => (serverId: string) => boolean
): McpToolsProvider {
  let cached: ToolSet = {};

  return {
    loadTools: async (conversationId?: string) => {
      const servers = listServers();

      if (!servers.some((server) => server.enabled)) {
        cached = {};
        return cached;
      }

      const filter = serverFilter && conversationId ? serverFilter(conversationId) : undefined;
      const definitions = await manager.listTools(filter);
      cached = createMcpTools(manager, definitions, servers);
      return cached;
    },
    peekTools: () => cached
  };
}
