import { logger } from '../../../observability/logger';
import type { SpillStore } from './SpillStore';

/**
 * Keeps oversized tool results out of the model's context without losing them.
 *
 * When a tool's final result serializes to more than `maxInlineBytes` of
 * UTF-8, the full text is persisted to the conversation's spill directory and
 * the model-facing result is replaced with a bounded head/tail preview plus a
 * locator line naming the file. The model can pull any region back with
 * `read_file` and offset/limit, so a lossy-looking result is actually
 * recoverable — the trade `commandOutputCap`'s hard truncation never offered.
 *
 * The design follows DeepSeek Harness's spill-policy plugin, adapted to a
 * harness without a tool-event bus: instead of a `tools/post-execute`
 * waterfall listener, each tool's `execute` is wrapped once at turn-assembly
 * time, which is the single point where Atlas's tool results are settled.
 *
 * Invariants kept from the original:
 *
 * - Best-effort. A missing store, a save failure, or a replacement that
 *   cannot fit the cap returns the original result. Spilling must never turn
 *   a successful tool call into an error or hide content.
 * - The notice's byte cost is reserved INSIDE the cap, so the replacement
 *   (preview + notice) never exceeds the advertised budget — for a
 *   marginally-over result, a naive preview-then-append could produce a
 *   replacement larger than the original.
 * - `read_file` is skipped to avoid a `read → spill → read again` loop; it
 *   is also the recovery path the notice points at.
 *
 * Atlas-specific: tools return structured objects, not text blocks, so the
 * policy serializes them the same way the transcript does
 * (`JSON.stringify(value, null, 2)`). Results under the cap pass through
 * untouched, preserving their shape for the UI. Diff-producing tools are
 * skipped because the transcript parses their output into the rendered diff
 * artifact — replacing it would break the cell for a rare large diff.
 */

/**
 * The model-facing cap for one tool result, in UTF-8 bytes. Matches the
 * default DeepSeek Harness ships: large enough for any ordinary result,
 * small enough that one runaway grep or build log cannot eat the context
 * budget the way a 1 MiB `commandOutputCap` result can.
 */
export const SPILL_MAX_INLINE_BYTES = 50_000;

/**
 * Tools whose results are never spilled.
 *
 * `read_file` is the retrieval path a spill notice points at — spilling it
 * would loop. The diff producers are the transcript's rendered artifacts:
 * `toolCellGrammar` parses their output into the diff cell, and a preview
 * string would fall back to raw text and lose the artifact.
 */
export const SPILL_SKIPPED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'git_diff'
]);

export interface SpillPolicyOptions {
  /** The conversation whose turn is running — scopes the spill directory. */
  conversationId: string;
  /** Where full results are persisted. */
  store: Pick<SpillStore, 'saveText'>;
  /** Override the cap; omitted uses {@link SPILL_MAX_INLINE_BYTES}. */
  maxInlineBytes?: number;
}

/**
 * The result a tool returns to the model after spill policy has been applied:
 * either the original value (under cap, or spilling was impossible) or the
 * preview-plus-locator string.
 */
export type SpilledResult = unknown;

/** Serialize a tool result the way the transcript renders it. */
export function serializeToolResult(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Circular or otherwise unserializable: the AI SDK would render it with
    // String() anyway; spilling has nothing better to offer.
    return null;
  }
}

/**
 * Cut a UTF-8 buffer index back onto a character boundary.
 *
 * Slicing mid-sequence would decode to U+FFFD on both sides of the cut; a
 * continuation byte (0b10xxxxxx) means the cut landed inside a character, so
 * walk in the given direction until a leading byte is found.
 */
function alignUtf8Boundary(buffer: Buffer, index: number, direction: -1 | 1): number {
  let aligned = index;

  while (aligned > 0 && aligned < buffer.length && (buffer[aligned] & 0xc0) === 0x80) {
    aligned += direction;
  }

  return Math.max(0, Math.min(buffer.length, aligned));
}

/**
 * Head/tail preview of `text` within `budget` UTF-8 bytes, with the omission
 * marker's cost accounted for. Mirrors the shape of `commandOutputCap`'s
 * retention so a spilled result reads like the truncation users already know,
 * minus the data loss.
 */
