import type { ToolSet } from 'ai';

import type { McpServerConfig } from '../../../shared/mcp';
import type { McpToolsProvider } from '../core/ChatSessionRuntime';
import type { McpClientManager } from './McpClientManager';
import type { McpAuditContext } from '../core/ChatSessionRuntime';
import { createMcpTools } from './mcpTools';

/**
 * Per-turn ceiling on MCP tools injected into model context.
 *
 * Full lazy search (`search_mcp_tools` on demand) is future work; this is the
 * safe intermediate, bounding prompt bloat when a user enables chatty servers
 * while the audit records what each server lost.
 */
export const MAX_MCP_TOOLS_PER_TURN = 64;

/**
 * Picks the tools a turn can afford, fairly.
 *
 * Sorting by server then slicing would let one chatty server starve every
 * alphabetically-later one: a 90-tool `github` server would silence `linear`
 * completely, and the user would see their tools vanish with no failure. So
 * deal round-robin instead — every server gives up its Nth tool before any
 * server gives up its first. Within a server, tools go in name order, so the
 * survivors are stable turn to turn and the provider's prefix cache holds.
 *
 * Under the cap this is still a pure reordering, which is what makes the sort
 * unconditional: the offered set must not change shape at the boundary.
 */
export function selectToolsForTurn<T extends { serverId: string; toolName: string }>(
  definitions: readonly T[]
): T[] {
  const byServer = new Map<string, T[]>();
  for (const definition of definitions) {
    const bucket = byServer.get(definition.serverId);
    if (bucket) bucket.push(definition);
    else byServer.set(definition.serverId, [definition]);
  }

  const queues = [...byServer.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, tools]) =>
      [...tools].sort((a, b) => (a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0))
    );

  const selected: T[] = [];
  for (let round = 0; selected.length < MAX_MCP_TOOLS_PER_TURN; round += 1) {
    let dealt = false;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      if (selected.length >= MAX_MCP_TOOLS_PER_TURN) break;
      selected.push(queue[round]!);
      dealt = true;
    }
    if (!dealt) break;
  }
  return selected;
}

/** How many tools each server offered but did not get to send, by server id. */
export function countWithheldByServer(
  offered: readonly { serverId: string }[],
  selected: readonly { serverId: string }[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const definition of offered) {
    counts.set(definition.serverId, (counts.get(definition.serverId) ?? 0) + 1);
  }
  for (const definition of selected) {
    const remaining = (counts.get(definition.serverId) ?? 0) - 1;
    if (remaining > 0) counts.set(definition.serverId, remaining);
    else counts.delete(definition.serverId);
  }
  return counts;
}

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
      const allDefinitions = await manager.listTools(filter);
      const definitions = selectToolsForTurn(allDefinitions);
      const withheldByServer = countWithheldByServer(allDefinitions, definitions);

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
            // Names only. Withheld count is per-server, not the global total:
            // an audit is opened to find out what *this* server lost.
            payload: {
              tools: offered.map((definition) => definition.toolName),
              ...(withheldByServer.get(server.id)
                ? { withheldMcpTools: withheldByServer.get(server.id) }
                : {})
            },
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
