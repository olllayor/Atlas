import { createHash } from 'node:crypto';

import type { ModelMessage } from 'ai';

export type ContextBuildMode = 'standard' | 'aggressive';

export type ToolSummary = {
  toolName: string;
  purpose: string;
  keyResult: string;
};

export type BuildModelInputArgs = {
  conversationId: string;
  history: ModelMessage[];
  mode: ContextBuildMode;
};

export type BuildModelInputResult = {
  recentMessages: ModelMessage[];
  rollingSummary: string | null;
  toolSummaries: ToolSummary[];
  systemContextAddendum: string | null;
};

type ContextManagerHooks = {
  onSummaryRefresh?: (conversationId: string, fingerprint: string) => void;
};

type CachedOlderContext = {
  fingerprint: string;
  rollingSummary: string | null;
  toolSummaries: ToolSummary[];
};

type ConversationTurn = {
  user: ModelMessage;
  followUps: ModelMessage[];
};

const RECENT_TURN_LIMIT: Record<ContextBuildMode, number> = {
  standard: 10,
  aggressive: 6,
};

const TOOL_SUMMARY_LIMIT: Record<ContextBuildMode, number> = {
  standard: 8,
  aggressive: 4,
};

const TOOL_PURPOSE_MAX_CHARS: Record<ContextBuildMode, number> = {
  standard: 160,
  aggressive: 96,
};

const TOOL_RESULT_MAX_CHARS: Record<ContextBuildMode, number> = {
  standard: 260,
  aggressive: 140,
};

const CONTEXT_ADDENDUM_MAX_CHARS: Record<ContextBuildMode, number> = {
  standard: 4_200,
  aggressive: 2_200,
};

const SUMMARY_SECTION_MAX_ITEMS = 6;

export class ContextManager {
  private readonly cache = new Map<string, CachedOlderContext>();

  constructor(private readonly hooks: ContextManagerHooks = {}) {}

  buildModelInput(args: BuildModelInputArgs): BuildModelInputResult {
    const { conversationId, history, mode } = args;
    const split = splitHistoryIntoTurns(history);
    const recentTurnLimit = RECENT_TURN_LIMIT[mode];

    if (split.turns.length <= recentTurnLimit) {
      return {
        recentMessages: history,
        rollingSummary: null,
        toolSummaries: [],
        systemContextAddendum: null,
      };
    }

    const olderTurnCount = split.turns.length - recentTurnLimit;
    const olderTurns = split.turns.slice(0, olderTurnCount);
    const recentTurns = split.turns.slice(olderTurnCount);
    const olderMessages = [...split.prefaceMessages, ...olderTurns.flatMap((turn) => [turn.user, ...turn.followUps])];
    const recentMessages = recentTurns.flatMap((turn) => [turn.user, ...turn.followUps]);
    const fingerprint = buildOlderTurnsFingerprint(olderMessages);

    let cached = this.cache.get(conversationId);
    if (!cached || cached.fingerprint !== fingerprint) {
      cached = {
        fingerprint,
        rollingSummary: buildRollingSummary(olderTurns, split.prefaceMessages),
        toolSummaries: buildToolSummaries(olderMessages),
      };
      this.cache.set(conversationId, cached);
      this.hooks.onSummaryRefresh?.(conversationId, fingerprint);
    }

    const toolSummaries = compactToolSummariesForMode(cached.toolSummaries, mode);
    const rollingSummary = cached.rollingSummary;
    const systemContextAddendum = buildSystemContextAddendum(rollingSummary, toolSummaries, mode);

    return {
      recentMessages: recentMessages.length > 0 ? recentMessages : history,
      rollingSummary,
      toolSummaries,
      systemContextAddendum,
    };
  }
}

