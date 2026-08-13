export type FormattedToolError = {
  code: string;
  summary: string;
  technicalDetails?: string;
  nextStep?: string;
};

function normalizeText(value: unknown) {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value ?? '').trim();
}

export function formatToolError(error: unknown): FormattedToolError {
  const raw = normalizeText(error);
  const lower = raw.toLowerCase();

  if (!raw) {
    return {
      code: 'unknown',
      summary: "Couldn't complete the tool request.",
      nextStep: 'Try again.',
    };
  }

  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('missing')) {
    return {
      code: 'not_found',
      summary: "Couldn't find the requested file or resource.",
      technicalDetails: raw,
      nextStep: 'Verify the path or identifier and try again.',
    };
  }

  if (lower.includes('eacces') || lower.includes('permission') || lower.includes('denied')) {
    return {
      code: 'permission',
      summary: 'Tool execution was blocked by permissions.',
      technicalDetails: raw,
      nextStep: 'Approve the request or choose a different action.',
    };
  }

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return {
      code: 'timeout',
      summary: 'The tool took too long to finish.',
      technicalDetails: raw,
      nextStep: 'Try again with a narrower request.',
    };
  }

  if (lower.includes('network') || lower.includes('fetch') || lower.includes('econn') || lower.includes('dns')) {
    return {
      code: 'network',
      summary: 'Network access failed while running the tool.',
      technicalDetails: raw,
      nextStep: 'Check connectivity and retry.',
    };
  }

  if (lower.includes('provider') || lower.includes('model') || lower.includes('invalid tool result')) {
    return {
      code: 'provider',
      summary: 'The model provider returned an invalid tool response.',
      technicalDetails: raw,
      nextStep: 'Retry the request or switch to another model.',
    };
  }

  return {
    code: 'unknown',
    summary: "Couldn't complete the tool request.",
    technicalDetails: raw,
    nextStep: 'Try again.',
  };
}

export function formatToolErrorMessage(error: unknown) {
  const formatted = formatToolError(error);
  if (formatted.technicalDetails) {
    return `${formatted.summary}\n${formatted.technicalDetails}${formatted.nextStep ? `\n${formatted.nextStep}` : ''}`;
  }

  return `${formatted.summary}${formatted.nextStep ? `\n${formatted.nextStep}` : ''}`;
}
