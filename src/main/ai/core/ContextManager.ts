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
  /**
   * Per-turn dynamic context, derived from one turn's own persisted user text.
   *
   * The model-visible snapshot (e.g. invoked-`@plugin` instructions) is placed
   * immediately AFTER that turn's user message and before its reply — the same
   * cache-safe position dsh uses for pre-step injections. Derivation must be a
   * pure function of the text plus slowly-changing registry state: identical
   * input must yield identical bytes on every rebuild, because anything else
   * re-keys the provider's prefix cache from that turn onward. Returns null
   * for turns needing no snapshot, which then contribute nothing and shift
   * nothing.
   */
  turnSnapshot?: (userText: string) => string | null;
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
  /**
   * Exactly what goes on the wire: the kept turns, with the compaction
   * handoff message — when one exists — inserted between the preface and the
   * first kept turn.
   *
   * The handoff rides *in the history* rather than in the system prompt on
   * purpose. A summary that changes every turn, injected at position 0 of the
   * request, re-key's the provider's prompt cache on the whole conversation
   * every time the older-turn boundary shifts; placed after the raw history,
   * everything before it stays byte-identical and cacheable, and only the
   * tail re-pays.
   */
  recentMessages: ModelMessage[];
  rollingSummary: string | null;
  toolSummaries: ToolSummary[];
  /** The handoff text itself, for display and token accounting. */
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

/**
 * The last compaction decision per conversation.
 *
 * Reused across builds so the handoff message stays byte-stable while nothing
 * forces a change — which is what lets the provider's prompt cache cover
 * everything above the handoff instead of re-reading the conversation every
 * turn (dsh's summarize-once-until-pressure shape).
 */
