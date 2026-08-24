import type {
  ProviderId,
  ChatMessagePart,
  ConversationPage,
  RuntimeEventEnvelope,
  RuntimeStateSnapshot,
  StreamEvent,
  WorkLogEntry,
} from '../../shared/contracts';
import { applyStreamEventToParts } from '../../shared/messageParts';
import { applyRuntimeEventToMessageParts, deriveWorkLogEntry, getWorkLogEntryId } from '../../shared/runtimeActivity';
import type { QueuedFollowupEntry } from './useAppStore';

import {
  getReasoningContentFromParts,
  getTextContentFromParts
} from '../../shared/messageParts';
import { DEFAULT_CONVERSATION_PAGE_SIZE, mergeConversationPage } from './conversationCache';

// =============================================================================
// Stream event reducers
//
// Each function in this file is a pure (state, input) -> partial-state reducer.
// They are wired into the AppStore via thin wrappers in useAppStore.ts so the
// store can interleave them with side-effects (IPC, notifications, etc.) but
// the core state-mutation logic stays here, testable in isolation, and out of
// the 1500-line store file.
//
// The chat runtime in src/main sends events keyed by `requestId`. The renderer
// has to fan them out to the right conversation and the right message part.
// That fan-out is what these reducers implement.
// =============================================================================

export type DraftState = {
  requestId: string;
  providerId: ProviderId;
  modelId: string;
  parts: ChatMessagePart[];
  status: 'queued' | 'streaming' | 'error' | 'aborted';
  errorMessage?: string;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  } | null;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  startedAt: string;
  /**
   * Transient status for the attempt in flight — a retry, a compaction —
   * cleared by the next token. Not part of the transcript: it describes how the
   * answer is being produced, not what the answer is, and a thread reopened
   * tomorrow must not still be announcing a retry that then succeeded.
   */
  notice?: { code: string; message: string; level: 'info' | 'warning' } | null;
};

export type RuntimeEventFanOut = {
  // Minimal slice of the store these reducers need to read or write.
  // Keeping the contract narrow makes the reducers trivially testable.
  draftsByConversation: Record<string, DraftState | undefined>;
  conversationDetails: Record<string, ConversationPage>;
  requestToConversation: Record<string, string>;
  runtimeSequenceByConversation: Record<string, number>;
  activitiesByConversation?: Record<string, WorkLogEntry[]>;
  queuedByConversation?: Record<string, QueuedFollowupEntry[]>;
};

export type RuntimeEventFanOutPatch = Partial<Pick<
  RuntimeEventFanOut,
  'draftsByConversation' | 'conversationDetails' | 'requestToConversation' | 'runtimeSequenceByConversation' | 'activitiesByConversation' | 'queuedByConversation'
>>;

export type Patch = RuntimeEventFanOutPatch | ((state: RuntimeEventFanOut) => RuntimeEventFanOutPatch | RuntimeEventFanOut);

