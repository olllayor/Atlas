import { createHash } from 'node:crypto';

import type { ModelMessage } from 'ai';

import { pruneModelHistory } from '../compaction/toolResultPruner';
import { estimateMessagesTokens, estimateTextTokens } from '../../../shared/tokenEstimate';
import type { ConversationSummariesRepo } from '../../db/repositories/conversationSummariesRepo';

/**
 * 'standard' and 'aggressive' are the proactive modes; 'maximal' is the last
 * overflow-recovery step, entered only after the provider confirms the prompt
 * is still too long. It keeps just the newest turn raw and leans hardest on
 * the summary — the newest turn is never dropped in any mode.
 */
export type ContextBuildMode = 'standard' | 'aggressive' | 'maximal';

export type ToolSummary = {
  toolName: string;
  purpose: string;
  keyResult: string;
};

/**
 * What the prompt may spend on conversation history.
 *
 * Turn counts alone cannot keep a request inside a context window: ten turns
 * of pasted logs overflow a 32K model, while fifty short turns fit a 200K one
 * with room to spare. The budget is what makes compaction respond to size
 * rather than to arithmetic on turn indices.
 */
export type ContextBudget = {
  /** Context window minus whatever is reserved for the completion. */
  totalTokens: number;
  /** Already committed by the system prompt and tool schemas. */
  reservedTokens: number;
};

export type BuildModelInputArgs = {
  conversationId: string;
  history: ModelMessage[];
  mode: ContextBuildMode;
  /** Omitted when the caller cannot size the window; falls back to turn counts. */
  budget?: ContextBudget;
};

/** What the chosen split costs, for display and for the overflow decision. */
export type ContextUsageBreakdown = {
  /** Raw recent turns actually sent. */
  historyTokens: number;
  /** The summary block appended to the system prompt, if any. */
  addendumTokens: number;
  /** Turns compressed into the summary instead of sent raw. */
  droppedTurnCount: number;
  /** Turns sent verbatim. */
  keptTurnCount: number;
  /**
   * False when even the minimum payload (the newest turn) exceeds the budget —
   * the request will be attempted anyway, since refusing to send is worse than
   * letting the provider decide.
   */
  fitsBudget: boolean;
};

export type BuildModelInputResult = {
  recentMessages: ModelMessage[];
  rollingSummary: string | null;
  toolSummaries: ToolSummary[];
  systemContextAddendum: string | null;
  usage: ContextUsageBreakdown;
};

type ContextManagerHooks = {
  /**
   * Fired when a fresh rolling summary was computed (memory and durable store
   * both missed). Carries the older messages so an async model-backed
   * refresher can upgrade the heuristic summary without re-deriving the split.
   */
  onSummaryRefresh?: (conversationId: string, fingerprint: string, olderMessages: ModelMessage[]) => void;
};

/** The durable summary cache seam; see `ConversationSummariesRepo`. */
export type SummaryStore = Pick<ConversationSummariesRepo, 'get' | 'upsert'>;

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
  maximal: 1,
};

const TOOL_SUMMARY_LIMIT: Record<ContextBuildMode, number> = {
  standard: 8,
  aggressive: 4,
  maximal: 2,
};

const TOOL_PURPOSE_MAX_CHARS: Record<ContextBuildMode, number> = {
  standard: 160,
  aggressive: 96,
  maximal: 80,
};

const TOOL_RESULT_MAX_CHARS: Record<ContextBuildMode, number> = {
  standard: 260,
  aggressive: 140,
  maximal: 100,
};

const CONTEXT_ADDENDUM_MAX_CHARS: Record<ContextBuildMode, number> = {
  standard: 4_200,
  aggressive: 2_200,
  maximal: 1_600,
};

const SUMMARY_SECTION_MAX_ITEMS = 6;

/** One entry per conversation; evicted least-recently-built beyond this cap. */
const MEMORY_CACHE_LIMIT = 50;

export class ContextManager {
  private readonly cache = new Map<string, CachedOlderContext>();

  constructor(
    private readonly hooks: ContextManagerHooks = {},
    private readonly store?: SummaryStore,
  ) {}

