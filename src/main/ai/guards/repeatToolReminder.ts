import type { ModelMessage } from 'ai';

/**
 * Advisory per-turn repeat-call detector, ported from DeepSeek Harness's
 * `@deepseek-ai/dsh-repeat-tool-reminder` (packages/guard/repeat-tool-reminder).
 *
 * It is loop hygiene, not a model-facing tool: it never appears in the tool
 * list, never vetoes or rewrites a call, and adds exactly one behavior — it
 * watches the turn's stream of tool calls, counts runs of consecutive calls to
 * the same tool with identical canonicalized arguments, and at configured run
 * lengths injects an escalating advisory reminder telling the model to stop
 * repeating itself, re-read the last result, and either change approach or
 * conclude. The decision (retry differently, gather more evidence, or finish)
 * stays entirely with the model: a legitimately repeated call is delayed by
 * nothing and blocked by nothing.
 *
 * Mapping from dsh onto Atlas's AI-SDK loop:
 * - dsh observes on the `tools/post-execute` waterfall; Atlas observes on the
 *   `tool-result` stream chunk in `streamCore`, which — like post-execute —
 *   also fires for calls the approval ladder denied, so a model hammering a
 *   denied call is still caught.
 * - dsh delivers via the decision's `additionalContexts`, which the loop appends
 *   after the step's tool results and logs to the session; Atlas delivers by
 *   overriding the next step's messages in `streamText`'s `prepareStep`,
 *   appending the reminder right after the previous step's tool results.
 * - dsh keys chains per live agent (`WeakMap<Agent, Chain>`) and resets on a
 *   user prompt; Atlas builds one guard per `runProviderStream` call, and each
 *   call is exactly one turn for one conversation (subagents re-enter as their
 *   own calls), so per-turn isolation and the user-prompt reset fall out for
 *   free.
 *
 * One deliberate divergence: dsh logs the reminder, so it stays in the model's
 * history for the rest of the session. A `prepareStep` override is not merged
 * back into `response.messages`, so here the reminder is visible for the single
 * step that follows the threshold hit and is not persisted to the transcript.
 * That is acceptable for an advisory nudge — the later thresholds (5, 8)
 * re-remind a loop that continues — and it keeps a synthetic notice out of the
 * user's transcript.
 *
 * Known limitations (mirrors dsh's own, plus one port-specific):
 * - Near-identical variants are caught by fuzzy normalization (whitespace,
 *   line-ending, path-separator and trailing-slash differences collapse), but
 *   a semantically different argument that fuzzy-normalizes identically still
 *   counts — acceptable for an advisory nudge, and the veto path below quotes
 *   the exact arguments so the model can see the difference.
 * - Advisory by default; escalates to a pre-execute veto via `shouldBlock`
 *   once the run passes VETO_THRESHOLD (see `applyRepeatVeto` in streamCore).
 * - Past highest threshold hard-stop fires every 2 repeats from
 *   REPEAT_HARD_STOP_AFTER onward (10, 12, ...).
 * - PORT-SPECIFIC (fixed): user-denied approvals never reach the `tool-result`
 *   observation point — the AI SDK filters the denial chunk and ChatEngine
 *   ends the turn. Those are counted via `observeDenied`, wired from the
 *   approval-decline path, and via a conversation-scoped denial tracker in
 *   ChatEngine for denials that span turns (a per-turn guard can never reach
 *   threshold 3 when each denial ends its turn).
 */