// =============================================================================
// runtime-sync reducer: applies a full snapshot from the main process.
// Used when the renderer reconnects to a conversation and the local event
// log has gaps.
// =============================================================================
export function applyRuntimeSnapshotToStore(
  state: RuntimeEventFanOut,
  conversationId: string,
  snapshot: RuntimeStateSnapshot,
  page?: Pick<ConversationPage, 'hasOlder' | 'nextCursor' | 'limit'>,
): RuntimeEventFanOutPatch {
  const existingDetail = state.conversationDetails[conversationId];
  const detail: ConversationPage = {
    conversation: snapshot.conversation ?? existingDetail?.conversation ?? {
      id: conversationId,
      title: 'Session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      defaultProviderId: null,
      defaultModelId: null,
    },
    messages: snapshot.messages,
    // `page` carries the pagination truth a caller already has (e.g. the
    // `conversations.getPage` result in `loadConversation`). It wins over the
    // cached detail because that call site only runs when the conversation is
    // NOT yet cached, so `existingDetail` is empty there; once a conversation
    // is cached with richer paging (after pre-pending older pages), the cached
    // flags win so pre-pending stays visible.
    hasOlder: page?.hasOlder ?? existingDetail?.hasOlder ?? false,
    nextCursor: page?.nextCursor ?? existingDetail?.nextCursor ?? null,
    limit: page?.limit ?? existingDetail?.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE,
  };

  const nextDraft = buildDraftFromRuntimeSnapshot(snapshot, state.draftsByConversation[conversationId]);
  const nextDrafts = { ...state.draftsByConversation };

  if (nextDraft) {
    nextDrafts[conversationId] = nextDraft;
  } else {
    delete nextDrafts[conversationId];
  }

  return {
    conversationDetails: {
      ...state.conversationDetails,
      [conversationId]: detail,
    },
    activitiesByConversation: {
      ...(state.activitiesByConversation ?? {}),
      [conversationId]: snapshot.activities ?? [],
    },
    draftsByConversation: nextDrafts,
    runtimeSequenceByConversation: {
      ...state.runtimeSequenceByConversation,
      [conversationId]: snapshot.lastSequence,
    },
    queuedByConversation: {
      ...(state.queuedByConversation ?? {}),
      // The durable fold wins over whatever the live session accumulated: a
      // restart's snapshot is the only complete view of the waiting line.
      [conversationId]: snapshot.pendingFollowups ?? [],
    },
  };
}

function buildDraftFromRuntimeSnapshot(
  snapshot: RuntimeStateSnapshot,
  currentDraft?: DraftState,
): DraftState | undefined {
  const streamingAssistant = [...snapshot.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.status === 'streaming');

  if (!streamingAssistant || snapshot.providerSession?.status !== 'active') {
    return undefined;
  }

  return {
    requestId: snapshot.providerSession.requestId,
    providerId: snapshot.providerSession.providerId,
    modelId: snapshot.providerSession.modelId,
    parts: streamingAssistant.parts,
    status: 'streaming' as const,
    startedAt: currentDraft?.startedAt ?? streamingAssistant.createdAt,
    inputTokens: streamingAssistant.inputTokens ?? currentDraft?.inputTokens,
    outputTokens: streamingAssistant.outputTokens ?? currentDraft?.outputTokens,
    reasoningTokens: streamingAssistant.reasoningTokens ?? currentDraft?.reasoningTokens,
    latencyMs: streamingAssistant.latencyMs ?? currentDraft?.latencyMs,
  };
}

