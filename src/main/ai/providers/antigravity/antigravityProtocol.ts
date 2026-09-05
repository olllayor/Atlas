/**
 * Antigravity ACP protocol helpers, ported from t3code PR #9348
 * (`apps/server/src/provider/acp/AntigravityProtocol.ts`).
 *
 * - `interaction_*` permission requests are user questions, not approvals;
 * - `agy.security.warning` on "allow always" surfaces on the thread option;
 * - tool payloads are bounded before they enter the event stream.
 */

export interface AntigravityPermissionOption {
  readonly optionId: string;
  readonly kind: string;
  readonly name: string;
  readonly meta?: Record<string, unknown>;
}

export interface AntigravityPermissionRequest {
  readonly toolCallId: string;
  readonly title?: string;
  readonly options: readonly AntigravityPermissionOption[];
}

export type AntigravityApprovalDecision = 'accept' | 'decline' | 'cancel' | 'acceptForSession';

export interface AntigravityApprovalOption {
  readonly decision: AntigravityApprovalDecision;
  readonly label: string;
  readonly warning?: string;
}

export interface AntigravityUserInputOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export interface AntigravityUserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly multiSelect: boolean;
  readonly allowCustomAnswer: boolean;
  readonly options: readonly AntigravityUserInputOption[];
}

const TOOL_TEXT_LIMIT = 8_000;
const TOOL_TEXT_TRUNCATED = '[Earlier output truncated]\n\n';
const QUESTION_LABEL_LIMIT = 512;
const WARNING_TEXT_LIMIT = 512;
const SECURITY_WARNING_META_KEY = 'agy.security.warning';

/** Native questions share the permission method, but choices are not approvals. */
export function isAntigravityUserInputRequest(request: AntigravityPermissionRequest): boolean {
  return request.toolCallId.startsWith('interaction_');
}

export function selectAntigravityPermissionOptionId(
  request: AntigravityPermissionRequest,
  decision: 'accept' | 'decline' | 'acceptForSession' | 'cancel'
): string | undefined {
  if (decision === 'cancel' || isAntigravityUserInputRequest(request)) {
    return undefined;
  }
  const kind =
    decision === 'accept' ? 'allow_once' : decision === 'decline' ? 'reject_once' : 'allow_always';
  const option = request.options.find((entry) => entry.kind === kind);
  return option?.optionId.trim() ? option.optionId : undefined;
}

