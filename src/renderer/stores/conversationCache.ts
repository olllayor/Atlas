import type { ChatMessage, ConversationPage } from '../../shared/contracts';
import { encodeConversationPageCursor } from '../../shared/conversationPaging';

export const DEFAULT_CONVERSATION_PAGE_SIZE = 100;
export const INACTIVE_CONVERSATION_CACHE_LIMIT = 3;

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
    hasOlder: Boolean(oldestLoadedMessage),
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
  const hasOlder = retainedOlderMessages.length > 0 ? existing.hasOlder : latestPage.hasOlder;

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
  compactLimit?: number;
}) {
  const {
    conversationDetails,
    inactiveConversationIds,
    previousSelectedId,
    nextSelectedId,
    inactiveLimit = INACTIVE_CONVERSATION_CACHE_LIMIT,
    compactLimit = DEFAULT_CONVERSATION_PAGE_SIZE
  } = args;

  const nextConversationDetails = { ...conversationDetails };
  let nextInactiveConversationIds = inactiveConversationIds.filter((conversationId) => conversationId !== nextSelectedId);

  if (
    previousSelectedId &&
    previousSelectedId !== nextSelectedId &&
    nextConversationDetails[previousSelectedId]
  ) {
    nextConversationDetails[previousSelectedId] = compactConversationPage(
      nextConversationDetails[previousSelectedId],
      compactLimit
    );
    nextInactiveConversationIds = [
      previousSelectedId,
      ...nextInactiveConversationIds.filter((conversationId) => conversationId !== previousSelectedId)
    ];
  }

  while (nextInactiveConversationIds.length > inactiveLimit) {
    const evictedConversationId = nextInactiveConversationIds.pop();
    if (!evictedConversationId) {
      break;
    }

    delete nextConversationDetails[evictedConversationId];
  }

  return {
    conversationDetails: nextConversationDetails,
    inactiveConversationIds: nextInactiveConversationIds
  };
}
