import type { ModelMessage } from 'ai';

/**
 * Model-free pruning of oversized tool results in the history sent to the
 * model, ported from DeepSeek Harness's `compaction-tool-result-pruner`.
 *
 * The spill policy bounds what one NEW tool result can add to the context;
 * this pruner bounds what OLD results keep occupying it. A transcript that
 * ran ten big greps carries all ten into every later request until the
 * ContextManager compresses the turn away — and even then the summaries are
 * heuristic. Pruning rewrites each over-budget result to a bounded head, a
 * fixed marker, and a bounded tail, in place, on the request copy only: the
 * persisted transcript keeps the full result, so this is a presentation
 * change, never data loss.
 *
 * Invariants kept from the original:
 *
 * - Idempotent. `headChars + marker + tailChars <= thresholdChars`, so an
 *   emitted replacement is always within the threshold and a second pass
 *   emits nothing. Running the pruner on every request is therefore free.
 * - Code-point budgets, not UTF-16 code units: slicing iterates code points,
 *   so a retained boundary can never split a surrogate pair (it can split a
 *   multi-code-point grapheme cluster, same as the original).
 * - Fail-loud config validation, same posture as the repeat-call guard: a
 *   misconfigured budget is a programming error, not a silent fallback.
 *
 * Atlas-specific: tool results are structured objects (`output` on the AI
 * SDK's `tool-result` part), not text blocks, so the pruner measures and
 * rewrites the same `JSON.stringify(value, null, 2)` serialization the spill
 * policy and the transcript use. A pruned result becomes a plain string —
 * the model reads it fine, and the transcript's stored copy is untouched.
 */

/** Fixed marker substituted for every removed middle span (dsh's exact text). */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n';

/**
 * Defaults tuned for coding-agent tool output. The threshold sits at the
 * spill policy's inline cap (50 KB ≈ 50k code points for ASCII) so a result
 * that escaped spilling — a skipped tool, a store failure — still gets
 * bounded on its way into later requests.
 */
export const PRUNE_DEFAULTS = {
  thresholdChars: 50_000,
  headChars: 30_000,
  tailChars: 10_000
} as const;

export interface ToolResultPruneConfig {
  /** Prune a result when its serialized text exceeds this many code points. */
  thresholdChars?: number;
  /** Leading code points retained. */
  headChars?: number;
  /** Trailing code points retained. */
  tailChars?: number;
}

export interface ResolvedPruneConfig {
  readonly thresholdChars: number;
  readonly headChars: number;
  readonly tailChars: number;
}

/** One pruned result, for logging and tests. */
export interface PrunedEntry {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly charsBefore: number;
  readonly charsAfter: number;
}

export interface PruneHistoryResult {
  /** The (possibly rewritten) history to hand to the model. */
  readonly messages: ModelMessage[];
  readonly pruned: readonly PrunedEntry[];
  readonly charsRemoved: number;
}

const CONFIG_KEYS: ReadonlySet<string> = new Set(['thresholdChars', 'headChars', 'tailChars']);

/** Count Unicode code points without splitting surrogate pairs. */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) {
    count += 1;
  }
  return count;
}

/**
 * Resolve and validate pruning budgets. Throws on unknown keys, non-integers,
 * and on any budget set whose emitted replacement could exceed the threshold
 * (which would make pruning grow results or rewrite them forever).
 */
