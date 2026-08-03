import { PLAN_TOOL_NAME } from '../../../shared/planTool';

const TOOL_PREVIEW_MAX_CHARS = 900;

/**
 * Diffs get a larger budget because the preview *is* the rendered artifact:
 * the transcript's diff block and the workbench Changes tab both parse it, so
 * truncating at the ordinary limit would silently drop hunks from the UI.
 */
export const DIFF_PREVIEW_MAX_CHARS = 24_000;

/**
 * The plan tool's *input* preview is the rendered artifact for the same reason,
 * and the reload path is where it bites: hydrating a message from
 * `tool_executions` overwrites a part's parsed input with this string, so a
 * plan truncated here comes back as unparseable JSON and the checklist
 * disappears from history.
 */
export const PLAN_PREVIEW_MAX_CHARS = 12_000;

function stringifyValue(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string | null, maxChars = TOOL_PREVIEW_MAX_CHARS) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxChars - 1)}…`;
}

export function normalizeToolInputPreview(value: unknown, options: { toolName?: string | null } = {}) {
  const maxChars =
    (options.toolName ?? '').toLowerCase() === PLAN_TOOL_NAME ? PLAN_PREVIEW_MAX_CHARS : TOOL_PREVIEW_MAX_CHARS;
  return truncate(stringifyValue(value), maxChars);
}

export function normalizeToolOutputPreview(value: unknown, options: { toolName?: string | null } = {}) {
  const maxChars = isDiffProducingTool(options.toolName) ? DIFF_PREVIEW_MAX_CHARS : TOOL_PREVIEW_MAX_CHARS;
  return truncate(stringifyValue(value), maxChars);
}

function isDiffProducingTool(toolName: string | null | undefined) {
  const normalized = (toolName ?? '').toLowerCase();
  return normalized === 'write_file' || normalized === 'edit_file' || normalized === 'git_diff';
}