export interface RepeatToolReminderConfig {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[];
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[];
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[];
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write_file` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number;
}

/** A reminder to deliver, with a short human/notice-facing summary. */
export interface RepeatToolReminder {
  text: string;
  /** `${toolName} × ${count}` — used for the transient user-facing notice. */
  summary: string;
}

export interface RepeatToolReminderGuard {
  /**
   * Observe one completed tool attempt (post-execute). Advances the chain and,
   * if this attempt's run length hits a configured threshold, queues and returns
   * the reminder to deliver; otherwise returns undefined.
   */
  observe(event: { toolName: string | undefined; input: unknown }): RepeatToolReminder | undefined;
  /**
   * Observe one denied attempt (approval declined, or SDK-filtered denial).
   * Counts identically to `observe`: a model hammering a refused call is
   * exactly the loop worth breaking. Separated so callers can route denials
   * that never reach the `tool-result` observation point.
   */
  observeDenied(event: { toolName: string | undefined; input: unknown }): RepeatToolReminder | undefined;
  /**
   * Pre-execute veto check. Returns true when the given call would continue a
   * run already past VETO_THRESHOLD — the caller should refuse to execute and
   * return the veto payload instead. Peek-only: never advances the chain (the
   * post-execute `observe` still counts the vetoed attempt, so the block
   * persists while the model keeps retrying).
   */
  shouldBlock(toolName: string | undefined, input: unknown): boolean;
  /** Current consecutive-repeat count for the given call (0 when untracked). */
  peekCount(toolName: string | undefined, input: unknown): number;
  /**
   * Inject any queued reminders into the next step's messages (prepareStep),
   * appending them after the previous step's tool results, then drain the
   * queue. Returns the SAME reference when nothing is queued so the caller can
   * skip the messages override.
   */
  injectIntoStepMessages(messages: ModelMessage[]): ModelMessage[];
  /** Drop the chain (a new turn starts fresh). */
  reset(): void;
}

/**
 * The default exclusion: `update_plan` is Atlas's bookkeeping tool (dsh excludes
 * `todo_write` for the same reason). The model legitimately rewrites the whole
 * checklist, so repeating it must not draw a reminder, and interleaving it into
 * a real loop must not launder the count.
 */
export const DEFAULT_REPEAT_TOOL_REMINDER_CONFIG: Required<RepeatToolReminderConfig> = {
  thresholds: [3, 5, 8],
  include: [],
  exclude: ['update_plan'],
  argumentsPreviewChars: 500
};

/**
 * Hard stop: past highest threshold guard went silent, letting doom loops run
 * to step cap. From here remind every 2 repeats with stop-now wording.
 * Pairs with the pre-execute veto at VETO_THRESHOLD and the lowered step cap
 * 64 to bound burn.
 */
export const REPEAT_HARD_STOP_AFTER = 10;

/**
 * Pre-execute veto: once a run passes this length, the execute-wrapper
 * refuses to run the call and returns a veto payload instead. Above the
 * hard-stop (10) so the model gets two advisory nudges first; below the
 * lightweight step cap (32) so the veto actually saves budget.
 */
export const REPEAT_VETO_AFTER = 12;

function vetoReminder(toolName: string, count: number): string {
  return (
    `BLOCKED: ${toolName} called ${count}x consecutively with equivalent arguments. ` +
    `This call was not executed. Stop calling this tool with these arguments. ` +
    `Summarize evidence gathered so far and finish the turn, or try a fundamentally different action.`
  );
}

function hardStopReminder(toolName: string, count: number): string {
  return (
    `HARD STOP: ${toolName} called ${count}x consecutively with identical arguments. ` +
    `Stop calling tools. Summarize evidence gathered so far and finish turn now, ` +
    `or try fundamentally different action. Further repeats waste budget.`
  );
}

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. ' +
  'Carefully analyze the previous result before calling again: if the task is ' +
  'not complete, try a different approach or different arguments instead of ' +
  'repeating the call.';

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return (
    'Repeated tool call detected:\n' +
    `- tool: ${toolName}\n` +
    `- consecutive_calls: ${count}\n` +
    `- arguments: ${canonicalArguments}\n` +
    'The repeated calls are not making progress. Do not call this tool with ' +
    'these exact arguments again. Inspect the latest result and choose a ' +
    'different action, different arguments, or finish the task if enough ' +
    'evidence has been gathered.'
  );
}

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ only
 * in property order canonicalize identically. Tool inputs reach the guard as
 * the AI SDK's parsed input object, so JSON's value domain is the whole input
 * domain — no bigint, cycle, or `undefined` handling exists because no input
 * path can produce them.
 */
export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }

  return value;
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
export function canonicalizeArguments(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue));
}

/**
 * Fuzzy string normalization for loop detection: collapse the trivial
 * variants that evaded exact-match detection (extra whitespace, CRLF vs LF,
 * backslash vs slash paths, trailing slashes, ./ prefixes). Deliberately
 * conservative — values that differ by more than this still count as
 * different calls and reset the chain.
 */
export function normalizeFuzzyString(value: string): string {
  let out = value.replace(/\r\n/g, '\n');
  out = out.replace(/\\/g, '/');
  out = out.trim();
  // Collapse runs of spaces/tabs (not newlines — code shape is preserved).
  out = out.replace(/[ \t]+/g, ' ');
  // Collapse duplicate slashes, strip ./ segments and trailing slashes.
  out = out.replace(/\/{2,}/g, '/');
  out = out.replace(/(^|\/)\.\//g, '$1');
  if (out.length > 1) {
    out = out.replace(/\/+$/g, '');
  }
  return out;
}

export function fuzzySortJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeFuzzyString(value);
  }
  if (Array.isArray(value)) {
    return value.map(fuzzySortJsonValue);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = fuzzySortJsonValue(record[key]);
    }
    return sorted;
  }
  return value;
}

/** Fuzzy chain key: same shape as canonical, but trivial variants collapse. */
export function canonicalizeArgumentsFuzzy(argumentsValue: unknown): string {
  return JSON.stringify(fuzzySortJsonValue(argumentsValue));
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`);
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`);
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the chain
 * key always uses the full canonical string.
 */
export function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) {
    return canonical;
  }

  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`;
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once). Misconfiguration fails loud — an empty list,
 * a non-integer, a value below 2, or a duplicate throws, never a silent
 * fall-back to defaults.
 */
