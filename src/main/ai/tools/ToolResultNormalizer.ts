const TOOL_PREVIEW_MAX_CHARS = 900;

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

function truncate(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= TOOL_PREVIEW_MAX_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, TOOL_PREVIEW_MAX_CHARS - 1)}…`;
}

export function normalizeToolInputPreview(value: unknown) {
  return truncate(stringifyValue(value));
}

export function normalizeToolOutputPreview(value: unknown) {
  return truncate(stringifyValue(value));
}