function splitHistoryIntoTurns(history: ModelMessage[]) {
  const prefaceMessages: ModelMessage[] = [];
  const turns: ConversationTurn[] = [];
  let activeTurn: ConversationTurn | null = null;

  for (const message of history) {
    if (message.role === 'user') {
      activeTurn = {
        user: message,
        followUps: [],
      };
      turns.push(activeTurn);
      continue;
    }

    if (!activeTurn) {
      prefaceMessages.push(message);
      continue;
    }

    activeTurn.followUps.push(message);
  }

  return { prefaceMessages, turns };
}

function buildOlderTurnsFingerprint(messages: ModelMessage[]) {
  const digestInput = messages
    .map((message) => `${message.role}:${stringifyForFingerprint(extractMessageText(message, { maxChars: 900 }))}`)
    .join('\n');
  return createHash('sha256').update(digestInput).digest('hex');
}

function buildRollingSummary(olderTurns: ConversationTurn[], prefaceMessages: ModelMessage[]) {
  const goals: string[] = [];
  const decisions: string[] = [];
  const constraints: string[] = [];
  const openLoops: string[] = [];

  if (prefaceMessages.length > 0) {
    const prefaceText = clampText(joinNonEmpty(prefaceMessages.map((message) => extractMessageText(message))), 220);
    if (prefaceText) {
      addUnique(goals, `Initial context: ${prefaceText}`);
    }
  }

  for (const turn of olderTurns) {
    const userText = clampText(extractMessageText(turn.user), 260);
    const followUpText = clampText(joinNonEmpty(turn.followUps.map((message) => extractMessageText(message))), 320);
    if (userText) {
      addUnique(goals, `User asked: ${userText}`);
    }

    if (followUpText) {
      addUnique(decisions, `Assistant response: ${followUpText}`);
    }

    for (const sentence of collectSignals(`${userText} ${followUpText}`)) {
      if (isConstraintSentence(sentence)) {
        addUnique(constraints, sentence);
      }
      if (isOpenLoopSentence(sentence)) {
        addUnique(openLoops, sentence);
      }
      if (isDecisionSentence(sentence)) {
        addUnique(decisions, sentence);
      }
    }
  }

  if (goals.length === 0 && decisions.length === 0 && constraints.length === 0 && openLoops.length === 0) {
    return null;
  }

  return [
    'Goals:',
    ...toBullets(goals),
    '',
    'Decisions:',
    ...toBullets(decisions),
    '',
    'Constraints:',
    ...toBullets(constraints),
    '',
    'Open loops:',
    ...toBullets(openLoops),
  ].join('\n');
}

function toBullets(items: string[]) {
  const limited = items
    .map((item) => clampText(cleanWhitespace(item), 260))
    .filter((item) => item.length > 0)
    .slice(0, SUMMARY_SECTION_MAX_ITEMS);
  if (limited.length === 0) {
    return ['- none captured'];
  }
  return limited.map((item) => `- ${item}`);
}

