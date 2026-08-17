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
 * - Exact-match detection only; near-identical variants (a tweaked path, extra
 *   whitespace inside a value) evade the chain.
 * - Advisory only; never escalates to blocking.
 * - Past the highest threshold a chain goes silent (reminders fire only at the
 *   exact configured counts).
 * - PORT-SPECIFIC: calls denied by the approval ladder are NOT counted. The AI
 *   SDK surfaces those as a `tool-output-denied` chunk that its `onChunk`
 *   allowlist filters out, so they never reach the observation point — unlike
 *   dsh, whose `tools/post-execute` seam sees denials. A tool that internally
 *   refuses (returns an `execution-denied`-shaped result) still produces a
 *   normal `tool-result` chunk and IS counted.
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
    const key = JSON.stringify([event.toolName, canonical]);
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1;
    chain = { key, count };

    if (!thresholdSet.has(count)) {
      return undefined;
    }

    const text =
      count === thresholds[0]
        ? GENTLE_REMINDER
        : detailedReminder(event.toolName, count, previewArguments(canonical, argumentsPreviewChars));
    const reminder = { text, summary: `${event.toolName} × ${count}` };
    pending.push(reminderUserMessage(text));
    return reminder;
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

  return { observe, injectIntoStepMessages, reset };
}
