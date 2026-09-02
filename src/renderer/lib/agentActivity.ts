import type { WorkLogEntry } from '../../shared/contracts';

/**
 * How many spawned agents in this thread are still working or waiting on a
 * human.
 *
 * Kept as a number rather than a filtered list on purpose: App only needs to
 * notice the 0 → 1 edge (to reveal the Agents tab), and a count lets it
 * subscribe to something that holds still while tokens stream, where the
 * activity array behind it is replaced on every flush.
 */
export function countRunningAgents(activities: readonly WorkLogEntry[] | undefined): number {
  if (!activities) return 0;

  let count = 0;
  for (const activity of activities) {
    if (activity.payload?.agentKind !== 'agent') continue;
    if (activity.status === 'running' || activity.status === 'pending_approval') count += 1;
  }
  return count;
}
