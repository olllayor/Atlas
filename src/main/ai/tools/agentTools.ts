/**
 * Agent tools definition (`docs/plans/agents/02-subagent-runtime.md`).
 *
 * Provides the `spawn_agent` tool for parallel subagent delegation.
 * The tool is omitted only when nesting would exceed maxDepth — a static fact
 * for the conversation. Slot pressure is NOT a registration condition: the
 * tool catalog must stay stable across turns for prompt-cache reuse, so an
 * over-capacity spawn is rejected at execution time with an actionable error
 * instead of the tool disappearing from the catalog.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SubagentRuntime } from '../agents/SubagentRuntime';

export type SubagentContext = {
  conversationId: string;
  turnId: string;
  parentAgentId?: string;
  parentToolCallId?: string;
  parentSignal?: AbortSignal;
  /** Nesting depth of the current subagent (root = 0, grandchild = 2, …). */
  depth?: number;
};

export function createAgentTools(
  subagentRuntime?: SubagentRuntime,
  context?: SubagentContext
) {
  // Gate the tool only on the depth cap — a static fact for this conversation.
  // Slot pressure is enforced at spawn time (per-task rejection), never here,
  // so the tool catalog does not churn as slots fill and free.
  const canSpawn =
    subagentRuntime != null && context != null
      ? subagentRuntime.canSpawn(context.depth ?? 0)
      : false;

  const tools: Record<string, unknown> = {};

  if (canSpawn) {
    tools.spawn_agent = tool({
      description:
        'Run a focused sub-task in a separate agent with its own context window. Accepts an array of tasks for parallel fan-out. A task can be rejected if the subagent concurrency limit is reached; the result says so per task.',
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              title: z.string().describe('Short descriptive title for the subagent task'),
              prompt: z.string().describe('Instructions and prompt for the subagent'),
              model: z.string().optional().describe('Model override (defaults to parent model)'),
              role: z.string().optional().describe('Role or persona for the subagent'),
              outputFile: z.string().optional().describe('Optional file path to write output result'),
              tools: z.array(z.string()).optional().describe('Optional list of tool names allowed for this subagent'),
            })
          )
          .min(1)
          .describe('List of subagent tasks to spawn in parallel'),
      }),
      execute: async (input, options) => {
        if (!subagentRuntime || !context) {
          return {
            spawnedCount: 0,
            tasks: [],
            error: 'Subagent runtime not initialized for this turn',
          };
        }

        const toolCallId = options.toolCallId ?? context.parentToolCallId ?? 'spawn_tool';
        const results = await subagentRuntime.spawnBatch({
          conversationId: context.conversationId,
          parentTurnId: context.turnId,
          parentToolCallId: toolCallId,
          parentAgentId: context.parentAgentId,
          depth: context.depth,
          tasks: input.tasks,
          parentSignal: context.parentSignal,
        });

        return {
          spawnedCount: results.length,
          tasks: results.map((task) => ({
            taskId: task.taskId,
            title: task.title,
            status: task.status,
            error: task.error ?? undefined,
            summary: task.result ?? (task.error ? `Failed: ${task.error}` : task.progress ?? 'Completed'),
            tokensUsed: task.usage?.totalTokens ?? 0,
          })),
        };
      },
    });
  }

  return tools;
}