// =============================================================================
// Replay reducer: applies a batch of recovered events to the local cache.
// Used when runtime-sync tells us the renderer is behind the main process.
// =============================================================================
export function applyRecoveredRuntimeEventsToStore(
  state: RuntimeEventFanOut,
  conversationId: string,
  events: RuntimeEventEnvelope[],
): RuntimeEventFanOutPatch | RuntimeEventFanOut {
  const currentSequence = state.runtimeSequenceByConversation[conversationId] ?? 0;
  const nextEvents = events.filter((event) => event.sequence > currentSequence);
  if (nextEvents.length === 0) {
    return {};
  }

  let nextDrafts = state.draftsByConversation;
  let nextConversationDetails = state.conversationDetails;
  let nextRequestToConversation = state.requestToConversation;
  let nextRuntimeSequenceByConversation = state.runtimeSequenceByConversation;
  let nextActivitiesByConversation = state.activitiesByConversation;

  let draft = state.draftsByConversation[conversationId];
  const detail = state.conversationDetails[conversationId];
  let nextMessages = detail?.messages ?? null;

  for (const event of nextEvents) {
    if (nextRequestToConversation[event.requestId] !== conversationId) {
      if (nextRequestToConversation === state.requestToConversation) {
        nextRequestToConversation = { ...state.requestToConversation };
      }
      nextRequestToConversation[event.requestId] = conversationId;
    }

    const currentActivities = (nextActivitiesByConversation ?? state.activitiesByConversation ?? {})[conversationId] ?? [];
    const existingActivityId = getWorkLogEntryId(event);
    const existingIndex = currentActivities.findIndex((a) => a.id === existingActivityId);
    const existingActivity = existingIndex !== -1 ? currentActivities[existingIndex] : null;
    const nextActivity = deriveWorkLogEntry(existingActivity, event);

    if (nextActivity) {
      if (!nextActivitiesByConversation || nextActivitiesByConversation === state.activitiesByConversation) {
        nextActivitiesByConversation = { ...(state.activitiesByConversation ?? {}) };
      }
      const updatedActivities = [...currentActivities];
      if (existingIndex !== -1) {
        updatedActivities[existingIndex] = nextActivity;
      } else {
        updatedActivities.push(nextActivity);
      }
      nextActivitiesByConversation[conversationId] = updatedActivities;
    }

    if (draft?.requestId === event.requestId) {
      const nextParts = applyRuntimeEventToMessageParts(draft.parts, event);
      if (nextParts !== draft.parts) {
        if (nextDrafts === state.draftsByConversation) {
          nextDrafts = { ...state.draftsByConversation };
        }
        draft = {
          ...draft,
          parts: nextParts,
        };
        nextDrafts[conversationId] = draft;
      }
    }

    if (detail && nextMessages) {
      const messageIndex = nextMessages.findIndex((message) => message.id === event.messageId);
      if (messageIndex !== -1) {
        const message = nextMessages[messageIndex];
        const nextParts = applyRuntimeEventToMessageParts(message.parts, event);

        if (nextParts !== message.parts) {
          if (nextConversationDetails === state.conversationDetails) {
            nextConversationDetails = { ...state.conversationDetails };
          }
          if (nextMessages === detail.messages) {
            nextMessages = [...detail.messages];
          }

          nextMessages[messageIndex] = {
            ...message,
            parts: nextParts,
            content: getTextContentFromParts(nextParts),
            reasoning: getReasoningContentFromParts(nextParts),
          };

          nextConversationDetails[conversationId] = {
            ...detail,
            messages: nextMessages,
          };
        }
      }
    }
  }

  const latestSequence = nextEvents[nextEvents.length - 1]?.sequence ?? currentSequence;
  if (latestSequence !== currentSequence) {
    if (nextRuntimeSequenceByConversation === state.runtimeSequenceByConversation) {
      nextRuntimeSequenceByConversation = { ...state.runtimeSequenceByConversation };
    }
    nextRuntimeSequenceByConversation[conversationId] = latestSequence;
  }

  if (
    nextDrafts === state.draftsByConversation &&
    nextConversationDetails === state.conversationDetails &&
    nextRequestToConversation === state.requestToConversation &&
    nextRuntimeSequenceByConversation === state.runtimeSequenceByConversation &&
    nextActivitiesByConversation === state.activitiesByConversation
  ) {
    return {};
  }

  return {
    draftsByConversation: nextDrafts,
    conversationDetails: nextConversationDetails,
    requestToConversation: nextRequestToConversation,
    runtimeSequenceByConversation: nextRuntimeSequenceByConversation,
    activitiesByConversation: nextActivitiesByConversation,
  };
}

// =============================================================================
// Per-event reducer: applies a single streamed event (text delta, tool call,
// reasoning delta, etc.) to the matching conversation + draft + message.
// =============================================================================
const STREAMING_EVENT_TYPES = new Set<StreamEvent['type']>([
  'chunk',
  'reasoning',
  'tool-input-start',
  'tool-input-delta',
  'tool-input-available',
  'tool-approval-requested',
  'tool-approval-responded',
  'tool-output-available',
  'tool-output-error',
  'tool-output-denied',
  'visual-start',
  'visual-complete',
]);

export function isStreamingEvent(event: StreamEvent): boolean {
  return STREAMING_EVENT_TYPES.has(event.type);
}

