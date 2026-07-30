const TOOL_PREVIEW_MAX_CHARS = 900;

/**
 * Diffs get a larger budget because the preview *is* the rendered artifact:
 * the transcript's diff block and the workbench Changes tab both parse it, so
 * truncating at the ordinary limit would silently drop hunks from the UI.
 */
export const DIFF_PREVIEW_MAX_CHARS = 24_000;

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

export function normalizeToolInputPreview(value: unknown) {
  return truncate(stringifyValue(value));
}

export function normalizeToolOutputPreview(value: unknown, options: { toolName?: string | null } = {}) {
  const maxChars = isDiffProducingTool(options.toolName) ? DIFF_PREVIEW_MAX_CHARS : TOOL_PREVIEW_MAX_CHARS;
  return truncate(stringifyValue(value), maxChars);
}

function isDiffProducingTool(toolName: string | null | undefined) {
  const normalized = (toolName ?? '').toLowerCase();
  return normalized === 'write_file' || normalized === 'edit_file' || normalized === 'git_diff';
}
