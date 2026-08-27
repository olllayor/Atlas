import type { ModelMessage } from 'ai';

import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ConversationSummariesRepo } from '../../db/repositories/conversationSummariesRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import type { ProviderAdapter } from '../core/ProviderAdapter';
import { requiresStoredCredential } from '../core/ProviderAdapter';
import type { ProviderRegistry } from '../core/providerRegistry';
import { estimateMessagesTokens } from '../../../shared/tokenEstimate';

const REFRESH_TIMEOUT_MS = 90_000;
const REFRESH_MAX_OUTPUT_TOKENS = 1_200;
/** The summarisation input is capped so a huge history cannot overflow the refresh call itself. */
const REFRESH_INPUT_TOKEN_BUDGET = 16_000;
const MESSAGE_TEXT_MAX_CHARS = 2_000;
/** Same fallback the subagent child executor uses, so a conversation with no defaults still refreshes. */
const FALLBACK_MODEL_ID = 'google/gemini-2.5-flash';

export type SummaryRefreshServiceDeps = {
  conversationsRepo: Pick<ConversationsRepo, 'getSummary'>;
  modelsRepo: Pick<ModelsRepo, 'getRuntimeHints'>;
  keychain: Pick<KeychainStore, 'getSecret'>;
  providers: ProviderRegistry;
  summaries: Pick<ConversationSummariesRepo, 'get' | 'upsert' | 'deleteForConversation'>;
};

/**
 * Upgrades the deterministic rolling summary with a model pass, fire-and-forget
 * in the `maybeGenerateTitle` tradition: it runs after the turn that computed
 * the summary, never blocks the send path, and never throws — a failed refresh
 * leaves the heuristic summary in place, which is still correct, just coarser.
 *
 * Durability: the row is marked 'building' before the call and 'ready' after,
 * so a crash mid-refresh is detectable (readers skip 'building' rows) instead
 * of leaving a half-written summary in the cache.
 */
export class SummaryRefreshService {
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: SummaryRefreshServiceDeps) {}

  /**
   * Fire-and-forget entry point: resolves when the refresh settles, never
   * rejects, and is safe to call from synchronous code without awaiting.
   */
  refresh(conversationId: string, fingerprint: string, olderMessages: ModelMessage[]): Promise<void> {
    return this.runRefresh(conversationId, fingerprint, olderMessages).catch(() => undefined);
  }

  private async runRefresh(conversationId: string, fingerprint: string, olderMessages: ModelMessage[]) {
    if (this.inFlight.has(conversationId)) {
      return;
    }
    this.inFlight.add(conversationId);

    const previous = this.safeGet(conversationId);

    try {
      const resolved = this.resolveProviderAndModel(conversationId);
      if (!resolved) {
        return;
      }
      const { adapter, providerId, modelId } = resolved;

      const apiKey = await this.deps.keychain.getSecret(providerId);
      // Same rule as the turn path: a provider that authenticates itself has
      // no stored key, and bailing here left it on heuristic summaries forever.
      if (!apiKey && requiresStoredCredential(adapter)) {
        return;
      }

      // Crash lock: readers ignore 'building' rows, so a mid-flight failure is
      // visible and retried rather than silently served.
      this.safeUpsert({
        conversationId,
        fingerprint,
        rollingSummary: previous?.rollingSummary ?? '',
        source: previous?.source ?? 'heuristic',
        status: 'building',
      });

      const transcript = renderTranscript(clampToTokenBudget(olderMessages, REFRESH_INPUT_TOKEN_BUDGET));
      if (!transcript) {
        this.restore(conversationId, fingerprint, previous);
        return;
      }

      const result = await adapter.streamChat({
        apiKey: apiKey ?? '',
        modelId,
        // Same catalog facts the turn itself uses; without them reasoning
        // models reject the default temperature with a hard 400.
        modelHints: this.deps.modelsRepo.getRuntimeHints(modelId),
        // A summary needs no deliberation, and thinking tokens come out of the
        // same budget as the answer.
        reasoningEffort: 'minimal',
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: transcript }],
        maxOutputTokens: REFRESH_MAX_OUTPUT_TOKENS,
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        onChunk: () => {},
      });

      const summary = sanitizeModelSummary(result.content);
      if (!summary) {
        this.restore(conversationId, fingerprint, previous);
        return;
      }

      // A newer turn may have written a fresh heuristic row (new fingerprint)
      // while the model was working; that row owns the next refresh, so a
      // stale upgrade must not clobber it.
      const current = this.safeGet(conversationId);
      if (current && current.fingerprint !== fingerprint) {
        return;
      }

      this.safeUpsert({
        conversationId,
        fingerprint,
        rollingSummary: summary,
        source: 'model',
        status: 'ready',
      });
    } catch (error) {
      // Never fatal — but never silent either. The heuristic summary already
      // serves the conversation; this only cost one background call.
      console.warn(`[compaction] model summary refresh failed for ${conversationId}.`, error);
      this.restore(conversationId, fingerprint, previous);
    } finally {
      this.inFlight.delete(conversationId);
    }
  }

  private resolveProviderAndModel(
    conversationId: string,
  ): { adapter: ProviderAdapter; providerId: string; modelId: string } | null {
    const convSummary = this.deps.conversationsRepo.getSummary(conversationId);
    const firstProviderId = Array.from(this.deps.providers.keys())[0];
    const providerId = convSummary?.defaultProviderId ?? firstProviderId;
    if (!providerId) {
      return null;
    }

    const adapter = this.deps.providers.get(providerId);
    if (!adapter) {
      return null;
    }

    const modelId = convSummary?.defaultModelId ?? FALLBACK_MODEL_ID;
    return { adapter, providerId, modelId };
  }

  private safeGet(conversationId: string) {
    try {
      return this.deps.summaries.get(conversationId);
    } catch {
      return null;
    }
  }

  private safeUpsert(input: {
    conversationId: string;
    fingerprint: string;
    rollingSummary: string;
    source: 'heuristic' | 'model';
    status: 'ready' | 'building';
  }) {
    try {
      this.deps.summaries.upsert(input);
    } catch {
      // Persistence is best effort; the in-memory summary still serves turns.
    }
  }

  /**
   * Put the pre-refresh row back (or clear the lock) when the model pass
   * fails. If a newer write landed mid-flight — a fresh heuristic row with a
   * different fingerprint — it wins and the restore is a no-op.
   */
  private restore(
    conversationId: string,
    fingerprint: string,
    previous: ReturnType<SummaryRefreshService['safeGet']>,
  ) {
    try {
      const current = this.deps.summaries.get(conversationId);
      if (current && current.fingerprint !== fingerprint) {
        return;
      }

      if (previous) {
        this.deps.summaries.upsert({
          conversationId,
          fingerprint: previous.fingerprint,
          rollingSummary: previous.rollingSummary,
          source: previous.source,
          status: 'ready',
        });
      } else {
        this.deps.summaries.deleteForConversation(conversationId);
      }
    } catch {
      // Best effort; a stuck 'building' row is skipped by readers and retried
      // on the next refresh.
    }
  }
}

