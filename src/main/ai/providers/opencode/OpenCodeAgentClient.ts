/**
 * The slice of the opencode SDK a turn actually needs, expressed as an
 * interface so the adapter tests script a fake instead of an HTTP server
 * (t3code tests its adapter the same way).
 */

import type { OpenCodeProviderListResult } from './OpenCodeClient.js';
import { createOpenCodeSdkClient, normalizeProviderListPayload } from './OpenCodeClient.js';
import type { OpenCodePermissionRuleset } from './openCodeParsers.js';

export interface OpenCodePromptPart {
  readonly type: 'text' | 'file';
  readonly text?: string;
  readonly mime?: string;
  readonly url?: string;
  readonly filename?: string;
}

export interface OpenCodePromptInput {
  readonly sessionId: string;
  readonly model: { readonly providerID: string; readonly modelID: string };
  readonly parts: readonly OpenCodePromptPart[];
  readonly system?: string;
  /** Reasoning variant on the wire (low, medium, high, xhigh) matching t3code PR #9287. */
  readonly variant?: string;
  /** Agent mode on the wire (e.g. build, plan). */
  readonly agent?: string;
}

export interface OpenCodePromptResult {
  /** Whatever the assistant produced, as opencode finally recorded it. */
  readonly text: string;
  readonly reasoning: string;
  readonly tokens?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
    readonly cacheRead?: number;
  };
  readonly errorText?: string;
}

export type OpenCodePermissionReply = 'once' | 'always' | 'reject';