type StickyBoundary = {
  mode: ContextBuildMode;
  olderCount: number;
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

/**
 * Compaction fires here, not at 100% (dsh's `thresholdRatio`, tuned up from
 * their 0.8 because Atlas's budget already reserves the completion).
 *
 * Waiting for the window to actually overflow means the turn that crosses the
 * line pays for an emergency compression mid-request and the *next* user
 * message starts with no headroom at all. Walking the boundary at 85% keeps
 ~15% of the window free for the reply and the question after it, and the
 * boundary then re-sticks — so the cost is paid once, not every turn.
 */
const PRESSURE_RATIO = 0.85;

export class ContextManager {
  private readonly cache = new Map<string, CachedOlderContext>();
  /** Keyed by conversation *and* mode: a retry-ladder escalation must not
   * clobber the boundary the provider's cache is warm for. */
  private readonly boundaries = new Map<string, StickyBoundary>();
  /** Conversations whose next build must re-split from zero (`requestForcedCompaction`). */
  private readonly forcedCompactions = new Set<string>();

  constructor(
    private readonly hooks: ContextManagerHooks = {},
    private readonly store?: SummaryStore,
  ) {}

  buildModelInput(args: BuildModelInputArgs): BuildModelInputResult {
    const { conversationId, mode, budget, turnSnapshot } = args;
    // Oversized tool results from older turns keep paying context rent on
    // every request until their turn is compressed away. Prune them to a
    // bounded head/marker/tail on the request copy — the persisted transcript
    // keeps the full result, and pruning is idempotent, so running it on
    // every build is free.
    const history = pruneModelHistory(args.history).messages;
    const split = splitHistoryIntoTurns(history);
    const olderTurnCount = this.chooseOlderTurnCountSticky(conversationId, split, mode, budget);

    if (olderTurnCount <= 0) {
      const recentMessages = assembleWireTurns(split, 0, turnSnapshot);
      const historyTokens = estimateMessagesTokens(recentMessages);
      return {
        recentMessages,
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

    // Shrink guard (dsh compacts only when the summary is strictly smaller
    // than what it replaces): a heuristic summary that costs as much as the
    // turns it drops is not compression — it is lossy at full price. Sending
    // the raw turns is strictly better, so the split is reverted for this
    // build. The sticky boundary is deliberately left where it is: the guard
    // is deterministic given the same history, so every build here reaches
    // the same revert, and pressure re-checks from this position next time.
    const addendumTokens = systemContextAddendum ? estimateTextTokens(systemContextAddendum) : 0;
    if (systemContextAddendum && addendumTokens >= estimateMessagesTokens(olderMessages)) {
      const recentMessages = assembleWireTurns(split, 0, turnSnapshot);
      const historyTokens = estimateMessagesTokens(recentMessages);
      return {
        recentMessages,
        rollingSummary: null,
        toolSummaries: [],
        systemContextAddendum: null,
        usage: {
          historyTokens,
          addendumTokens: 0,
          droppedTurnCount: 0,
          keptTurnCount: split.turns.length,
          fitsBudget:
            !budget || historyTokens + budget.reservedTokens <= budget.totalTokens,
        },
      };
    }

    // The handoff is a positioned history message: after any preface (which it
    // also summarizes), before the first kept turn. Deterministic given
    // (fingerprint, mode), so identical requests carry identical bytes and the
    // provider's prefix cache survives everything above this point.
    const keptMessages = assembleWireTurns(split, olderTurnCount, turnSnapshot);
    const handoffMessage: ModelMessage | null = systemContextAddendum
      ? { role: 'user', content: systemContextAddendum }
      : null;
    const recentMessages =
      handoffMessage && split.prefaceMessages.length > 0
        ? [...split.prefaceMessages, handoffMessage, ...keptMessages]
        : handoffMessage
          ? [handoffMessage, ...keptMessages]
          : keptMessages;

    const historyTokens = estimateMessagesTokens(keptMessages);
    const finalAddendumTokens = systemContextAddendum ? estimateTextTokens(systemContextAddendum) : 0;

    return {
      recentMessages,
      rollingSummary,
      toolSummaries,
      systemContextAddendum,
      usage: {
        historyTokens,
        addendumTokens: finalAddendumTokens,
        droppedTurnCount: olderTurns.length,
        keptTurnCount: recentTurns.length,
        fitsBudget:
          !budget || historyTokens + finalAddendumTokens + budget.reservedTokens <= budget.totalTokens,
      },
    };
  }

  /**
   * How many of the oldest turns to compress rather than send raw — sticky
   * edition.
   *
   * The first decision for a conversation is the old cost-based one. After
   * that, the boundary is frozen: appending turns never moves it, so the
   * handoff bytes (and everything above them) stay identical and the
   * provider's prefix cache keeps hitting. The boundary only moves under
   * pressure — the kept slice has eaten into the headroom (85% of what is
   * available, not 100% of it) — or when a retry escalation switches mode,
   * and then the new value sticks again.
   *
   * The turn-count ceiling therefore acts as an initial split, not a sliding
   * window: a conversation of small turns may keep more than ten of them raw,
   * which is exactly dsh's compact-only-under-pressure behaviour and is what
   * `fitsBudget` reports on honestly.
   */
  private chooseOlderTurnCountSticky(
    conversationId: string,
    split: { prefaceMessages: ModelMessage[]; turns: ConversationTurn[] },
    mode: ContextBuildMode,
    budget: ContextBudget | undefined,
  ): number {
    const maxOlder = Math.max(0, split.turns.length - 1);
    const key = `${conversationId}\u0000${mode}`;
    const sticky = this.boundaries.get(key);

    // Forced compaction (`requestForcedCompaction`, the /compact path): the
    // user asked for headroom now, so the boundary re-decides from zero and
    // walks to the pressure line regardless of what it was stuck at. The
    // deeper `droppedTurnCount` makes the send path announce the change.
    if (this.forcedCompactions.delete(conversationId)) {
      const olderCount = budget
        ? walkToBudget(split, mode, budget, 0)
        : maxOlder;
      this.rememberBoundary(key, { mode, olderCount });
      return olderCount;
    }

    if (sticky) {
      // Clamp to "everything but the newest turn" once history shrinks below
      // the remembered boundary (a fork cut, a pruned side thread).
      let olderCount = Math.min(sticky.olderCount, maxOlder);
      if (budget && !this.fitsWithOlder(split, mode, budget, olderCount)) {
        olderCount = walkToBudget(split, mode, budget, olderCount);
      }
      this.rememberBoundary(key, { mode, olderCount });
      return olderCount;
    }

    const olderCount = chooseOlderTurnCount(split, mode, budget);
    this.rememberBoundary(key, { mode, olderCount });
    return olderCount;
  }

  /**
   * Manual `/compact`: drop the sticky boundary and force the next build to
   * re-split from zero, walking as deep as the budget allows. The summarizer
   * still runs on the next send — there is no out-of-band model call — so
   * this is cheap to request and cannot fail on its own.
   */
  requestForcedCompaction(conversationId: string): void {
    this.forcedCompactions.add(conversationId);
    for (const key of [...this.boundaries.keys()]) {
      if (key.startsWith(`${conversationId}\u0000`)) {
        this.boundaries.delete(key);
      }
    }
  }

  private fitsWithOlder(
    split: { prefaceMessages: ModelMessage[]; turns: ConversationTurn[] },
    mode: ContextBuildMode,
    budget: ContextBudget,
    olderCount: number,
  ): boolean {
    const available = budget.totalTokens - budget.reservedTokens;
    // The pressure line, not the wall: the boundary moves while the kept
    // slice still *fits*, once it has eaten into the headroom. See
    // `PRESSURE_RATIO`.
    return costFrom(split, mode, olderCount) <= available * PRESSURE_RATIO;
  }

  /** Insertion-ordered cap shared by both per-conversation maps. */
  private rememberBoundary(key: string, boundary: StickyBoundary) {
    this.boundaries.delete(key);
    this.boundaries.set(key, boundary);
    while (this.boundaries.size > MEMORY_CACHE_LIMIT * 3) {
      const oldest = this.boundaries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.boundaries.delete(oldest);
    }
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
 * What keeping `older` turns compressed costs against the budget: the kept
 * turns, plus the addendum reserve once anything is being compressed.
 */
function costFrom(
  split: { prefaceMessages: ModelMessage[]; turns: ConversationTurn[] },
  mode: ContextBuildMode,
  older: number,
): number {
  const available = (turnCosts: number[]) =>
    turnCosts.slice(older).reduce((total, cost) => total + cost, 0);
  const turnCosts = split.turns.map((turn) => estimateMessagesTokens([turn.user, ...turn.followUps]));
  const prefaceCost = estimateMessagesTokens(split.prefaceMessages);
  const addendumReserve = Math.ceil(CONTEXT_ADDENDUM_MAX_CHARS[mode] / 3);

  const raw = older === 0 ? prefaceCost + available(turnCosts) : available(turnCosts);
  return raw + (older > 0 ? addendumReserve : 0);
}

/**
 * Walks the boundary upward — compressing more — until the request fits.
 * Starts from `from`, so a sticky boundary under pressure escalates from its
 * own position rather than recomputing from scratch.
 */
function walkToBudget(
  split: { prefaceMessages: ModelMessage[]; turns: ConversationTurn[] },
  mode: ContextBuildMode,
  budget: ContextBudget,
  from: number,
): number {
  const available = (budget.totalTokens - budget.reservedTokens) * PRESSURE_RATIO;
  const maxOlder = Math.max(0, split.turns.length - 1);
  let older = Math.min(from, maxOlder);
  while (older < maxOlder && costFrom(split, mode, older) > available) {
    older += 1;
  }
  return older;
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

  return walkToBudget(split, mode, budget, byTurnCount);
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

/**
 * Rebuilds the wire messages for turns `from` onward, weaving each turn's
 * derived snapshot between its user message and its reply.
 *
 * The snapshot's position is a function of durable history alone, so rebuilds
 * after a restart — or the next step of the same tool loop — reproduce byte
 * identical requests. Snapshots ride inside the kept window: when compaction
 * drops their turn they vanish with it and the summary speaks for them. The
 * full untruncated user text drives derivation; mention syntax late in a long
 * message must resolve exactly as it did on the turn that earned it.
 */
function assembleWireTurns(
  split: { prefaceMessages: ModelMessage[]; turns: ConversationTurn[] },
  from: number,
  turnSnapshot?: (userText: string) => string | null,
): ModelMessage[] {
  const out = [...split.prefaceMessages];
  for (const turn of split.turns.slice(from)) {
    out.push(turn.user);
    const snapshot = turnSnapshot
      ? turnSnapshot(extractMessageText(turn.user, { maxChars: Number.MAX_SAFE_INTEGER }))
      : null;
    if (snapshot) {
      out.push({ role: 'user', content: snapshot });
    }
    out.push(...turn.followUps);
  }
  return out;
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

  // The read side of the checkpoint-compaction contract (user-authored): the
  // summary is presented as a handoff from the model that ran the older
  // turns. The write side is SUMMARY_SYSTEM_PROMPT in summaryRefresher.ts —
  // the two must stay in sync.
  const lines: string[] = [
    'Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:',
  ];

  if (rollingSummary) {
    lines.push('', rollingSummary);
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
