/**
 * Maps Atlas' `ModelMessage[]` onto an opencode prompt.
 *
 * opencode owns the conversation once a session exists, so a resumed turn
 * sends only what is new. A freshly created session has no history at all,
 * which is why the first prompt into one carries a bounded transcript digest —
 * the same "seed then delegate" shape t3code uses when it recreates a session
 * after a confirmed miss.
 */

import type { ModelMessage } from 'ai';

import type { OpenCodePromptPart } from './OpenCodeAgentClient.js';

/** Digest budget for a freshly seeded session: enough context, bounded cost. */
const HISTORY_MESSAGE_LIMIT = 20;
const HISTORY_CHAR_LIMIT = 24_000;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function toBase64(data: unknown): string | null {
  if (typeof data === 'string') {
    // Already a URL (data: or https:) — opencode takes either verbatim.
    return data;
  }
  if (data instanceof Uint8Array) {
    return `base64,${Buffer.from(data).toString('base64')}`;
  }
  if (data instanceof ArrayBuffer) {
    return `base64,${Buffer.from(new Uint8Array(data)).toString('base64')}`;
  }
  if (data instanceof URL) {
    return data.toString();
  }
  return null;
}

/** Build a `file` part from an AI-SDK image/file content block, if we can. */
function toFilePart(part: Record<string, unknown>): OpenCodePromptPart | null {
  const mediaType =
    (typeof part.mediaType === 'string' ? part.mediaType : undefined) ??
    (part.type === 'image' ? 'image/png' : 'application/octet-stream');
  const encoded = toBase64(part.image ?? part.data);
  if (!encoded) {
    return null;
  }

  const url = encoded.startsWith('base64,') ? `data:${mediaType};${encoded}` : encoded;
  const filename = typeof part.filename === 'string' ? part.filename : undefined;

  return {
    type: 'file',
    mime: mediaType,
    url,
    ...(filename ? { filename } : {})
  };
}

/** Plain text of a message, ignoring tool traffic opencode never sees. */
export function messageText(message: ModelMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((entry) => asRecord(entry))
    .filter((entry) => entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text as string)
    .join('\n');
}

function renderHistory(messages: readonly ModelMessage[]): string | null {
  const relevant = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-HISTORY_MESSAGE_LIMIT)
    .map((message) => {
      const text = messageText(message).trim();
      return text.length > 0 ? `${message.role === 'user' ? 'User' : 'Assistant'}: ${text}` : null;
    })
    .filter((entry): entry is string => entry !== null);

  if (relevant.length === 0) {
    return null;
  }

  const rendered = relevant.join('\n\n');
  const clipped =
    rendered.length > HISTORY_CHAR_LIMIT ? `…\n\n${rendered.slice(-HISTORY_CHAR_LIMIT)}` : rendered;

  return `Conversation so far (for context; do not reply to it directly):\n\n${clipped}`;
}

export interface BuildOpenCodePromptInput {
  readonly messages: readonly ModelMessage[];
  /** True when the session was just created and knows nothing yet. */
  readonly seedHistory: boolean;
}

/**
 * Parts for the turn: the newest user message, preceded by a history digest
 * when the session is new. Returns an empty array when there is nothing to
 * send, which the caller treats as a bug in its own history handling rather
 * than prompting opencode with silence.
 */
export function buildOpenCodePromptParts(input: BuildOpenCodePromptInput): OpenCodePromptPart[] {
  const lastUserIndex = input.messages.findLastIndex((message) => message.role === 'user');
  if (lastUserIndex < 0) {
    return [];
  }

  const parts: OpenCodePromptPart[] = [];

  if (input.seedHistory) {
    const history = renderHistory(input.messages.slice(0, lastUserIndex));
    if (history) {
      parts.push({ type: 'text', text: history });
    }
  }

  const latest = input.messages[lastUserIndex]!;
  const content = (latest as { content?: unknown }).content;

  if (typeof content === 'string') {
    parts.push({ type: 'text', text: content });
    return parts;
  }

  for (const entry of Array.isArray(content) ? content : []) {
    const part = asRecord(entry);
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'image' || part.type === 'file') {
      const filePart = toFilePart(part);
      if (filePart) {
        parts.push(filePart);
      }
    }
  }

  return parts;
}