export function applyStreamingEvent(
  state: RuntimeEventFanOut,
  conversationId: string,
  event: StreamEvent,
): RuntimeEventFanOutPatch | null {
  if (!isStreamingEvent(event)) {
    return null;
  }

  const draft = state.draftsByConversation[conversationId];
  const detail = state.conversationDetails[conversationId];

  const nextDrafts = { ...state.draftsByConversation };
  const nextDetails = { ...state.conversationDetails };
  let changed = false;

  // Events belong to their own request. While a follow-up sits queued behind
  // a running turn, the live draft carries the follow-up's id — without this
  // guard the running turn's deltas would bleed into the queued draft and
  // render as phantom text over a turn that has not started. The two
  // conversation-level events carry `conversationId` instead of `requestId`
  // and are fan-out concerns, not draft content.
  if (draft && 'requestId' in event && event.requestId === draft.requestId) {
    nextDrafts[conversationId] = {
      ...draft,
      // Dispatch happened: a queued follow-up receiving its own first event is
      // streaming now. Streaming drafts stay untouched here.
      status: draft.status === 'queued' ? 'streaming' : draft.status,
      // Progress retires the notice: whatever it was warning about is over the
      // moment tokens arrive.
      notice: null,
      parts: applyStreamEventToParts(draft.parts, event)
    };
    changed = true;
  }

  if (detail) {
    const streamingAssistantIndex = findStreamingAssistantIndex(detail);
    if (streamingAssistantIndex != null) {
      const nextMessages = detail.messages.map((message, index) => {
        if (index !== streamingAssistantIndex) {
          return message;
        }

        return {
          ...message,
          parts: applyStreamEventToParts(message.parts, event)
        };
      });

      nextDetails[conversationId] = {
        ...detail,
        messages: nextMessages
      };
      changed = true;
    }
  }

  if (!changed) {
    return null;
  }

  return {
    draftsByConversation: nextDrafts,
    conversationDetails: nextDetails
  };
}

/**
 * Park a notice on the draft so the transcript can say what is happening
 * between attempts. A notice for a conversation with no live draft is dropped:
 * there is nothing in flight for it to describe.
 */
export function applyNoticeEvent(
  state: RuntimeEventFanOut,
  conversationId: string,
  event: Extract<StreamEvent, { type: 'notice' }>,
): RuntimeEventFanOutPatch | null {
  const draft = state.draftsByConversation[conversationId];
  // Same request-scoping as streaming events: an attempt notice belongs to
  // the turn it describes, never to a queued follow-up's placeholder draft.
  if (!draft || event.requestId !== draft.requestId) {
    return null;
  }

  return {
    draftsByConversation: {
      ...state.draftsByConversation,
      [conversationId]: {
        ...draft,
        notice: { code: event.code, message: event.message, level: event.level },
      },
    },
  };
}

export function applyMetaEvent(
  state: RuntimeEventFanOut,
  conversationId: string,
  event: Extract<StreamEvent, { type: 'meta' }>,
): RuntimeEventFanOutPatch | null {
  const draft = state.draftsByConversation[conversationId];
  const detail = state.conversationDetails[conversationId];
  const nextDrafts = { ...state.draftsByConversation };
  const nextDetails = { ...state.conversationDetails };
  let changed = false;

  if (draft) {
    nextDrafts[conversationId] = {
      ...draft,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      reasoningTokens: event.reasoningTokens,
      latencyMs: event.latencyMs
    };
    changed = true;
  }

  if (detail) {
    const streamingAssistantIndex = findStreamingAssistantIndex(detail);
    if (streamingAssistantIndex != null) {
      const nextMessages = detail.messages.map((message, index) => {
        if (index !== streamingAssistantIndex) {
          return message;
        }

        return {
          ...message,
          inputTokens: event.inputTokens ?? message.inputTokens,
          outputTokens: event.outputTokens ?? message.outputTokens,
          reasoningTokens: event.reasoningTokens ?? message.reasoningTokens,
          latencyMs: event.latencyMs ?? message.latencyMs
        };
      });

      nextDetails[conversationId] = {
        ...detail,
        messages: nextMessages
      };
      changed = true;
    }
  }

  if (!changed) {
    return null;
  }

  return {
    draftsByConversation: nextDrafts,
    conversationDetails: nextDetails
  };
}

function findStreamingAssistantIndex(detail: ConversationPage): number | null {
  for (let index = detail.messages.length - 1; index >= 0; index -= 1) {
    const message = detail.messages[index];
    if (message && message.role === 'assistant' && message.status === 'streaming') {
      return index;
    }
  }
  return null;
}
