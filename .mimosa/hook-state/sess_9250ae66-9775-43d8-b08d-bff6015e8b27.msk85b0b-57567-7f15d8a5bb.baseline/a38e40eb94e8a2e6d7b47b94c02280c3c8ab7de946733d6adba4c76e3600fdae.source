/**
 * Token estimation without a tokenizer.
 *
 * Shipping a real BPE tokenizer would mean one vocabulary per model family and
 * megabytes of tables for a number that is only ever displayed, so this
 * approximates instead — but it approximates far better than the `chars / 4`
 * rule it replaces.
 *
 * Two corrections matter in practice:
 *
 * - **Density.** `chars / 4` is calibrated on English prose. Code, JSON and
 *   identifiers tokenize much finer (punctuation and casing splits are their
 *   own tokens), so the same character count is 25–40% more tokens. The
 *   punctuation ratio tells the two apart.
 * - **Per-message overhead.** Every message costs a few tokens for its role
 *   and delimiters regardless of content. On a long thread of short turns this
 *   is the difference between a plausible number and a useless one.
 *
 * Everything here is deliberately an *over*-estimate at the margins: showing
 * a context bar fuller than reality is a safe error, showing it emptier is not.
 */

/** Characters per token for ordinary prose. */
const CHARS_PER_TOKEN_PROSE = 4;
/** Characters per token for punctuation-dense text (code, JSON, ids). */
const CHARS_PER_TOKEN_DENSE = 2.9;
/** Words-to-tokens ratio; English averages ~0.75 words per token. */
const TOKENS_PER_WORD = 1.33;
/** Punctuation share above which text is treated as dense. */
const DENSE_PUNCTUATION_RATIO = 0.16;

/** Role and delimiter cost of a single message, content aside. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Cost of an image when its dimensions are unknown. Sized to a typical
 * screenshot rather than a thumbnail, because under-counting an attachment is
 * how a request sails past the window and 400s.
 */
const IMAGE_TOKENS_FALLBACK = 1_200;
/** Pixels per token, matching the ~(w×h)/750 rule the major vision APIs use. */
const IMAGE_PIXELS_PER_TOKEN = 750;
/** Vision APIs downscale beyond this, so cost stops growing with pixels. */
const IMAGE_TOKENS_MAX = 2_400;

/** Non-image attachments are summarised, not inlined, so they cost little. */
const FILE_REFERENCE_TOKENS = 16;

export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  let punctuation = 0;
  for (const character of trimmed) {
    // Anything that is not a letter, digit or space splits tokens more often.
    if (!/[\p{L}\p{N}\s]/u.test(character)) {
      punctuation += 1;
    }
  }

  const density = punctuation / trimmed.length;
  const charsPerToken = density >= DENSE_PUNCTUATION_RATIO ? CHARS_PER_TOKEN_DENSE : CHARS_PER_TOKEN_PROSE;
  const fromChars = trimmed.length / charsPerToken;

  const words = trimmed.split(/\s+/).length;
  const fromWords = words * TOKENS_PER_WORD;

  // Whichever reading is larger: long unbroken strings are caught by the
  // character rule, ordinary prose by the word rule.
  return Math.ceil(Math.max(fromChars, fromWords));
}

export function estimateImageTokens(dimensions?: {
  width?: number | null;
  height?: number | null;
}): number {
  const width = dimensions?.width ?? null;
  const height = dimensions?.height ?? null;

  if (!width || !height || width <= 0 || height <= 0) {
    return IMAGE_TOKENS_FALLBACK;
  }

  return Math.min(IMAGE_TOKENS_MAX, Math.ceil((width * height) / IMAGE_PIXELS_PER_TOKEN));
}

/**
 * Cost of a structured value on the wire. Serialised JSON is dense by
 * definition, so it skips the density sniff.
 */
export function estimateJsonTokens(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'string') {
    return estimateTextTokens(value);
  }

  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? '';
  } catch {
    // Cyclic or otherwise unserialisable: fall back to a shallow read rather
    // than throwing inside a display path.
    serialised = String(value);
  }

  return Math.ceil(serialised.length / CHARS_PER_TOKEN_DENSE);
}

/** A message shape loose enough for both `ModelMessage` and stored rows. */
type MeasurableMessage = {
  role?: unknown;
  content?: unknown;
};

/**
 * Cost of one message including its role overhead. Content parts are measured
 * by kind: text as text, images by area, tool calls and results as JSON.
 */
export function estimateMessageTokens(message: MeasurableMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateContentTokens(message.content);
}

export function estimateMessagesTokens(messages: MeasurableMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

function estimateContentTokens(content: unknown): number {
  if (content == null) {
    return 0;
  }

  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }

  if (!Array.isArray(content)) {
    return estimateJsonTokens(content);
  }

  let total = 0;
  for (const item of content) {
    total += estimatePartTokens(item);
  }
  return total;
}

function estimatePartTokens(part: unknown): number {
  if (part == null) {
    return 0;
  }

  if (typeof part === 'string') {
    return estimateTextTokens(part);
  }

  if (typeof part !== 'object') {
    return estimateJsonTokens(part);
  }

  const record = part as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';

  if (type === 'text' || type === 'reasoning') {
    return estimateTextTokens(typeof record.text === 'string' ? record.text : '');
  }

  if (type === 'image') {
    return estimateImageTokens({
      width: numberOrNull(record.width) ?? numberOrNull(record.previewWidth),
      height: numberOrNull(record.height) ?? numberOrNull(record.previewHeight),
    });
  }

  if (type === 'file') {
    const mediaType = typeof record.mediaType === 'string' ? record.mediaType : '';
    if (mediaType.startsWith('image/')) {
      return estimateImageTokens({
        width: numberOrNull(record.previewWidth),
        height: numberOrNull(record.previewHeight),
      });
    }
    return FILE_REFERENCE_TOKENS;
  }

  // Tool calls and results travel as JSON, and their payloads are usually the
  // largest thing in a transcript.
  if (type.includes('tool')) {
    return (
      estimateJsonTokens(record.input ?? record.args ?? record.arguments) +
      estimateJsonTokens(record.output ?? record.result ?? record.error) +
      estimateTextTokens(typeof record.toolName === 'string' ? record.toolName : '')
    );
  }

  return estimateJsonTokens(record);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