export function resolvePruneConfig(config: ToolResultPruneConfig = {}): ResolvedPruneConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `ToolResultPruneConfig: unknown key "${key}" (allowed: thresholdChars, headChars, tailChars)`
      );
    }
  }

  const resolved: ResolvedPruneConfig = {
    thresholdChars: config.thresholdChars ?? PRUNE_DEFAULTS.thresholdChars,
    headChars: config.headChars ?? PRUNE_DEFAULTS.headChars,
    tailChars: config.tailChars ?? PRUNE_DEFAULTS.tailChars
  };

  if (!Number.isInteger(resolved.thresholdChars) || resolved.thresholdChars <= 0) {
    throw new Error(`ToolResultPruneConfig: thresholdChars (${resolved.thresholdChars}) must be a positive integer`);
  }
  if (!Number.isInteger(resolved.headChars) || resolved.headChars < 0) {
    throw new Error(`ToolResultPruneConfig: headChars (${resolved.headChars}) must be a non-negative integer`);
  }
  if (!Number.isInteger(resolved.tailChars) || resolved.tailChars < 0) {
    throw new Error(`ToolResultPruneConfig: tailChars (${resolved.tailChars}) must be a non-negative integer`);
  }

  const emittedChars = resolved.headChars + codePointLength(PRUNE_MARKER) + resolved.tailChars;
  if (emittedChars > resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: headChars + marker + tailChars (${emittedChars}) ` +
        `must be at most thresholdChars (${resolved.thresholdChars})`
    );
  }

  return resolved;
}

/** Serialize a tool result the same way the spill policy and transcript do. */
function serializeOutput(output: unknown): string | null {
  if (output == null) {
    return null;
  }
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return null;
  }
}

/**
 * The AI SDK's `tool-result` parts wrap output in a discriminated union
 * (`{ type: 'text', value } | { type: 'json', value }`). Extract the text the
 * model actually sees, or null for shapes we cannot measure.
 */
function measureToolOutput(output: unknown): string | null {
  if (typeof output === 'object' && output !== null) {
    const wrapped = output as { type?: unknown; value?: unknown };
    if (wrapped.type === 'text' && typeof wrapped.value === 'string') {
      return wrapped.value;
    }
    if (wrapped.type === 'json') {
      return serializeOutput(wrapped.value);
    }
    return null;
  }

  // Legacy or hand-built history rows can carry raw outputs; measure them
  // the same way, though only wrapper-shaped parts can be rewritten.
  return serializeOutput(output);
}

function isWrappedToolOutput(output: unknown): output is { type: 'text' | 'json'; value: unknown } {
  return (
    typeof output === 'object' &&
    output !== null &&
    ((output as { type?: unknown }).type === 'text' || (output as { type?: unknown }).type === 'json')
  );
}

/**
 * Head + marker + tail of `text` in code points. Only called for text known
 * to exceed the threshold, so the removed span is never empty.
 */
export function pruneText(text: string, config: ResolvedPruneConfig): string {
  const points = Array.from(text);
  const head = points.slice(0, config.headChars).join('');
  const tail = points.slice(Math.max(points.length - config.tailChars, config.headChars)).join('');
  return `${head}${PRUNE_MARKER}${tail}`;
}

type ToolResultPartLike = {
  type: string;
  toolCallId?: unknown;
  toolName?: unknown;
  output?: unknown;
};

function isToolResultPart(part: unknown): part is ToolResultPartLike {
  return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'tool-result';
}

/**
 * Rewrite over-budget tool results in `history`, returning new message
 * objects for anything changed and the original references for everything
 * else. The input array and its messages are never mutated.
 */
export function pruneModelHistory(
  history: ModelMessage[],
  config: ToolResultPruneConfig = {}
): PruneHistoryResult {
  const resolved = resolvePruneConfig(config);
  const pruned: PrunedEntry[] = [];
  let charsRemoved = 0;
  let changed = false;
  const messages: ModelMessage[] = [];

  for (const message of history) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      messages.push(message);
      continue;
    }

    let contentChanged = false;
    const content = message.content.map((part) => {
      if (!isToolResultPart(part) || part.output == null) {
        return part;
      }

      const text = measureToolOutput(part.output);
      if (text === null) {
        return part;
      }

      const charsBefore = codePointLength(text);
      if (charsBefore <= resolved.thresholdChars) {
        return part;
      }

      // Only the SDK's wrapper-shaped outputs can be rewritten legally; a
      // raw-shaped part is measured but left alone.
      if (!isWrappedToolOutput(part.output)) {
        return part;
      }

      const replacement = pruneText(text, resolved);
      const charsAfter = codePointLength(replacement);

      // Belt and braces on top of the config invariant: never emit a
      // replacement that fails to shrink the result.
      if (charsAfter >= charsBefore) {
        return part;
      }

      pruned.push({
        toolCallId: typeof part.toolCallId === 'string' ? part.toolCallId : '',
        toolName: typeof part.toolName === 'string' ? part.toolName : 'tool',
        charsBefore,
        charsAfter
      });
      charsRemoved += charsBefore - charsAfter;
      contentChanged = true;
      // A pruned json output becomes text: the value is no longer the
      // original JSON document, and the model reads it as text either way.
      return { ...part, output: { type: 'text' as const, value: replacement } };
    });

    if (contentChanged) {
      changed = true;
      messages.push({ ...message, content });
    } else {
      messages.push(message);
    }
  }

  return { messages: changed ? messages : history, pruned, charsRemoved };
}
