import type { ToolSet } from 'ai';

import type { McpServerConfig } from '../../../shared/mcp';
import type { McpToolsProvider } from '../core/ChatSessionRuntime';
import type { McpClientManager } from './McpClientManager';
import type { McpAuditContext } from '../core/ChatSessionRuntime';
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
  serverFilter?: (conversationId: string) => (serverId: string) => boolean,
  /**
   * Where `ui://` components land when the app can render them.
   *
   * Threaded through here rather than reached for inside `createMcpTools` so
   * that a caller building a tool set purely to measure it — or any headless
   * caller — gets one that draws nothing. A tool set that puts something on
   * screen as a side effect of being counted would be a bad surprise.
   */
  uiStore?: Parameters<typeof createMcpTools>[3],
  /**
   * Where plugin activity is recorded.
   *
   * Threaded to the same place as the UI store and for the same reason: a tool
   * set built purely to be measured must neither draw anything nor write an
   * audit line for a call nobody made.
   */
  audit?: Parameters<typeof createMcpTools>[4]
): McpToolsProvider {
  let cached: ToolSet = {};

  return {
    loadTools: async (conversationId?: string, auditContext?: McpAuditContext) => {
      const servers = listServers();

      if (!servers.some((server) => server.enabled)) {
        cached = {};
        return cached;
      }

      const filter = serverFilter && conversationId ? serverFilter(conversationId) : undefined;
      const definitions = await manager.listTools(filter);

      // One record per server that contributed, naming what it offered. This is
      // the first place data crosses to an external process, and an audit that
      // began at the first *call* would be missing the discovery that made the
      // call possible.
      if (audit && auditContext) {
        for (const server of servers) {
          const offered = definitions.filter((definition) => definition.serverId === server.id);

          audit.record({
            requestId: auditContext.requestId,
            conversationId: auditContext.conversationId,
            type: 'mcp_list_tools',
            server: {
              name: server.name,
              transport: server.transport,
              endpoint: server.transport === 'stdio' ? null : server.url
            },
            plugin: auditContext.pluginFor?.(server.name) ?? null,
            tool: null,
            outcome: 'ok',
            approvalId: null,
            toolCallId: null,
            detail: null,
            // Names only. The schemas are large, already in the request the
            // model saw, and add nothing an audit is opened to answer.
            payload: { tools: offered.map((definition) => definition.toolName) },
            // One row per (turn, server): a resumed turn re-listing an
            // unchanged server has nothing new to say, and this is a snapshot
            // of what was offered, not an exhaustive call log.
            idempotencyKey: `lt:${auditContext.requestId}:${server.name}`
          });
        }
      }

      cached = createMcpTools(manager, definitions, servers, uiStore, audit, auditContext);
      return cached;
    },
    peekTools: () => cached
  };
}