export interface OpenCodeAgentClient {
  listProviders(): Promise<OpenCodeProviderListResult>;
  /** Resolves null when opencode no longer knows the session (confirmed miss). */
  getSession(sessionId: string): Promise<{ id: string; parentID?: string } | null>;
  createSession(input: { title?: string; permission?: OpenCodePermissionRuleset }): Promise<{ id: string }>;
  /**
   * Fork an existing session into a new one carrying its history.
   * Used when a conversation moves directories: opencode scopes history by
   * directory, so resuming in place would graft the wrong project history.
   */
  forkSession(input: { sessionId: string; directory?: string }): Promise<{ id: string }>;
  /** Used to clean up one-shot sessions; failures are not worth a turn. */
  deleteSession(sessionId: string): Promise<void>;
  prompt(input: OpenCodePromptInput): Promise<OpenCodePromptResult>;
  abort(sessionId: string): Promise<void>;
  replyToPermission(input: { requestId: string; reply: OpenCodePermissionReply }): Promise<void>;
  replyToQuestion(input: { requestId: string; answers: string[][] }): Promise<void>;
  rejectQuestion(input: { requestId: string }): Promise<void>;
  listChildren?(sessionId: string): Promise<Array<{ id: string }>>;
  listPermissions?(): Promise<Array<Record<string, unknown>>>;
  listQuestions?(): Promise<Array<Record<string, unknown>>>;
  /** Server-sent event stream; ends when `signal` aborts. */
  subscribeEvents(signal: AbortSignal): AsyncIterable<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** A 404 means "that session is gone"; anything else must fail the turn. */
export function isOpenCodeNotFound(error: unknown): boolean {
  const record = asRecord(error);
  const status =
    (asRecord(record.response).status as number | undefined) ?? (record.status as number | undefined);
  if (status === 404) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\b404\b/.test(message) || /not ?found/i.test(message);
}

function collectText(parts: unknown, type: 'text' | 'reasoning'): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => asRecord(part))
    .filter((part) => part.type === type && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function describeMessageError(error: unknown): string | undefined {
  const record = asRecord(error);
  if (Object.keys(record).length === 0) return undefined;
  const data = asRecord(record.data);
  const message = typeof data.message === 'string' ? data.message : undefined;
  const name = typeof record.name === 'string' ? record.name : undefined;
  return message ?? name ?? 'OpenCode reported an unknown error.';
}

/**
 * Bind the interface above to the real SDK. Kept boring on purpose: every
 * decision that is not a direct SDK call belongs in the adapter, so this file
 * only has to change when the SDK's own surface does.
 */
export function createOpenCodeAgentClient(input: {
  baseUrl: string;
  directory: string;
  serverPassword?: string;
}): OpenCodeAgentClient {
  const client = createOpenCodeSdkClient(input);

  return {
    async listProviders() {
      const response = await client.provider.list();
      return normalizeProviderListPayload((response as { data?: unknown } | undefined)?.data);
    },

    async getSession(sessionId) {
      try {
        const response = await client.session.get({ sessionID: sessionId });
        const data = asRecord((response as { data?: unknown } | undefined)?.data);
        if (typeof data.id !== 'string') return null;
        return {
          id: data.id,
          ...(typeof data.parentID === 'string' ? { parentID: data.parentID } : {})
        };
      } catch (error) {
        if (isOpenCodeNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async createSession({ title, permission }) {
      const response = await client.session.create({
        ...(title ? { title } : {}),
        ...(permission ? { permission } : {})
      });
      const data = asRecord((response as { data?: unknown } | undefined)?.data);
      if (typeof data.id !== 'string') {
        throw new Error('OpenCode did not return a session id.');
      }
      return { id: data.id };
    },

    async forkSession({ sessionId, directory }) {
      const response = await client.session.fork({
        sessionID: sessionId,
        ...(directory ? { directory } : {})
      });
      const data = asRecord((response as { data?: unknown } | undefined)?.data);
      if (typeof data.id !== 'string') {
        throw new Error('OpenCode did not return a forked session id.');
      }
      return { id: data.id };
    },

    async deleteSession(sessionId) {
      await client.session.delete({ sessionID: sessionId });
    },

    async prompt({ sessionId, model, parts, system, variant, agent }) {
      const response = await client.session.prompt({
        sessionID: sessionId,
        model: { providerID: model.providerID, modelID: model.modelID },
        ...(variant ? { variant } : {}),
        ...(agent ? { agent } : {}),
        ...(system ? { system } : {}),
        parts: parts.map((part) =>
          part.type === 'text'
            ? { type: 'text' as const, text: part.text ?? '' }
            : {
                type: 'file' as const,
                mime: part.mime ?? 'application/octet-stream',
                url: part.url ?? '',
                ...(part.filename ? { filename: part.filename } : {})
              }
        )
      });

      const data = asRecord((response as { data?: unknown } | undefined)?.data);
      const info = asRecord(data.info);
      const tokens = asRecord(info.tokens);
      const cache = asRecord(tokens.cache);
      const errorText = describeMessageError(info.error);

      return {
        text: collectText(data.parts, 'text'),
        reasoning: collectText(data.parts, 'reasoning'),
        tokens: {
          ...(typeof tokens.input === 'number' ? { input: tokens.input } : {}),
          ...(typeof tokens.output === 'number' ? { output: tokens.output } : {}),
          ...(typeof tokens.reasoning === 'number' ? { reasoning: tokens.reasoning } : {}),
          ...(typeof cache.read === 'number' ? { cacheRead: cache.read } : {})
        },
        ...(errorText ? { errorText } : {})
      };
    },

    async abort(sessionId) {
      await client.session.abort({ sessionID: sessionId });
    },

    async listChildren(sessionId) {
      try {
        const response = await client.session.children({ sessionID: sessionId });
        const data = (response as { data?: unknown } | undefined)?.data;
        if (Array.isArray(data)) {
          return data
            .map((item) => asRecord(item))
            .filter((item): item is { id: string } => typeof item.id === "string")
            .map((item) => ({ id: item.id }));
        }
        return [];
      } catch (error) {
        if (isOpenCodeNotFound(error)) {
          return [];
        }
        throw error;
      }
    },

    async replyToPermission({ requestId, reply }) {
      await client.permission.reply({ requestID: requestId, reply });
    },

    async replyToQuestion({ requestId, answers }) {
      await client.question.reply({ requestID: requestId, answers });
    },

    async rejectQuestion({ requestId }) {
      await client.question.reject({ requestID: requestId });
    },

    async listPermissions() {
      const response = await client.permission.list();
      const data = (response as { data?: unknown } | undefined)?.data;
      return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    },

    async listQuestions() {
      const response = await client.question.list();
      const data = (response as { data?: unknown } | undefined)?.data;
      return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    },

    subscribeEvents(signal: AbortSignal): AsyncIterable<unknown> {
      return {
        async *[Symbol.asyncIterator]() {
          const subscription = await client.event.subscribe({}, { signal });
          for await (const event of subscription.stream) {
            if (signal.aborted) return;
            yield event;
          }
        }
      };
    }
  };
}
