/**
 * How an assistant message's parts divide into rendered segments.
 *
 * Split out of `ChatWindow` and kept free of React so it can be unit-tested:
 * the grouping is the whole reason a plan updates in place rather than
 * accumulating one cell per call, and that rule is worth asserting directly.
 */

import type { ChatMessagePart, ChatToolPart } from '../../../shared/contracts';
import { isPlanToolPart } from '../../../shared/planTool';

export type AssistantSegment =
  | { kind: 'tools'; parts: ChatToolPart[] }
  | { kind: 'plan'; parts: ChatToolPart[] }
  | { kind: 'spawn'; parts: ChatToolPart[] }
  | { kind: 'part'; part: Exclude<ChatMessagePart, ChatToolPart> };

/** The tool that fans a turn out into subagents. */
export const SPAWN_TOOL_NAME = 'spawn_agent';

export function isSpawnToolPart(part: ChatToolPart): boolean {
  return part.toolName === SPAWN_TOOL_NAME;
}

/**
 * Collect runs of adjacent tool parts so the transcript can group them.
 *
 * Plan calls are the exception to "adjacent": every `update_plan` in the
 * message joins one segment anchored where the first one appeared, however
 * much text or how many other calls sit between them. That is what makes the
 * checklist update in place instead of leaving a trail of snapshots.
 *
 * `spawn_agent` follows the same rule for the same reason: a turn that fans
 * out four agents in four calls owns one fleet, and one row is what the
 * reader needs. The segment is anchored at the first spawn so the CTA stays
 * where the batch started.
 */
export function groupAssistantParts(parts: ChatMessagePart[]): AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  let planSegment: Extract<AssistantSegment, { kind: 'plan' }> | null = null;
  let spawnSegment: Extract<AssistantSegment, { kind: 'spawn' }> | null = null;

  for (const part of parts) {
    if (part.type === 'tool') {
      if (isSpawnToolPart(part)) {
        if (spawnSegment) {
          spawnSegment.parts.push(part);
        } else {
          spawnSegment = { kind: 'spawn', parts: [part] };
          segments.push(spawnSegment);
        }
        continue;
      }

      if (isPlanToolPart(part)) {
        if (planSegment) {
          planSegment.parts.push(part);
        } else {
          planSegment = { kind: 'plan', parts: [part] };
          segments.push(planSegment);
        }
        continue;
      }

      const last = segments[segments.length - 1];
      if (last?.kind === 'tools') {
        last.parts.push(part);
      } else {
        segments.push({ kind: 'tools', parts: [part] });
      }
      continue;
    }
    segments.push({ kind: 'part', part });
  }

  return segments;
}

export type AssistantTurnSplit = {
  /**
   * Everything the model did on the way to the answer — reasoning, tool calls,
   * and the running commentary between them. Rendered inside one collapsed
   * "Worked for …" disclosure.
   */
  activity: AssistantSegment[];
  /** Plan checklists, which stay visible: they are state, not history. */
  plan: Extract<AssistantSegment, { kind: 'plan' }>[];
  /**
   * Spawn batches, which also stay visible. Agents outlive the turn that
   * launched them, so folding the fleet away with the turn's work would hide
   * live state behind a disclosure.
   */
  spawn: Extract<AssistantSegment, { kind: 'spawn' }>[];
  /** The reply itself: the last unbroken run of prose the turn produced. */
  answer: AssistantSegment[];
};

/** Prose is what a reader came for; everything else is how it got made. */
function isProse(segment: AssistantSegment) {
  return (
    segment.kind === 'part' &&
    (segment.part.type === 'text' || segment.part.type === 'visual' || segment.part.type === 'file')
  );
}

/**
 * Split a turn into "work" and "answer", the way the Codex app does.
 *
 * Codex renders a turn as one dim `Worked for 1m 47s ›` row followed by the
 * reply, with the reasoning and every tool call folded inside that row.
 *
 * The answer is the **last unbroken run of prose**, not "everything after the
 * last tool call". The two differ whenever a turn ends on a tool — a final
 * `Explored 1 file`, a call the model made after it had already written its
 * conclusion, an aborted turn. Anchoring on the tool there swallows the whole
 * reply into the disclosure and leaves the reader with a single dim line;
 * anchoring on the prose keeps the answer where the reader expects it and
 * folds the stray call in with the rest of the work.
 *
 * A turn that never called a tool has nothing to fold: plain thinking already
 * summarises itself as `Thought for 8s`, and a second `Worked for 8s` wrapper
 * around it is one fold too many.
 */
export function splitAssistantTurn(segments: AssistantSegment[]): AssistantTurnSplit {
  const plan = segments.filter(
    (segment): segment is Extract<AssistantSegment, { kind: 'plan' }> => segment.kind === 'plan'
  );
  const spawn = segments.filter(
    (segment): segment is Extract<AssistantSegment, { kind: 'spawn' }> => segment.kind === 'spawn'
  );
  const rest = segments.filter((segment) => segment.kind !== 'plan' && segment.kind !== 'spawn');

  if (!rest.some((segment) => segment.kind === 'tools')) {
    return { activity: [], plan, spawn, answer: rest };
  }

  // Walk back over any trailing tool/reasoning rows, then back over the prose
  // run they follow. That run is the reply.
  let end = rest.length;
  while (end > 0 && !isProse(rest[end - 1])) end -= 1;

  let start = end;
  while (start > 0 && isProse(rest[start - 1])) start -= 1;

  return {
    activity: [...rest.slice(0, start), ...rest.slice(end)],
    plan,
    spawn,
    answer: rest.slice(start, end),
  };
}

/** Does this turn need the user before it can continue? */
export function hasPendingApproval(segments: AssistantSegment[]) {
  return segments.some(
    (segment) =>
      (segment.kind === 'tools' || segment.kind === 'plan' || segment.kind === 'spawn') &&
      segment.parts.some((part) => part.state === 'approval-requested')
  );
}
