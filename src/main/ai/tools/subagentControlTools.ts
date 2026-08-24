/**
 * S2 — Model-facing control tools for continuable subagents.
 *
 * Port of deepseek-harness `tool-subagent-control`: `send_message` and
 * `interrupt_agent` as thin adapters over `SubagentContinuationManager`.
 * No lifecycle routing of their own — the manager owns residency, cold resume,
 * and interrupt.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SubagentContinuationManager } from '../agents/SubagentContinuationManager';

export type SubagentControlContext = {
  conversationId: string;
};

export function createSubagentControlTools(
  manager: Pick<
    SubagentContinuationManager,
    'followup' | 'interruptForParent' | 'listActivationsForParent'
  > | null | undefined,
  context?: SubagentControlContext,
) {
  const tools: Record<string, unknown> = {};

  tools.send_message = tool({
    description:
      'Send a message to a background subagent by its subagent id, continuing the same conversation. It becomes the subagent\'s next turn: if it is still working, the message waits until its current turn finishes, so it cannot redirect work already underway. This call returns no answer from the subagent — only confirmation that the message was delivered — so use it to give it more work. A failure means the message was NOT delivered.',
    inputSchema: z.object({
      subagent_id: z.string().describe('The subagent id returned when the background subagent was started.'),
      message: z.string().describe('The message to deliver to the subagent.'),
    }),
    strict: true,
    execute: async (input) => {
      if (!manager || !context) {
        throw new Error('send_message requires a subagent manager and conversation context');
      }
      const messageId = await manager.followup(context.conversationId, input.subagent_id, input.message, {});
      return { messageId };
    },
  });

  tools.interrupt_agent = tool({
    description:
      'Request cancellation of a background agent\'s current turn by its agent id. Only your own conversation\'s subagents can be interrupted. Only the current turn stops: messages already queued for the agent stay parked until a later send_message wakes it, agents it started keep running, and the agent itself stays available for follow-ups. This call returns as soon as the stop request is accepted, so the target may keep running briefly; interrupting an agent that already finished is an accepted no-op.',
    inputSchema: z.object({
      agent_id: z.string().describe('The agent id of the running agent to interrupt.'),
    }),
    strict: true,
    execute: async (input) => {
      if (!manager || !context) throw new Error('interrupt_agent requires a subagent manager and conversation context');
      // Fenced: only children whose recorded parent is THIS conversation.
      const res = await manager.interruptForParent(context.conversationId, input.agent_id);
      if (!res) {
        return { accepted: false, reason: `No interruptable subagent "${input.agent_id}" belongs to this conversation.` };
      }
      return res;
    },
  });

  tools.list_agents = tool({
    description: 'List this conversation\'s live background subagents with their ids and statuses.',
    inputSchema: z.object({}),
    strict: true,
    execute: async () => {
      if (!manager || !context) return { agents: [] };
      // Fenced to the calling conversation; durable catalog listing lands in S4.
      const agents = manager.listActivationsForParent(context.conversationId);
      return {
        agents: agents.map((a) => ({
          agentId: a.childId,
          status: a.processing ? 'running' : 'idle',
          queuedMessages: a.queued,
        })),
      };
    },
  });

  return tools;
}
