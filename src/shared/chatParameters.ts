/**
 * How much thinking budget the model should spend before answering. `off` is
 * distinct from "unset": it explicitly disables a thinking mode that a model
 * would otherwise enable by default. `on` exists for models whose only control
 * is a binary thinking switch — there is no level to pick, just enabled.
 *
 * The vocabulary matches models.dev's effort values so a model's advertised
 * levels can be stored and offered verbatim.
 */
export type ReasoningEffort = 'off' | 'on' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const REASONING_EFFORTS: Array<{ value: ReasoningEffort; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Answer directly, no thinking budget.' },
  { value: 'on', label: 'On', hint: 'Enable thinking; the model decides how much.' },
  { value: 'minimal', label: 'Minimal', hint: 'The least thinking the model accepts.' },
  { value: 'low', label: 'Low', hint: 'A little thinking. Fastest useful setting.' },
  { value: 'medium', label: 'Medium', hint: 'Balanced thinking and latency.' },
  { value: 'high', label: 'High', hint: 'More thorough. Slower and more expensive.' },
  { value: 'xhigh', label: 'Extra high', hint: 'Beyond high, for models that go further.' },
  { value: 'max', label: 'Max', hint: 'Everything the model will spend. Slowest.' }
];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

/** Ladder order, used to snap a stored effort onto whatever a model accepts. */
const REASONING_EFFORT_LADDER: ReasoningEffort[] = ['off', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The menu offered when the catalog says a model reasons but not which levels
 * it accepts. Matches the app's historical five-step ladder.
 */
export const DEFAULT_REASONING_EFFORT_MENU: ReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max'];

/** Deduplicates and orders efforts along the ladder. */
export function sortReasoningEfforts(efforts: Iterable<ReasoningEffort>): ReasoningEffort[] {
  const present = new Set(efforts);
  return REASONING_EFFORT_LADDER.filter((effort) => present.has(effort));
}

/**
 * The effort choices to offer for a model.
 *
 * - No reasoning support → nothing to offer.
 * - `null`/`undefined` levels → the model reasons but the catalog never said
 *   which levels it takes, so fall back to the default ladder.
 * - `[]` → the model always reasons and exposes no control; offer nothing.
 * - Otherwise the model's own levels, in ladder order.
 */
export function resolveReasoningEffortMenu(
  supportsReasoning: boolean | undefined,
  reasoningEfforts: ReasoningEffort[] | null | undefined
): ReasoningEffort[] {
  if (!supportsReasoning) {
    return [];
  }

  if (reasoningEfforts == null) {
    return DEFAULT_REASONING_EFFORT_MENU;
  }

  return REASONING_EFFORT_LADDER.filter((effort) => reasoningEfforts.includes(effort));
}

/**
 * Snaps an effort onto what the model accepts, so switching models never sends
 * a level the provider would reject. `off` outside the menu means the model
 * cannot stop reasoning — take its lowest level. Anything else snaps to the
 * nearest rung, preferring the higher one on a tie.
 */
export function clampReasoningEffort(
  effort: ReasoningEffort,
  allowed: ReasoningEffort[]
): ReasoningEffort | undefined {
  const menu = REASONING_EFFORT_LADDER.filter((entry) => allowed.includes(entry));
  if (menu.length === 0) {
    return undefined;
  }

  if (menu.includes(effort)) {
    return effort;
  }

  if (effort === 'off') {
    return menu[0];
  }

  // A graded request prefers any thinking level over "off". Only a degenerate
  // menu that offers nothing but "off" falls back to it.
  const graded = menu.filter((entry) => entry !== 'off');
  if (graded.length === 0) {
    return menu[0];
  }

  const target = REASONING_EFFORT_LADDER.indexOf(effort);
  let best = graded[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of graded) {
    const index = REASONING_EFFORT_LADDER.indexOf(entry);
    const distance = Math.abs(index - target);
    // Ties break upward: closer-but-stronger beats closer-but-weaker.
    if (distance < bestDistance || (distance === bestDistance && index > REASONING_EFFORT_LADDER.indexOf(best))) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * What the assistant is allowed to do with tools in a turn.
 *
 * - `read-only` withholds the side-effecting tools entirely.
 * - `ask` offers everything but pauses for approval on the risky ones.
 * - `full-access` runs everything without pausing.
 */
export type ToolPermissionMode = 'read-only' | 'ask' | 'full-access';

export const TOOL_PERMISSION_MODES: Array<{
  value: ToolPermissionMode;
  label: string;
  hint: string;
  /** Drives the accent colour: higher means more capability granted. */
  risk: 'low' | 'medium' | 'high';
}> = [
  {
    value: 'read-only',
    label: 'Read only',
    hint: 'Local reads and searches only. No shell, no network fetches.',
    risk: 'low'
  },
  {
    value: 'ask',
    label: 'Ask first',
    hint: 'All tools available; shell and web fetches pause for your approval.',
    risk: 'medium'
  },
  {
    value: 'full-access',
    label: 'Full access',
    hint: 'All tools run without asking. Only use on work you can undo.',
    risk: 'high'
  }
];

export const DEFAULT_TOOL_PERMISSION_MODE: ToolPermissionMode = 'ask';

/**
 * Tools withheld entirely in read-only mode because they reach outside the app.
 *
 * `write_file` and `edit_file` only exist in Code mode, but the ladder is the
 * outer gate: read-only means read-only in either mode.
 */
export const SIDE_EFFECTING_TOOL_NAMES = [
  'bash',
  'web_fetch',
  'web_search',
  'write_file',
  'edit_file',
  'git_commit',
  'git_stash',
  'git_branch',
  'git_push',
  'github_pr_create',
  // Job control acts on processes the conversation started; read-only mode
  // must not be able to list, read, or kill them either.
  'job_output',
  'job_list',
  'job_kill'
] as const;

/** Tools that pause for approval in `ask` mode. */
export const APPROVAL_GATED_TOOL_NAMES = [
  'bash',
  'web_fetch',
  'write_file',
  'edit_file',
  'git_commit',
  'git_stash',
  'git_branch',
  'git_push',
  'github_pr_create'
] as const;

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.some((entry) => entry.value === value);
}

export function isToolPermissionMode(value: unknown): value is ToolPermissionMode {
  return TOOL_PERMISSION_MODES.some((entry) => entry.value === value);
}

export function describeToolPermissionMode(mode: ToolPermissionMode) {
  return TOOL_PERMISSION_MODES.find((entry) => entry.value === mode) ?? TOOL_PERMISSION_MODES[1]!;
}

export function describeReasoningEffort(effort: ReasoningEffort) {
  return (
    REASONING_EFFORTS.find((entry) => entry.value === effort) ??
    REASONING_EFFORTS.find((entry) => entry.value === DEFAULT_REASONING_EFFORT)!
  );
}
