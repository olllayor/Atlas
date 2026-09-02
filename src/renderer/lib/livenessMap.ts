/** What background work a conversation is doing, as the subagent host reports it. */
export type LivenessState = 'working' | 'monitoring' | null;

export type LivenessMap = ReadonlyMap<string, LivenessState>;

/**
 * Whether two liveness readings say the same thing.
 *
 * The poll behind this runs every two seconds for the life of the window and
 * almost always reads back exactly what it read last time. Committing the new
 * `Map` regardless meant a state change — and so a render of everything below
 * `App` — twice a second in an app nobody was touching. Comparing first turns
 * the quiet case into no work at all.
 */
export function sameLivenessMap(left: LivenessMap, right: LivenessMap): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;

  for (const [conversationId, state] of left) {
    if (!right.has(conversationId)) return false;
    if (right.get(conversationId) !== state) return false;
  }

  return true;
}