export function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty');
  }

  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(
        `repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`
      );
    }
  }

  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates');
  }

  return [...values].sort((a, b) => a - b);
}

/**
 * Wrap a reminder so the model reads it as a system notice rather than a user
 * message. `<system-reminder>` is the convention Atlas and the wider ecosystem
 * already use for synthetic, non-user context that rides in a user-role slot.
 */
function reminderUserMessage(text: string): ModelMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }]
  };
}

/** One turn's consecutive-repeat chain: the last tracked call's identity key and its run length. */
interface Chain {
  key: string;
  count: number;
}

export function createRepeatToolReminderGuard(
  config: RepeatToolReminderConfig = {}
): RepeatToolReminderGuard {
  const thresholds = validateThresholds(config.thresholds ?? DEFAULT_REPEAT_TOOL_REMINDER_CONFIG.thresholds);
  const thresholdSet = new Set(thresholds);
  const includePatterns = (config.include ?? DEFAULT_REPEAT_TOOL_REMINDER_CONFIG.include).map(wildcardToRegExp);
  const excludePatterns = (config.exclude ?? DEFAULT_REPEAT_TOOL_REMINDER_CONFIG.exclude).map(wildcardToRegExp);
  const argumentsPreviewChars =
    config.argumentsPreviewChars ?? DEFAULT_REPEAT_TOOL_REMINDER_CONFIG.argumentsPreviewChars;

  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(
      `repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`
    );
  }

  let chain: Chain | undefined;
  const pending: ModelMessage[] = [];

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some((pattern) => pattern.test(toolName))) {
      return false;
    }

    return !excludePatterns.some((pattern) => pattern.test(toolName));
  }

  function observe(event: { toolName: string | undefined; input: unknown }): RepeatToolReminder | undefined {
    // A call with no tool name cannot be keyed; skip it rather than guess.
    if (!event.toolName) {
      return undefined;
    }

    if (!tracked(event.toolName)) {
      return undefined;
    }

    const canonical = canonicalizeArguments(event.input);
    // Fuzzy key: trivial variants (whitespace, path separators) keep the
    // chain alive; genuinely different arguments reset it. Display still
    // quotes the exact canonical form so the model sees what it sent.
    const fuzzy = canonicalizeArgumentsFuzzy(event.input);
    const key = JSON.stringify([event.toolName, fuzzy]);
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1;
    chain = { key, count };

    if (thresholdSet.has(count)) {
      const text =
        count === thresholds[0]
          ? GENTLE_REMINDER
          : detailedReminder(event.toolName, count, previewArguments(canonical, argumentsPreviewChars));
      const reminder = { text, summary: `${event.toolName} × ${count}` };
      pending.push(reminderUserMessage(text));
      return reminder;
    }

    const maxThreshold = thresholds[thresholds.length - 1]!;
    if (count >= REPEAT_HARD_STOP_AFTER && count > maxThreshold && count % 2 === 0) {
      const text = hardStopReminder(event.toolName, count);
      const reminder = { text, summary: `${event.toolName} × ${count} STOP` };
      pending.push(reminderUserMessage(text));
      return reminder;
    }

    return undefined;
  }

  function observeDenied(event: { toolName: string | undefined; input: unknown }): RepeatToolReminder | undefined {
    // Denied attempts count exactly like executed ones; routing through the
    // same chain keeps exact/fuzzy semantics identical.
    return observe(event);
  }

  function peekCount(toolName: string | undefined, input: unknown): number {
    if (!toolName || !tracked(toolName)) {
      return 0;
    }
    const key = JSON.stringify([toolName, canonicalizeArgumentsFuzzy(input)]);
    return chain !== undefined && chain.key === key ? chain.count : 0;
  }

  function shouldBlock(toolName: string | undefined, input: unknown): boolean {
    return peekCount(toolName, input) >= REPEAT_VETO_AFTER;
  }

  function injectIntoStepMessages(messages: ModelMessage[]): ModelMessage[] {
    if (pending.length === 0) {
      return messages;
    }

    const injected = [...messages, ...pending];
    pending.length = 0;
    return injected;
  }

  function reset(): void {
    chain = undefined;
    pending.length = 0;
  }

  return { observe, observeDenied, shouldBlock, peekCount, injectIntoStepMessages, reset };
}

/**
 * Pre-execute veto payload: returned instead of running the tool when
 * `shouldBlock` fires. Shaped as a normal result (not a throw) so the loop
 * records it, counts it, and shows the model why nothing ran.
 */
export function repeatVetoPayload(toolName: string, count: number): { type: string; reason: string } {
  return { type: 'repeat-veto', reason: vetoReminder(toolName, count) };
}