  buildModelInput(args: BuildModelInputArgs): BuildModelInputResult {
    const { conversationId, mode, budget } = args;
    // Oversized tool results from older turns keep paying context rent on
    // every request until their turn is compressed away. Prune them to a
    // bounded head/marker/tail on the request copy — the persisted transcript
    // keeps the full result, and pruning is idempotent, so running it on
    // every build is free.
    const history = pruneModelHistory(args.history).messages;
    const split = splitHistoryIntoTurns(history);
    const olderTurnCount = chooseOlderTurnCount(split, mode, budget);

    if (olderTurnCount <= 0) {
      const historyTokens = estimateMessagesTokens(history);
      return {
        recentMessages: history,
        rollingSummary: null,
        toolSummaries: [],
        systemContextAddendum: null,
        usage: {
          historyTokens,
          addendumTokens: 0,
          droppedTurnCount: 0,
          keptTurnCount: split.turns.length,
          fitsBudget: !budget || historyTokens + budget.reservedTokens <= budget.totalTokens,
        },
      };
    }

    const olderTurns = split.turns.slice(0, olderTurnCount);
    const recentTurns = split.turns.slice(olderTurnCount);
    const olderMessages = [...split.prefaceMessages, ...olderTurns.flatMap((turn) => [turn.user, ...turn.followUps])];
    const recentMessages = recentTurns.flatMap((turn) => [turn.user, ...turn.followUps]);
    const fingerprint = buildOlderTurnsFingerprint(olderMessages);

    let cached = this.cache.get(conversationId);
    if (cached && cached.fingerprint !== fingerprint) {
      cached = undefined;
    }

    if (!cached) {
      const fromStore = this.resolveFromStore(conversationId, fingerprint, olderMessages);
      if (fromStore) {
        cached = fromStore;
        this.rememberCached(conversationId, cached, false);
      } else {
        cached = {
          fingerprint,
          rollingSummary: buildRollingSummary(olderTurns, split.prefaceMessages),
          toolSummaries: buildToolSummaries(olderMessages),
        };
        this.rememberCached(conversationId, cached, true);
        // A fresh heuristic summary was computed (memory and durable store both
        // missed). The hook lets an async refresher upgrade it with a model pass.
        this.hooks.onSummaryRefresh?.(conversationId, fingerprint, olderMessages);
      }
    }

    const toolSummaries = compactToolSummariesForMode(cached.toolSummaries, mode);
    const rollingSummary = cached.rollingSummary;
    const systemContextAddendum = buildSystemContextAddendum(rollingSummary, toolSummaries, mode);

    const sentMessages = recentMessages.length > 0 ? recentMessages : history;
    const historyTokens = estimateMessagesTokens(sentMessages);
    const addendumTokens = systemContextAddendum ? estimateTextTokens(systemContextAddendum) : 0;

    return {
      recentMessages: sentMessages,
      rollingSummary,
      toolSummaries,
      systemContextAddendum,
      usage: {
        historyTokens,
        addendumTokens,
        droppedTurnCount: olderTurns.length,
        keptTurnCount: recentTurns.length,
        fitsBudget:
          !budget || historyTokens + addendumTokens + budget.reservedTokens <= budget.totalTokens,
      },
    };
  }

  /**
   * Durable cache lookup. A row is only usable when its fingerprint matches
   * the current older-turn content and its refresh finished ('ready'); a row
   * stuck in 'building' after a crash is treated as absent and recomputed.
   */
  private resolveFromStore(
    conversationId: string,
    fingerprint: string,
    olderMessages: ModelMessage[],
  ): CachedOlderContext | null {
    if (!this.store) {
      return null;
    }

    let row;
    try {
      row = this.store.get(conversationId);
    } catch {
      // The durable cache is an optimisation; a store failure degrades to
      // recomputation, never to a failed request.
      return null;
    }

    if (!row || row.status !== 'ready' || row.fingerprint !== fingerprint) {
      return null;
    }

    return {
      fingerprint,
      rollingSummary: row.rollingSummary || null,
      toolSummaries: buildToolSummaries(olderMessages),
    };
  }

  /**
   * Insertion-ordered memory cache with a hard cap, plus best-effort
   * write-through of freshly computed heuristic summaries so they survive a
   * relaunch. Store hits are not rewritten — that would downgrade a
   * model-generated summary's provenance.
   */
  private rememberCached(conversationId: string, cached: CachedOlderContext, persist: boolean) {
    this.cache.delete(conversationId);
    this.cache.set(conversationId, cached);
    while (this.cache.size > MEMORY_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }

    if (!persist || !this.store || !cached.rollingSummary) {
      return;
    }

    try {
      this.store.upsert({
        conversationId,
        fingerprint: cached.fingerprint,
        rollingSummary: cached.rollingSummary,
        source: 'heuristic',
        status: 'ready',
      });
    } catch {
      // Best effort: the in-memory copy still serves this process.
    }
  }
}

/**
 * How many of the oldest turns to compress rather than send raw.
 *
 * The turn-count ceiling is the floor of this decision, not the whole of it:
 * it caps how much history is *ever* sent verbatim, then the token budget
 * tightens further whenever those turns are individually large. The newest turn
 * is never dropped — a request without the question it is answering is useless,
 * so an oversized final turn goes to the provider and `fitsBudget` reports the
 * overflow instead.
 */
function chooseOlderTurnCount(
  split: { prefaceMessages: ModelMessage[]; turns: ConversationTurn[] },
  mode: ContextBuildMode,
  budget: ContextBudget | undefined
): number {
  const byTurnCount = Math.max(0, split.turns.length - RECENT_TURN_LIMIT[mode]);
  if (!budget) {
    return byTurnCount;
  }

  const available = budget.totalTokens - budget.reservedTokens;
  const turnCosts = split.turns.map((turn) => estimateMessagesTokens([turn.user, ...turn.followUps]));
  const prefaceCost = estimateMessagesTokens(split.prefaceMessages);

  // Summarising costs the addendum, so it only pays off once it displaces more
  // than it adds; reserve its ceiling whenever any turn is being compressed.
  const addendumReserve = Math.ceil(CONTEXT_ADDENDUM_MAX_CHARS[mode] / 3);

  const costFrom = (older: number) => {
    let total = older === 0 ? prefaceCost : 0;
    for (let index = older; index < turnCosts.length; index += 1) {
      total += turnCosts[index] ?? 0;
    }
    return total + (older > 0 ? addendumReserve : 0);
  };

  let older = byTurnCount;
  const maxOlder = Math.max(0, split.turns.length - 1);
  while (older < maxOlder && costFrom(older) > available) {
    older += 1;
  }

  return older;
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
