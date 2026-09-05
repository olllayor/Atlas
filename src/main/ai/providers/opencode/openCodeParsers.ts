/**
 * Pure parsing helpers for the OpenCode runtime — kept dependency-free so the
 * full behavior matrix can be tested without spawning anything.
 *
 * Blueprint: pingdotgg/t3code `apps/server/src/provider/opencodeRuntime.ts`
 * (constants L51-54, `parseServerUrlFromOutput` L188-197).
 */

export const OPENCODE_SERVER_READY_PREFIX = 'opencode server listening';
export const OPENCODE_SERVER_STARTUP_TIMEOUT_MS = 30_000;
export const OPENCODE_DEFAULT_HOSTNAME = '127.0.0.1';

/**
 * Extract the listening URL from a `opencode serve` stdout stream.
 *
 * The CLI announces readiness with exactly one line of the shape:
 *
 *     opencode server listening on http://127.0.0.1:<port>
 *
 * We scan accumulated output line-by-line (t3code parity): any number of
 * non-ready log lines may precede the announcement, and partial chunks mean
 * a match can appear only after enough bytes arrived — callers simply re-run
 * this over the growing buffer.
 */
export function parseOpenCodeServerUrlFromOutput(output: string): string | null {
  for (const line of output.split('\n')) {
    if (!line.startsWith(OPENCODE_SERVER_READY_PREFIX)) {
      continue;
    }
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
    return match?.[1] ?? null;
  }
  return null;
}

/**
 * Parse `<binary> --version` output down to its first semver-looking token.
 * Mirrors t3code's `parseGenericCliVersion` semantics loosely: first token of
 * any whitespace-split word that looks like MAJOR.MINOR[.PATCH][-suffix].
 */
const SEMVER_TOKEN_PATTERN = /\b(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\b/;

export function parseOpenCodeVersionOutput(stdout: string): string | null {
  const match = SEMVER_TOKEN_PATTERN.exec(stdout);
  return match?.[1] ?? null;
}

/**
 * Compare two dotted numeric versions (-pre suffix tolerated). Returns a
 * negative number when `left` is older than `right` (same contract as
 * t3code's compareSemverVersions for our use: floor enforcement).
 */
export function compareOpenCodeVersions(left: string, right: string): number {
  const core = (v: string) => v.split('-')[0] ?? '';
  const leftParts = core(left).split('.');
  const rightParts = core(right).split('.');
  const width = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < width; index += 1) {
    const l = Number.parseInt(leftParts[index] ?? '0', 10) || 0;
    const r = Number.parseInt(rightParts[index] ?? '0', 10) || 0;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Split a user-typed launch-arguments string into argv entries.
 *
 * Supports single/double-quoted segments so a flag value with spaces
 * (`--title "my title"`) survives as one argument; otherwise splits on
 * whitespace. Not a full shell parser — no escapes, no nesting — the same
 * ceiling t3code's launch-args field draws.
 */
export function splitLaunchArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const matches = trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) =>
    (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))
      ? token.slice(1, -1)
      : token
  );
}

/** Flatten stderr/stdout tails into an actionable error detail (bounded). */
export function summarizeProcessFailure(input: {
  readonly exitCode: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
}): string {
  const parts: string[] = [];
  if (input.signal) {
    parts.push(`terminated by ${input.signal}`);
  } else {
    parts.push(`exit code ${input.exitCode ?? '?'}`);
  }
  const clean = (value: string | undefined) => value?.trim().slice(-400) || '';
  const stderr = clean(input.stderrTail);
  const stdout = clean(input.stdoutTail);
  if (stderr) parts.push(`stderr:\n${stderr}`);
  if (stdout && !stderr) parts.push(`stdout:\n${stdout}`);
  return parts.join('\n\n');
}

export type OpenCodePermissionAction = 'allow' | 'ask' | 'deny';

export interface OpenCodePermissionRule {
  readonly permission: string;
  readonly pattern: string;
  readonly action: OpenCodePermissionAction;
}