/** Copy bounded text so V8 cannot retain the original large string. */
function copyBoundedText(text: string): string {
  return Buffer.from(text, 'utf16le').toString('utf16le');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The agent marks "Allow Always" with a prompt-injection warning in `_meta`.
 * Surface it as option text so clients can show it.
 */
export function antigravitySecurityWarning(
  option: AntigravityPermissionOption
): string | undefined {
  const meta = option.meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const warning = asRecord((meta as Record<string, unknown>)[SECURITY_WARNING_META_KEY]);
  if (Object.keys(warning).length === 0) return undefined;
  const message = typeof warning.message === 'string' ? warning.message.trim() : '';
  const title = typeof warning.title === 'string' ? warning.title.trim() : '';
  const text = message || title;
  if (!text) return undefined;
  return text.length > WARNING_TEXT_LIMIT
    ? copyBoundedText(`${text.slice(0, WARNING_TEXT_LIMIT - 3)}...`)
    : text;
}

/** Only advertise decisions the native request can honor. */
export function antigravityApprovalOptions(
  request: AntigravityPermissionRequest
): readonly AntigravityApprovalOption[] {
  if (isAntigravityUserInputRequest(request)) return [];
  const options: AntigravityApprovalOption[] = [];
  const withKind = (kind: string) =>
    request.options.find((entry) => entry.kind === kind && entry.optionId.trim());
  if (withKind('allow_once')) {
    options.push({ decision: 'accept', label: 'Allow once' });
  }
  const always = withKind('allow_always');
  if (always) {
    const warning = antigravitySecurityWarning(always);
    options.push({
      decision: 'acceptForSession',
      label: 'Allow for this thread',
      ...(warning ? { warning } : {})
    });
  }
  if (withKind('reject_once')) {
    options.push({ decision: 'decline', label: 'Deny' });
  }
  options.push({ decision: 'cancel', label: 'Cancel' });
  return options;
}

function questionLabel(option: AntigravityPermissionOption): string {
  const label = option.name.trim() || option.optionId;
  return label.length > QUESTION_LABEL_LIMIT
    ? copyBoundedText(`${label.slice(0, QUESTION_LABEL_LIMIT - 3)}...`)
    : label;
}

function boundText(text: string, limit = TOOL_TEXT_LIMIT): string {
  return text.length <= limit ? text : copyBoundedText(`${TOOL_TEXT_TRUNCATED}${text.slice(-limit)}`);
}

export function extractAntigravityUserInputQuestion(
  request: AntigravityPermissionRequest
): AntigravityUserInputQuestion | undefined {
  if (!isAntigravityUserInputRequest(request) || request.options.length === 0) {
    return undefined;
  }
  const ids = new Set<string>();
  for (const option of request.options) {
    if (!option.optionId.trim() || ids.has(option.optionId)) {
      return undefined;
    }
    ids.add(option.optionId);
  }
  const raw = request.title?.trim() || 'Choose an option.';
  return {
    id: request.toolCallId,
    header: 'Question',
    question: boundText(raw),
    multiSelect: false,
    allowCustomAnswer: false,
    options: request.options.map((option) => ({
      value: option.optionId,
      label: questionLabel(option),
      description: questionLabel(option)
    }))
  };
}

/**
 * Map a user answer to the ACP `selected` outcome. Returns undefined for an
 * invalid answer so the adapter keeps the question open. Submits option
 * values, not display labels (with a single-label fallback for old clients).
 */
export function makeAntigravityUserInputResponse(
  request: AntigravityPermissionRequest,
  answers: Record<string, string | readonly string[]>
): { outcome: { outcome: 'selected'; optionId: string } } | undefined {
  if (extractAntigravityUserInputQuestion(request) === undefined) {
    return undefined;
  }
  const raw = answers[request.toolCallId];
  const value = typeof raw === 'string' ? raw : raw?.[0];
  if (value === undefined) {
    return undefined;
  }
  const exact = request.options.find((option) => option.optionId === value);
  if (exact) {
    return { outcome: { outcome: 'selected', optionId: exact.optionId } };
  }
  const matching = request.options.filter((option) => questionLabel(option) === value);
  const option = matching.length === 1 ? matching[0] : undefined;
  return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : undefined;
}

interface ToolPayloadBudget {
  nodes: number;
  text: number;
}

function sanitizeToolValue(value: unknown, budget: ToolPayloadBudget, depth: number): unknown {
  if (depth > 12 || budget.nodes-- <= 0) {
    return undefined;
  }
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value) || budget.text <= 0) {
      return undefined;
    }
    const text = boundText(value, Math.min(TOOL_TEXT_LIMIT, budget.text));
    budget.text -= text.length;
    return text;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const entry of value) {
      if (budget.nodes <= 0) break;
      const sanitized = sanitizeToolValue(entry, budget, depth + 1);
      if (sanitized !== undefined) result.push(sanitized);
    }
    return result;
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const entries: Array<readonly [string, unknown]> = [];
  for (const [key, entry] of Object.entries(record)) {
    if (budget.nodes <= 0) break;
    if (
      (record.type === 'image' && (key === 'data' || key === 'blob')) ||
      (key === 'blob' && typeof record.mimeType === 'string' && record.mimeType.startsWith('image/')) ||
      ((key === 'formatted_output' || key === 'formattedOutput') &&
        (entry === record.combinedOutput || entry === record.combined_output))
    ) {
      continue;
    }
    const sanitized = sanitizeToolValue(entry, budget, depth + 1);
    if (sanitized !== undefined) entries.push([key, sanitized]);
  }
  return Object.fromEntries(entries);
}

/** Bound both retained raw events and display data before the event stream. */
export function sanitizeAntigravityToolPayload(payload: unknown): unknown {
  return sanitizeToolValue(payload, { nodes: 512, text: 64_000 }, 0);
}
