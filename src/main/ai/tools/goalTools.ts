import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';

import type { GoalBlockerKind } from '../../db/repositories/conversationGoalsRepo';
import { GOAL_BLOCKER_KINDS } from '../../db/repositories/conversationGoalsRepo';

/**
 * The model-facing side of goal mode (`/goal`, plan
 * docs/superpowers/plans/2026-08-26-goal-mode.md).
 *
 * One tool, `update_goal`: the model's way to claim progress end-states. The
 * runtime decides whether the claim sticks — this module only relays typed
 * acknowledgements, so a malformed or premature claim is a recoverable tool
 * result, never hidden state (Orca's rule: outside a live goal capability the
 * tools are not even advertised).
 *
 * There is deliberately no create_goal/get_goal pair here: the objective and
 * its state arrive in the system prompt every turn while a goal is active,
 * which is one fewer tool and one less way to disagree with the runtime.
 */

/** Structural seam over GoalRuntime — keeps node-pty/Electron types out of here. */
export type GoalToolContext = {
  getActive(conversationId: string): {
    objective: string;
    status: string;
    turnCount: number;
    turnCap: number;
  } | null;
  recordTerminalIntent(
    conversationId: string,
    intent: {
      status: 'complete' | 'blocked';
      reason: string;
      evidenceSummary: string;
      blockerKind?: GoalBlockerKind;
    }
  ): string;
};

export const GOAL_TOOL_SYSTEM_PROMPT = [
  'A persistent goal is active: keep working toward it across turns until it is complete or blocked.',
  'When the goal is genuinely done, call update_goal with status complete and concrete evidence — commands you ran and their results, files you changed.',
  'If only a human decision, missing authority, an external dependency, or an unverifiable requirement stands in the way, call update_goal with status blocked and name the blocker kind instead of stalling.',
  'Never claim completion from intention: evidence of verification is required.',
  'Between milestones, keep update_plan current — plan movement is how progress is measured.'
].join(' ');

const evidenceSchema = z.object({
  kind: z.enum(['test', 'build', 'lint', 'file_change', 'manual_check']),
  summary: z.string().trim().min(1).max(300),
  target: z.string().trim().max(300).optional()
});

export function createGoalTools(context: GoalToolContext, conversationId: string): ToolSet {
  return {
    update_goal: tool({
      description:
        'Report the state of your persistent goal. Call with status complete when the objective is verifiably achieved (evidence required), or status blocked when a non-model-fixable blocker stops the work. The runtime audits the claim at turn end; calling mid-turn does not end anything by itself.',
      inputSchema: z.object({
        status: z.enum(['complete', 'blocked']),
        reason: z.string().trim().min(1).max(500).describe('One-paragraph justification for the claimed state'),
        evidence: z
          .array(evidenceSchema)
          .min(1)
          .max(10)
          .describe('Concrete artifacts backing the claim: commands run, files changed, checks performed'),
        blocker_kind: z
          .enum(GOAL_BLOCKER_KINDS)
          .optional()
          .describe('Required when status is blocked: which kind of external stop applies')
      }),
      strict: true,
      execute: async (input) => {
        const evidenceSummary = input.evidence
          .map((item) => `${item.kind}: ${item.summary}${item.target ? ` (${item.target})` : ''}`)
          .join('; ');
        const ack = context.recordTerminalIntent(conversationId, {
          status: input.status,
          reason: input.reason,
          evidenceSummary,
          ...(input.blocker_kind ? { blockerKind: input.blocker_kind } : {}),
        });
        return { ack };
      }
    })
  };
}