export function buildSpillPreview(
  text: string,
  budget: number
): { preview: string; omittedBytes: number } {
  const buffer = Buffer.from(text, 'utf8');

  if (buffer.byteLength <= budget) {
    return { preview: text, omittedBytes: 0 };
  }

  const marker = '\n…\n';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const usable = Math.max(0, budget - markerBytes);
  const headEnd = alignUtf8Boundary(buffer, Math.ceil(usable / 2), -1);
  const tailStart = alignUtf8Boundary(buffer, buffer.byteLength - Math.floor(usable / 2), 1);

  const head = buffer.subarray(0, headEnd).toString('utf8');
  const tail = buffer.subarray(Math.max(tailStart, headEnd)).toString('utf8');
  const omittedBytes = buffer.byteLength - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');

  return { preview: `${head}${marker}${tail}`, omittedBytes };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} bytes`;
}

/** The locator line appended to a spilled preview. */
export function spillNotice(omittedBytes: number, path: string): string {
  return `(${formatBytes(omittedBytes)} omitted. Full result stored at: ${path}. Use read_file with offset and limit to inspect it.)`;
}

/**
 * Wrap every executable tool in `tools` with the spill policy and return the
 * wrapped set. Tools without an `execute` (schema-only definitions) and the
 * names in {@link SPILL_SKIPPED_TOOL_NAMES} pass through untouched, as does
 * the whole set when `options` is null — the store is an optional dependency,
 * and its absence is a no-op, not an error.
 */
export function applySpillPolicy<T extends Record<string, unknown>>(
  tools: T,
  options: SpillPolicyOptions | null
): T {
  if (!options) {
    return tools;
  }

  const cap = options.maxInlineBytes ?? SPILL_MAX_INLINE_BYTES;

  if (!Number.isInteger(cap) || cap < 0) {
    // A bad cap is a programming error; fail it loudly at assembly time
    // rather than per tool call, where it would look like a tool failure.
    throw new Error(`spill policy: maxInlineBytes must be a non-negative integer (got ${cap})`);
  }

  const wrapped: Record<string, unknown> = {};

  for (const [name, definition] of Object.entries(tools)) {
    const tool = definition as { execute?: unknown };

    if (SPILL_SKIPPED_TOOL_NAMES.has(name) || typeof tool.execute !== 'function') {
      wrapped[name] = definition;
      continue;
    }

    const originalExecute = tool.execute as (input: unknown, execOptions: unknown) => Promise<unknown>;

    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, execOptions: unknown) => {
        const result = await originalExecute(input, execOptions);
        return spillResult(result, name, options, cap);
      }
    };
  }

  return wrapped as T;
}

/**
 * Apply the spill decision to one settled result. Exported for tests and for
 * any future caller that settles results outside the wrapped-execute path.
 */
export async function spillResult(
  result: unknown,
  toolName: string,
  options: SpillPolicyOptions,
  cap: number = options.maxInlineBytes ?? SPILL_MAX_INLINE_BYTES
): Promise<SpilledResult> {
  const text = serializeToolResult(result);

  if (text === null) {
    return result;
  }

  const totalBytes = Buffer.byteLength(text, 'utf8');

  if (totalBytes <= cap) {
    return result;
  }

  let saved: { path: string; bytes: number };
  try {
    saved = await options.store.saveText({
      conversationId: options.conversationId,
      toolName,
      content: text
    });
  } catch (error) {
    // Best-effort: a storage failure (permissions, disk full) must never
    // fail the call or hide the content — keep the original inline.
    logger.warn('spill.save_failed', {
      toolName,
      conversationId: options.conversationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return result;
  }

  // Reserve the notice's byte cost inside the cap. The notice is priced at
  // the worst-case omission (the full byte total): its formatted size bounds
  // the real one, so the reservation is a safe upper bound.
  const reserve = Buffer.byteLength(spillNotice(totalBytes, saved.path), 'utf8') + 2;
  const previewBudget = Math.max(0, cap - reserve);
  const { preview, omittedBytes } = buildSpillPreview(text, previewBudget);
  const notice = spillNotice(omittedBytes, saved.path);
  const replaced = preview.length > 0 ? `${preview}\n\n${notice}` : notice;

  // Invariant: the replacement never exceeds the cap. When the notice alone
  // is over budget (a tiny cap or an enormous path) there is no within-cap
  // replacement, so keep the inline result — the spill file already written
  // is a harmless orphan the next sweep reclaims.
  if (Buffer.byteLength(replaced, 'utf8') > cap) {
    logger.warn('spill.notice_exceeds_cap', { toolName, cap, bytes: Buffer.byteLength(replaced, 'utf8') });
    return result;
  }

  return replaced;
}
