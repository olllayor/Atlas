import type { ChatMessage, ConversationPage } from '../../shared/contracts';
import { encodeConversationPageCursor } from '../../shared/conversationPaging';

export const DEFAULT_CONVERSATION_PAGE_SIZE = 100;
export const INACTIVE_CONVERSATION_CACHE_LIMIT = 12;
export const MAX_INACTIVE_CACHED_MESSAGES = 3000;

export type ConversationScrollAnchor = {
  messageId: string;
  pixelDelta: number;
  foldExpanded: boolean;
};

const scrollAnchors = new Map<string, ConversationScrollAnchor>();

export function getConversationScrollAnchor(conversationId: string): ConversationScrollAnchor | null {
  return scrollAnchors.get(conversationId) ?? null;
}

export function setConversationScrollAnchor(conversationId: string, anchor: ConversationScrollAnchor): void {
  scrollAnchors.set(conversationId, anchor);
}

export function clearConversationScrollAnchor(conversationId: string): void {
  scrollAnchors.delete(conversationId);
}

export function compareConversationMessages(left: Pick<ChatMessage, 'createdAt' | 'id'>, right: Pick<ChatMessage, 'createdAt' | 'id'>) {
  const timestampDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.id.localeCompare(right.id);
}

export function compactConversationPage(detail: ConversationPage, limit = DEFAULT_CONVERSATION_PAGE_SIZE): ConversationPage {
  if (detail.messages.length <= limit) {
    return detail;
  }

  const messages = detail.messages.slice(-limit);
  const oldestLoadedMessage = messages[0];

  return {
    ...detail,
    messages,
    hasOlder: Boolean(oldestLoadedMessage) || detail.hasOlder || detail.messages.length > limit,
    nextCursor: oldestLoadedMessage
      ? encodeConversationPageCursor({
          createdAt: oldestLoadedMessage.createdAt,
          id: oldestLoadedMessage.id
        })
      : detail.nextCursor
  };
}

export function mergeConversationPage(existing: ConversationPage | undefined, latestPage: ConversationPage) {
  if (!existing || existing.messages.length === 0) {
    return latestPage;
  }

  const firstLatestMessage = latestPage.messages[0];
  if (!firstLatestMessage) {
    return latestPage;
  }

  const retainedOlderMessages = existing.messages.filter((message) => {
    if (message.id.startsWith('optimistic-')) {
      return false;
    }

    return compareConversationMessages(message, firstLatestMessage) < 0;
  });

  const oldestLoadedMessage = retainedOlderMessages[0] ?? latestPage.messages[0];
  const hasOlder =
    retainedOlderMessages.length > 0 ? existing.hasOlder || latestPage.hasOlder : latestPage.hasOlder;

  return {
    ...latestPage,
    messages: [...retainedOlderMessages, ...latestPage.messages],
    hasOlder,
    nextCursor: hasOlder && oldestLoadedMessage
      ? encodeConversationPageCursor({
          createdAt: oldestLoadedMessage.createdAt,
          id: oldestLoadedMessage.id
        })
      : null
  };
}

export function getLoadedConversationCounts(conversationDetails: Record<string, ConversationPage>) {
  return {
    loadedConversationCount: Object.keys(conversationDetails).length,
    loadedMessageCount: Object.values(conversationDetails).reduce((total, detail) => total + detail.messages.length, 0)
  };
}

export function reconcileConversationCache(args: {
  conversationDetails: Record<string, ConversationPage>;
  inactiveConversationIds: string[];
  previousSelectedId: string | null;
  nextSelectedId: string | null;
  inactiveLimit?: number;
  maxInactiveMessages?: number;
  compactLimit?: number;
}) {
  const {
    conversationDetails,
    inactiveConversationIds,
    previousSelectedId,
    nextSelectedId,
    inactiveLimit = INACTIVE_CONVERSATION_CACHE_LIMIT,
    maxInactiveMessages = MAX_INACTIVE_CACHED_MESSAGES,
    compactLimit
  } = args;

  const nextConversationDetails = { ...conversationDetails };
  let nextInactiveConversationIds = inactiveConversationIds.filter((conversationId) => conversationId !== nextSelectedId);

  if (
    previousSelectedId &&
    previousSelectedId !== nextSelectedId &&
    nextConversationDetails[previousSelectedId]
  ) {
    if (compactLimit !== undefined) {
      nextConversationDetails[previousSelectedId] = compactConversationPage(
        nextConversationDetails[previousSelectedId],
        compactLimit
      );
    }
    nextInactiveConversationIds = [
      previousSelectedId,
      ...nextInactiveConversationIds.filter((conversationId) => conversationId !== previousSelectedId)
    ];
  }

  // 1. Evict oldest inactive threads exceeding count limit
  while (nextInactiveConversationIds.length > inactiveLimit) {
    const evictedConversationId = nextInactiveConversationIds.pop();
    if (!evictedConversationId) {
      break;
    }

    delete nextConversationDetails[evictedConversationId];
    clearConversationScrollAnchor(evictedConversationId);
  }

  // 2. Enforce total inactive message watermark:
  // Compact oversized inactive threads (fattest first) instead of evicting innocent neighbors.
  const countInactiveMessages = () =>
    nextInactiveConversationIds.reduce(
      (total, id) => total + (nextConversationDetails[id]?.messages.length ?? 0),
      0
    );

  while (countInactiveMessages() > maxInactiveMessages) {
    let fattestId: string | null = null;
    let maxCount = DEFAULT_CONVERSATION_PAGE_SIZE;

    for (const id of nextInactiveConversationIds) {
      const msgCount = nextConversationDetails[id]?.messages.length ?? 0;
      if (msgCount > maxCount) {
        maxCount = msgCount;
        fattestId = id;
      }
    }

    if (fattestId && nextConversationDetails[fattestId]) {
      nextConversationDetails[fattestId] = compactConversationPage(
        nextConversationDetails[fattestId],
        DEFAULT_CONVERSATION_PAGE_SIZE
      );
    } else {
      // All inactive threads are already compacted to DEFAULT_CONVERSATION_PAGE_SIZE.
      // If watermark is still exceeded, evict the oldest inactive thread,
      // but always preserve the most recently left inactive thread (length > 1).
      if (nextInactiveConversationIds.length > 1) {
        const evictedId = nextInactiveConversationIds.pop();
        if (evictedId) {
          delete nextConversationDetails[evictedId];
          clearConversationScrollAnchor(evictedId);
        }
      } else {
        break;
      }
    }
  }

  return {
    conversationDetails: nextConversationDetails,
    inactiveConversationIds: nextInactiveConversationIds
  };
}