/**
 * The write side of the checkpoint-compaction contract (user-authored): the
 * summary is a handoff for the LLM that resumes the conversation after
 * compaction. The read side — the addendum intro that presents this summary
 * back to the model — lives in `buildSystemContextAddendum` (ContextManager);
 * the two must stay in sync.
 */
const SUMMARY_SYSTEM_PROMPT =
  'You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.\n\n' +
  'Include:\n' +
  '- Current progress and key decisions made\n' +
  '- Important context, constraints, or user preferences\n' +
  '- What remains to be done (clear next steps)\n' +
  '- Any critical data, examples, or references needed to continue\n\n' +
  'Be concise, structured, and focused on helping the next LLM seamlessly continue the work.';

/**
 * Acceptance bar for model output (tune to taste — returning null keeps the
 * heuristic summary). The write prompt is free-form, so this checks for *any*
 * structure — markdown headers, "Section:" lines, or bullet lists — rather
 * than specific section names.
 */
export function sanitizeModelSummary(content: string | null | undefined): string | null {
  if (!content) {
    return null;
  }

  const trimmed = content.trim();
  if (trimmed.length < 40) {
    return null;
  }

  const hasHeader = /^#{1,4}\s/m.test(trimmed) || /^[A-Z][^\n]{0,60}:$/m.test(trimmed);
  const bulletCount = trimmed.match(/^[-*]\s/gm)?.length ?? 0;
  if (!hasHeader && bulletCount < 2) {
    return null;
  }

  // The addendum clamps anyway, but a runaway answer should not ride the DB.
  return trimmed.length > 4_000 ? `${trimmed.slice(0, 3_997).trimEnd()}...` : trimmed;
}

function clampToTokenBudget(messages: ModelMessage[], budget: number): ModelMessage[] {
  let kept = messages;
  while (kept.length > 1 && estimateMessagesTokens(kept) > budget) {
    kept = kept.slice(1);
  }
  return kept;
}

function renderTranscript(messages: ModelMessage[]): string {
  const sections = messages
    .map((message) => {
      const text = extractMessageText(message, MESSAGE_TEXT_MAX_CHARS);
      return text ? `## ${message.role}\n${text}` : '';
    })
    .filter(Boolean);

  return sections.join('\n\n');
}

function extractMessageText(message: ModelMessage, maxChars: number): string {
  const record = message as { content?: unknown };
  const content = record.content;

  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => {
        const item = part as { type?: unknown; text?: unknown };
        return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}
