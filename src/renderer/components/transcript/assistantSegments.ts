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

/**
 * Is the turn's work fold open by default?
 *
 * `splitAssistantTurn` calls the last unbroken run of prose the answer, and it
 * is right to — but mid-turn commentary ("Found one real issue. Let me check
 * the app root…") *is* that run while the turn is still going, and it stays
 * the answer for the rest of the turn even as more tools run after it. Keying
 * the default on "there is an answer" alone therefore slammed the fold shut on
 * the model's first sentence and left every later step invisible: a live turn
 * that read forty more files showed a static `Working 6m 48s` header and one
 * paragraph, which reads as a frozen app.
 *
 * So streaming keeps the fold open regardless. It still folds itself the
 * moment the turn settles, which is the behaviour the collapsed view is for.
 */
export function shouldOpenActivityFold(input: {
  readonly isStreaming: boolean;
  readonly hasAnswer: boolean;
}): boolean {
  return input.isStreaming || !input.hasAnswer;
}

/** Does this turn need the user before it can continue? */
export function hasPendingApproval(segments: AssistantSegment[]) {
  return segments.some(
    (segment) =>
      (segment.kind === 'tools' || segment.kind === 'plan' || segment.kind === 'spawn') &&
      segment.parts.some((part) => part.state === 'approval-requested')
  );
}

/**
 * Show a `Thinking` shimmer below a failed tool while the turn keeps running.
 *
 * Ported from t3code PR #9165 (`deriveMessagesTimelineRows`'s
 * `latestToolFailed` fallback), adapted to Atlas' open live log.
 *
 * Upstream owns a single shared live slot: when the latest visible tool
 * fails and nothing is still running, it hides the terminal `work-live` row
 * and emits the slot as `thinking` instead. Atlas has no such slot — the
 * `ActivityBlock` shows the whole run — so hiding the failure would erase
 * history the reader just watched. The adaptation keeps the failed cells
 * where they are and appends one shimmer `Thinking` row beneath them while
 * `isStreaming` stays true, so the bottom row says what is happening now
 * (the model is still working) instead of ending on the failure.
 *
 * Detection is state-only (`output-error`/`output-denied`), matching Atlas'
 * `toolCellStatus`. A still-running call (`input-streaming`,
 * `input-available`, `output-partial`, `approval-responded`) or a streaming
 * reasoning run already owns the live indicator, and an `approval-requested`
 * prompt is the live UI — all three suppress the fallback. That preserves
 * the PR's second commit (`preserve running tool activity`): an in-progress
 * tool never reads as failed.
 */
export function shouldShowFailedToolThinkingFallback(input: {
  readonly activity: readonly MergedActivitySegment[];
  readonly isStreaming: boolean;
}): boolean {
  if (!input.isStreaming || input.activity.length === 0) return false;

  let lastFailedTool = false;
  let hasTool = false;

  for (const segment of input.activity) {
    if (segment.kind === 'reasoning') {
      if (segment.isStreaming) return false;
      continue;
    }
    if (segment.kind !== 'tools') continue;
    for (const part of segment.parts) {
      hasTool = true;
      switch (part.state) {
        case 'approval-requested':
        case 'input-streaming':
        case 'input-available':
        case 'output-partial':
        case 'approval-responded':
          return false;
        case 'output-error':
        case 'output-denied':
          lastFailedTool = true;
          break;
        default:
          lastFailedTool = false;
          break;
      }
    }
  }

  return hasTool && lastFailedTool;
}

/**
 * One reasoning run or tool run inside the turn's work phase.
 *
 * A tool loop emits `reasoning → tools → reasoning → tools …` (each step
 * gets its own reasoning part via `stepScopedPartId` in `ChatSessionRuntime`),
 * which rendered as N alternating `Thinking` / `Ran 1 command` rows. Merging
 * same-kind runs across those boundaries restores one `Thought` row and lets
 * the tool grammar summarize the whole run (`Ran 5 commands`).
 *
 * A run coalesces only across the segments it is interleaved with — the
 * reasoning/tool alternation the step scoping produced. Anything else the
 * turn emitted (commentary, a file, a plan) closes both open runs, because
 * merging past it would hoist work that happened *after* a sentence above
 * it: a turn that searched, commented, then searched again rendered both
 * searches above the comment, and the newest step stopped being the bottom
 * row of the live log. Runs anchor where they open. Pure, so unit-tested.
 */
export type MergedActivitySegment =
  | {
      kind: 'reasoning';
      /** Stable key: the first reasoning part's id survives tail appends. */
      key: string;
      partIds: string[];
      text: string;
      /** True while any member part is still streaming. */
      isStreaming: boolean;
    }
  | { kind: 'tools'; key: string; parts: ChatToolPart[] }
  | { kind: 'part'; part: Exclude<ChatMessagePart, ChatToolPart> }
  | { kind: 'plan'; parts: ChatToolPart[] }
  | { kind: 'spawn'; parts: ChatToolPart[] };

export function mergeActivitySegments(segments: AssistantSegment[]): MergedActivitySegment[] {
  const merged: MergedActivitySegment[] = [];
  let reasoningRun: Extract<MergedActivitySegment, { kind: 'reasoning' }> | null = null;
  let toolsRun: Extract<MergedActivitySegment, { kind: 'tools' }> | null = null;

  for (const segment of segments) {
    if (segment.kind === 'part' && segment.part.type === 'reasoning') {
      if (!reasoningRun) {
        reasoningRun = {
          kind: 'reasoning',
          key: `activity-reasoning:${segment.part.id}`,
          partIds: [],
          text: '',
          isStreaming: false,
        };
        merged.push(reasoningRun);
      }
      reasoningRun.partIds.push(segment.part.id);
      if (segment.part.text) {
        reasoningRun.text = reasoningRun.text
          ? `${reasoningRun.text}\n\n${segment.part.text}`
          : segment.part.text;
      }
      if (segment.part.state === 'streaming') reasoningRun.isStreaming = true;
      continue;
    }
    if (segment.kind === 'tools') {
      if (!toolsRun) {
        toolsRun = { kind: 'tools', key: `activity-tools:${segment.parts[0]?.toolCallId ?? 'run'}`, parts: [] };
        merged.push(toolsRun);
      }
      toolsRun.parts.push(...segment.parts);
      continue;
    }
    if (segment.kind === 'part') {
      // Closes both runs: what follows this is a later phase of the turn,
      // and it has to render below it.
      reasoningRun = null;
      toolsRun = null;
      merged.push({ kind: 'part', part: segment.part });
      continue;
    }
    reasoningRun = null;
    toolsRun = null;
    // plan/spawn never appear in activity (`splitAssistantTurn` filters
    // them out) — passed through so nothing is dropped if that changes.
    merged.push(
      segment.kind === 'plan' ? { kind: 'plan', parts: segment.parts } : { kind: 'spawn', parts: segment.parts }
    );
  }

  return merged;
}
