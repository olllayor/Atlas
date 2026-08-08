import { normalizePlanSteps, type PlanToolInput } from '../../../shared/planTool';

/**
 * The plan tool writes nothing but UI state, so its result is deliberately
 * thin — Codex's handler returns the bare string "Plan updated" and lets the
 * rendered plan speak for itself. Repeating the steps back would only invite
 * the model to restate them in its reply.
 *
 * The one addition is `note`: Codex enforces "at most one step in_progress"
 * with prompt text alone, which leaves a model that broke the rule with no way
 * to learn it did. Reporting the demotion here keeps the model's picture of the
 * plan and the user's identical.
 */
export async function updatePlanToolExecute(input: PlanToolInput) {
  const trimmed = input.plan
    .map((item) => ({ step: item.step.trim(), status: item.status }))
    .filter((item) => item.step.length > 0);
  const { steps, demotedCount } = normalizePlanSteps(trimmed);
  const completedSteps = steps.filter((item) => item.status === 'completed').length;

  return {
    message: steps.length === 0 ? 'Plan cleared.' : 'Plan updated.',
    totalSteps: steps.length,
    completedSteps,
    ...(demotedCount > 0
      ? {
          note: `Only one step may be in_progress at a time; ${demotedCount} extra in_progress step(s) were recorded as pending.`
        }
      : {})
  };
}
