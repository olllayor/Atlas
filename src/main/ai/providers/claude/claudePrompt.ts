import type { ModelMessage } from 'ai';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { planClaudeSkillDispatch } from './claudeSkills.js';

/**
 * Builds the Claude Agent SDK user message from Atlas' `ModelMessage[]`.
 *
 * The SDK session holds history across resumed turns, so only the newest user
 * message goes out — the same "send what's new" shape the OpenCode drivers
 * use. Text stays text; inline image bytes become native image blocks and PDF
 * bytes become document blocks (both ride the Messages API content array);
 * anything else degrades to a path line so the agent still learns the file
 * exists. t3code ingests images only and errors on other mimes; Atlas parts
 * already carry inline bytes, so PDFs cost one block and everything
 * un-embeddable falls back to a path instead of failing the turn.
 */

const SUPPORTED_IMAGE_MIMES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function toBase64(data: unknown): string | null {
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString('base64');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString('base64');
  }
  return null;
}

/** Split a `data:<mime>;base64,<payload>` URL; null for anything else. */
function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) {
    return null;
  }
  return { mime: match[1] ?? 'application/octet-stream', base64: match[2] ?? '' };
}

interface FileContent {
  mime: string;
  base64: string | null;
  filename?: string;
  url?: string;
}

/** Normalize an AI-SDK image/file block into bytes-or-reference. */
function readFileContent(part: Record<string, unknown>): FileContent | null {
  const mime =
    (typeof part.mediaType === 'string' ? part.mediaType : undefined) ??
    (part.type === 'image' ? 'image/png' : 'application/octet-stream');
  const filename = typeof part.filename === 'string' ? part.filename : undefined;
  const raw = part.image ?? part.data;

  if (typeof raw === 'string') {
    const inline = parseDataUrl(raw);
    if (inline) {
      return { mime: inline.mime || mime, base64: inline.base64, ...(filename ? { filename } : {}) };
    }
    // Remote URL or plain path: no bytes to embed.
    return { mime, base64: null, url: raw, ...(filename ? { filename } : {}) };
  }
  const base64 = toBase64(raw);
  if (base64 !== null) {
    return { mime, base64, ...(filename ? { filename } : {}) };
  }
  return null;
}

export interface ClaudePromptBuild {
  /** Message to send: plain string when text-only, structured otherwise. */
  readonly prompt: string | SDKUserMessage;
  /** Attachments that rode as path lines rather than embedded bytes. */
  readonly deferredPaths: string[];
}

/**
 * Build the turn prompt. `skillNames` enables `$skill` → `/skill` dispatch
 * (Claude Code expands a skill only from a trailing `/name` text block).
 */
export function buildClaudePrompt(input: {
  messages: readonly ModelMessage[];
  skillNames?: ReadonlySet<string>;
}): ClaudePromptBuild {
  const lastUserIndex = input.messages.findLastIndex((message) => message.role === 'user');
  if (lastUserIndex < 0) {
    return { prompt: '', deferredPaths: [] };
  }

  const texts: string[] = [];
  const contentBlocks: Array<Record<string, unknown>> = [];
  const deferredPaths: string[] = [];

  const latest = input.messages[lastUserIndex]!;
  const content = (latest as { content?: unknown }).content;
  if (typeof content === 'string') {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const entry of content) {
      if (typeof entry === 'string') {
        texts.push(entry);
        continue;
      }
      const part = asRecord(entry);
      if (part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text);
        continue;
      }
      if (part.type === 'image' || part.type === 'file') {
        const file = readFileContent(part);
        if (!file) {
          continue;
        }
        const normalizedMime = file.mime.trim().toLowerCase();
        if (file.base64 && SUPPORTED_IMAGE_MIMES.has(normalizedMime)) {
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: file.mime, data: file.base64 }
          });
          continue;
        }
        if (file.base64 && normalizedMime === 'application/pdf') {
          contentBlocks.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: file.base64 }
          });
          continue;
        }
        deferredPaths.push(file.filename ?? file.url ?? 'attachment');
      }
    }
  }

  let text = texts.join('\n').trim();
  if (input.skillNames && input.skillNames.size > 0 && text) {
    const dispatch = planClaudeSkillDispatch(text, input.skillNames);
    if (dispatch) {
      // Leading text, media blocks, trailing command: the CLI reads a message
      // as a skill invocation only when `/name` opens the last text block.
      const blocks: Array<Record<string, unknown>> = [];
      const pushText = (value: string | undefined) => {
        if (value && value.length > 0) {
          blocks.push({ type: 'text', text: value });
        }
      };
      pushText(dispatch.leadingText);
      blocks.push(...contentBlocks);
      pushText(dispatch.commandText);
      return {
        prompt: {
          type: 'user',
          session_id: '',
          parent_tool_use_id: null,
          message: { role: 'user', content: blocks }
        } as unknown as SDKUserMessage,
        deferredPaths
      };
    }
  }

  if (deferredPaths.length > 0) {
    text = `${text}\n\nAttachment paths: ${deferredPaths.join(', ')}`.trim();
  }
  if (contentBlocks.length === 0) {
    return { prompt: text, deferredPaths };
  }
  return {
    prompt: {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [...contentBlocks, ...(text ? [{ type: 'text', text }] : [])]
      }
    } as unknown as SDKUserMessage,
    deferredPaths
  };
}
