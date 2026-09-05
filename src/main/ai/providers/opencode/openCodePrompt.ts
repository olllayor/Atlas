/**
 * Maps Atlas' `ModelMessage[]` onto an opencode prompt.
 *
 * opencode owns the conversation once a session exists, so a resumed turn
 * sends only what is new. A freshly created session has no history at all,
 * which is why the first prompt into one carries a bounded transcript digest —
 * the same "seed then delegate" shape t3code uses when it recreates a session
 * after a confirmed miss.
 */

import fs from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ModelMessage } from 'ai';

import type { OpenCodePromptPart } from './OpenCodeAgentClient.js';

/** Digest budget for a freshly seeded session: enough context, bounded cost. */
const HISTORY_MESSAGE_LIMIT = 20;
const HISTORY_CHAR_LIMIT = 24_000;

export const OPENCODE_NATIVE_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
]);

export const OPENCODE_NATIVE_FILE_PART_MAX_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * Attachments OpenCode can hand to a model as a native file part. Anything
 * else (ZIP, binaries, image formats like BMP/AVIF/SVG that model APIs
 * reject, or files over the direct-attachment size limit) would make the turn
 * fail before it starts, so those ride only as the file path text in the prompt.
 *
 * Blueprint: pingdotgg/t3code `apps/server/src/provider/opencodeRuntime.ts:432-455`.
 */
export function isOpenCodeNativeFilePart(input: {
  readonly mimeType: string;
  readonly sizeBytes?: number | null;
}): boolean {
  if (typeof input.sizeBytes === 'number' && input.sizeBytes > OPENCODE_NATIVE_FILE_PART_MAX_BYTES) {
    return false;
  }
  const normalized = input.mimeType.trim().toLowerCase();
  return (
    OPENCODE_NATIVE_IMAGE_MIMES.has(normalized) ||
    normalized.startsWith('text/') ||
    normalized === 'application/pdf'
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function resolveFilePath(part: Record<string, unknown>): string | null {
  if (typeof part.path === 'string' && isAbsolute(part.path)) {
    return part.path;
  }
  const data = part.image ?? part.data;
  if (typeof data === 'string' && isAbsolute(data)) {
    return data;
  }
  return null;
}

function resolveSizeBytes(part: Record<string, unknown>, filePath: string | null): number | null {
  if (typeof part.sizeBytes === 'number') {
    return part.sizeBytes;
  }
  if (typeof part.size === 'number') {
    return part.size;
  }
  const raw = part.image ?? part.data;
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    return raw.byteLength;
  }
  if (raw instanceof ArrayBuffer) {
    return raw.byteLength;
  }
  if (typeof raw === 'string' && raw.startsWith('data:')) {
    const commaIndex = raw.indexOf(',');
    if (commaIndex >= 0) {
      const payload = raw.slice(commaIndex + 1);
      return Math.floor((payload.length * 3) / 4);
    }
  }
  if (filePath) {
    try {
      const stat = fs.statSync(filePath, { throwIfNoEntry: false });
      if (stat?.size != null) {
        return stat.size;
      }
    } catch {
      // Best-effort local file size check
    }
  }
  return null;
}

function toFallbackTextPart(part: Record<string, unknown>, filePath: string | null): OpenCodePromptPart {
  const filename = typeof part.filename === 'string' ? part.filename : undefined;
  if (filePath) {
    return {
      type: 'text',
      text: `[Attached file "${filename ?? filePath}" is saved at: ${filePath}]`
    };
  }
  if (filename) {
    return {
      type: 'text',
      text: `[Attached file: ${filename}]`
    };
  }
  const mediaType = typeof part.mediaType === 'string' ? part.mediaType : undefined;
  return {
    type: 'text',
    text: `[Attached file (${mediaType ?? 'unsupported format'})]`
  };
}

function toBase64(data: unknown): string | null {
  if (typeof data === 'string') {
    // Already a URL (data:, file:, or https:) — opencode takes either verbatim.
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

/** Build a `file` or fallback `text` part from an image/file content block. */
function toFileOrTextPart(part: Record<string, unknown>, gateNative = true): OpenCodePromptPart | null {
  const filePath = resolveFilePath(part);
  const sizeBytes = resolveSizeBytes(part, filePath);

  let mediaType = typeof part.mediaType === 'string' ? part.mediaType : undefined;
  if (!mediaType) {
    const raw = part.image ?? part.data;
    if (typeof raw === 'string' && raw.startsWith('data:')) {
      const match = raw.match(/^data:([^;,]+)/);
      if (match?.[1]) {
        mediaType = match[1];
      }
    }
  }
  if (!mediaType) {
    mediaType = part.type === 'image' ? 'image/png' : 'application/octet-stream';
  }

  // Gate native file part support: png/jpeg/gif/webp + text/* + pdf, max 20MB.
  if (gateNative && !isOpenCodeNativeFilePart({ mimeType: mediaType, sizeBytes })) {
    return toFallbackTextPart(part, filePath);
  }

  // If native and a local file path exists, convert to file:// URL
  if (filePath) {
    const filename = typeof part.filename === 'string' ? part.filename : undefined;
    return {
      type: 'file',
      mime: mediaType,
      url: pathToFileURL(filePath).href,
      ...(filename ? { filename } : {})
    };
  }

  const encoded = toBase64(part.image ?? part.data);
  if (!encoded) {
    return toFallbackTextPart(part, filePath);
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
  /**
   * Whether to gate file parts to native supported formats (PNG/JPEG/GIF/WEBP/PDF/text, max 20MB).
   * Default true (OpenCode SDK transport).
   * When false (e.g. ACP adapter), non-native attachments are retained as file parts so ACP
   * can handle them via path fallbacks.
   */
  readonly gateNative?: boolean;
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
      const resolved = toFileOrTextPart(part, input.gateNative);
      if (resolved) {
        parts.push(resolved);
      }
    }
  }

  return parts;
}