function buildToolSummaries(messages: ModelMessage[]): ToolSummary[] {
  const summaries: ToolSummary[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    const entries = extractToolEntries(message);
    for (const entry of entries) {
      const summary: ToolSummary = {
        toolName: cleanWhitespace(entry.toolName || 'tool'),
        purpose: inferToolPurpose(entry.input),
        keyResult: summarizeToolResult(entry.output),
      };
      const dedupeKey = `${summary.toolName}|${summary.purpose}|${summary.keyResult}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      summaries.push(summary);
      if (summaries.length >= 24) {
        return summaries;
      }
    }
  }

  return summaries;
}

function compactToolSummariesForMode(toolSummaries: ToolSummary[], mode: ContextBuildMode) {
  const countLimit = TOOL_SUMMARY_LIMIT[mode];
  const purposeLimit = TOOL_PURPOSE_MAX_CHARS[mode];
  const resultLimit = TOOL_RESULT_MAX_CHARS[mode];

  return toolSummaries.slice(0, countLimit).map((summary) => ({
    toolName: clampText(cleanWhitespace(summary.toolName), 80),
    purpose: clampText(cleanWhitespace(summary.purpose), purposeLimit),
    keyResult: clampText(cleanWhitespace(summary.keyResult), resultLimit),
  }));
}

function buildSystemContextAddendum(
  rollingSummary: string | null,
  toolSummaries: ToolSummary[],
  mode: ContextBuildMode,
) {
  if (!rollingSummary && toolSummaries.length === 0) {
    return null;
  }

  const lines: string[] = ['ContextManager memory for older turns. Treat this as background context and prioritize recent raw turns for exact wording.'];

  if (rollingSummary) {
    lines.push('', 'Rolling summary (older turns):', rollingSummary);
  }

  if (toolSummaries.length > 0) {
    lines.push('', 'Compressed tool outcomes (older turns):');
    toolSummaries.forEach((summary, index) => {
      lines.push(
        `${index + 1}. ${summary.toolName} | purpose: ${summary.purpose} | key result: ${summary.keyResult}`,
      );
    });
  }

  return clampText(lines.join('\n'), CONTEXT_ADDENDUM_MAX_CHARS[mode]);
}

function extractToolEntries(message: ModelMessage) {
  const entries: Array<{ toolName: string; input: unknown; output: unknown }> = [];
  const record = asRecord(message);
  const role = typeof record.role === 'string' ? record.role : '';
  const content = record.content;

  if (Array.isArray(content)) {
    for (const item of content) {
      const part = asRecord(item);
      const type = typeof part.type === 'string' ? part.type : '';
      const hasToolSignal = type.includes('tool') || typeof part.toolName === 'string' || typeof part.toolCallId === 'string';
      if (!hasToolSignal) {
        continue;
      }

      entries.push({
        toolName: pickFirstString(part.toolName, part.name, part.tool, 'tool'),
        input: firstDefined(part.input, part.args, part.arguments),
        output: firstDefined(part.output, part.result, part.error, part.content),
      });
    }
  }

  if (entries.length === 0 && role === 'tool') {
    entries.push({
      toolName: pickFirstString(record.name, record.toolName, 'tool'),
      input: undefined,
      output: content,
    });
  }

  return entries.filter((entry) => {
    const hasPurpose = cleanWhitespace(inferToolPurpose(entry.input)).length > 0;
    const hasResult = cleanWhitespace(summarizeToolResult(entry.output)).length > 0;
    return hasPurpose || hasResult;
  });
}

function inferToolPurpose(input: unknown) {
  const inputRecord = asRecord(input);
  if (typeof inputRecord.query === 'string' && inputRecord.query.trim()) {
    return clampText(`search for "${cleanWhitespace(inputRecord.query)}"`, 180);
  }
  if (typeof inputRecord.command === 'string' && inputRecord.command.trim()) {
    return clampText(`run command "${cleanWhitespace(inputRecord.command)}"`, 180);
  }
  if (typeof inputRecord.id === 'string' && inputRecord.id.trim()) {
    return clampText(`lookup id "${cleanWhitespace(inputRecord.id)}"`, 180);
  }

  const normalized = normalizeUnknown(input, 200);
  if (normalized) {
    return `input: ${normalized}`;
  }

  return 'execute tool call';
}

function summarizeToolResult(output: unknown) {
  const outputRecord = asRecord(output);
  if (typeof outputRecord.errorText === 'string' && outputRecord.errorText.trim()) {
    return clampText(`error: ${cleanWhitespace(outputRecord.errorText)}`, 280);
  }
  if (typeof outputRecord.message === 'string' && outputRecord.message.trim()) {
    return clampText(cleanWhitespace(outputRecord.message), 280);
  }
  if (typeof outputRecord.text === 'string' && outputRecord.text.trim()) {
    return clampText(cleanWhitespace(outputRecord.text), 280);
  }

  const normalized = normalizeUnknown(output, 280);
  if (normalized) {
    return normalized;
  }

  return 'completed without detailed output';
}

function extractMessageText(message: ModelMessage, options: { maxChars?: number } = {}) {
  const { maxChars = 360 } = options;
  const content = asRecord(message).content;
  const text = extractContentText(content);
  return clampText(text, maxChars);
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') {
    return cleanWhitespace(content);
  }

  if (Array.isArray(content)) {
    const segments: string[] = [];
    for (const item of content) {
      const part = asRecord(item);
      const type = typeof part.type === 'string' ? part.type : '';
      if (type === 'text' && typeof part.text === 'string') {
        segments.push(cleanWhitespace(part.text));
        continue;
      }
      if (type === 'file') {
        const filename = typeof part.filename === 'string' && part.filename ? part.filename : 'attachment';
        const mediaType = typeof part.mediaType === 'string' ? part.mediaType : 'file';
        segments.push(`[file ${filename} (${mediaType})]`);
        continue;
      }
      if (type.includes('tool') || typeof part.toolName === 'string') {
        const toolName = pickFirstString(part.toolName, part.name, 'tool');
        const input = normalizeUnknown(firstDefined(part.input, part.args, part.arguments), 140);
        const output = normalizeUnknown(firstDefined(part.output, part.result), 160);
        const fragments = [`[tool ${toolName}]`];
        if (input) {
          fragments.push(`input=${input}`);
        }
        if (output) {
          fragments.push(`output=${output}`);
        }
        segments.push(fragments.join(' '));
        continue;
      }

      const fallback = normalizeUnknown(part, 200);
      if (fallback) {
        segments.push(fallback);
      }
    }
    return cleanWhitespace(segments.join(' '));
  }

  return normalizeUnknown(content, 240);
}

function stringifyForFingerprint(value: string) {
  if (!value) {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function collectSignals(text: string) {
  const normalized = cleanWhitespace(text);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanWhitespace(sentence))
    .filter(Boolean)
    .slice(0, 14);
}

function isConstraintSentence(sentence: string) {
  const lower = sentence.toLowerCase();
  return (
    lower.includes('must ') ||
    lower.includes('must not') ||
    lower.includes('do not') ||
    lower.includes("don't ") ||
    lower.includes('only ') ||
    lower.includes('without ') ||
    lower.includes('limit') ||
    lower.includes('bounded')
  );
}

function isOpenLoopSentence(sentence: string) {
  const lower = sentence.toLowerCase();
  return sentence.endsWith('?') || lower.includes('pending') || lower.includes('follow up') || lower.includes('next step');
}

function isDecisionSentence(sentence: string) {
  const lower = sentence.toLowerCase();
  return (
    lower.includes('recommend') ||
    lower.includes('ship') ||
    lower.includes('we will') ||
    lower.includes('choose') ||
    lower.includes('use ')
  );
}

function normalizeUnknown(value: unknown, maxChars: number): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return clampText(cleanWhitespace(value), maxChars);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Uint8Array) {
    return `[binary ${value.byteLength} bytes]`;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, 4)
      .map((item) => normalizeUnknown(item, Math.floor(maxChars / 2)))
      .filter(Boolean);
    return clampText(items.join(', '), maxChars);
  }

  const record = asRecord(value);
  const keys = Object.keys(record).sort().slice(0, 10);
  const shaped: Record<string, string> = {};
  for (const key of keys) {
    if (key === 'data') {
      shaped[key] = '[omitted]';
      continue;
    }
    shaped[key] = normalizeUnknown(record[key], 120);
  }

  return clampText(cleanWhitespace(JSON.stringify(shaped)), maxChars);
}

function firstDefined<T>(...items: T[]): T | undefined {
  for (const item of items) {
    if (item !== undefined) {
      return item;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}

function pickFirstString(...items: unknown[]) {
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) {
      return cleanWhitespace(item);
    }
  }
  return '';
}

function cleanWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function clampText(value: string, maxChars: number) {
  const normalized = cleanWhitespace(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function joinNonEmpty(values: string[]) {
  return values
    .map((value) => cleanWhitespace(value))
    .filter((value) => value.length > 0)
    .join(' ');
}

function addUnique(target: string[], value: string) {
  const normalized = cleanWhitespace(value);
  if (!normalized) {
    return;
  }
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
}