export type OpenCodePermissionRuleset = OpenCodePermissionRule[];

/**
 * Builds OpenCode session permission rules based on Atlas tool permission mode.
 *
 * Blueprint: pingdotgg/t3code `apps/server/src/provider/opencodeRuntime.ts:483-520`.
 *
 * Under 'full-access': pre-approves everything + external directories.
 * Under 'auto-accept-edits': auto-approves edits, asks for everything else.
 * Otherwise (supervised / ask / default): asks for bash, edit, web, doom_loop, etc.
 * Question asking permission is always 'allow' in supervised modes so opencode can ask questions.
 */
export function buildOpenCodePermissionRules(
  runtimeMode?: string | null
): OpenCodePermissionRuleset {
  if (runtimeMode === 'full-access') {
    return [
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'external_directory', pattern: '*', action: 'allow' }
    ];
  }

  const editAction = runtimeMode === 'auto-accept-edits' ? 'allow' : 'ask';

  return [
    { permission: '*', pattern: '*', action: 'ask' },
    { permission: 'bash', pattern: '*', action: 'ask' },
    { permission: 'edit', pattern: '*', action: editAction },
    { permission: 'webfetch', pattern: '*', action: 'ask' },
    { permission: 'websearch', pattern: '*', action: 'ask' },
    { permission: 'codesearch', pattern: '*', action: 'ask' },
    { permission: 'external_directory', pattern: '*', action: 'ask' },
    { permission: 'doom_loop', pattern: '*', action: 'ask' },
    { permission: 'question', pattern: '*', action: 'allow' }
  ];
}

export interface OpenCodeQuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface OpenCodeNormalizedQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: readonly OpenCodeQuestionOption[];
  readonly multiSelect?: boolean;
  readonly custom?: boolean;
}

export interface OpenCodeQuestionRequest {
  readonly id: string;
  readonly sessionID: string;
  readonly questions: readonly OpenCodeNormalizedQuestion[];
  readonly tool?: {
    readonly messageID?: string;
    readonly callID?: string;
  };
}

export function openCodeQuestionId(
  index: number,
  question: { readonly header: string; readonly question: string }
): string {
  const header = question.header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  return header.length > 0 ? `question-${index}-${header}` : `question-${index}`;
}

export function normalizeQuestionRequest(
  request: Record<string, unknown>
): OpenCodeNormalizedQuestion[] {
  const questions = Array.isArray(request.questions) ? request.questions : [];
  return questions.map((q, index) => {
    const record = typeof q === 'object' && q !== null ? (q as Record<string, unknown>) : {};
    const header = typeof record.header === 'string' ? record.header : '';
    const questionText = typeof record.question === 'string' ? record.question : '';
    const optionsRaw = Array.isArray(record.options) ? record.options : [];
    const options = optionsRaw.map((opt) => {
      const optRecord = typeof opt === 'object' && opt !== null ? (opt as Record<string, unknown>) : {};
      return {
        label: typeof optRecord.label === 'string' ? optRecord.label : '',
        ...(typeof optRecord.description === 'string' ? { description: optRecord.description } : {})
      };
    });
    return {
      id: openCodeQuestionId(index, { header, question: questionText }),
      header,
      question: questionText,
      options,
      ...(record.multiple === true ? { multiSelect: true } : {}),
      ...(record.custom === true ? { custom: true } : {})
    };
  });
}

export function toOpenCodeQuestionAnswers(
  questions: readonly OpenCodeNormalizedQuestion[],
  answers: Record<string, unknown>
): string[][] {
  return questions.map((question, index) => {
    const raw =
      answers[question.id] ??
      answers[question.header] ??
      answers[question.question] ??
      answers[`question-${index}`];
    if (Array.isArray(raw)) {
      return raw.filter((value): value is string => typeof value === 'string');
    }
    if (typeof raw === 'string') {
      return raw.trim().length > 0 ? [raw] : [];
    }
    return [];
  });
}
