/**
 * How much thinking budget the model should spend before answering. `off` is
 * distinct from "unset": it explicitly disables a thinking mode that a model
 * would otherwise enable by default.
 */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max';

export const REASONING_EFFORTS: Array<{ value: ReasoningEffort; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Answer directly, no thinking budget.' },
  { value: 'low', label: 'Low', hint: 'A little thinking. Fastest useful setting.' },
  { value: 'medium', label: 'Medium', hint: 'Balanced thinking and latency.' },
  { value: 'high', label: 'High', hint: 'More thorough. Slower and more expensive.' },
  { value: 'max', label: 'Max', hint: 'Everything the model will spend. Slowest.' }
];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

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

/** Tools withheld entirely in read-only mode because they reach outside the app. */
export const SIDE_EFFECTING_TOOL_NAMES = ['bash', 'web_fetch', 'web_search'] as const;

/** Tools that pause for approval in `ask` mode. */
export const APPROVAL_GATED_TOOL_NAMES = ['bash', 'web_fetch'] as const;

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
  return REASONING_EFFORTS.find((entry) => entry.value === effort) ?? REASONING_EFFORTS[2]!;
}
