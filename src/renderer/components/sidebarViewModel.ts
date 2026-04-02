import type { ConversationSummary } from '../../shared/contracts';
import type { DraftStateLike } from './types';

export type SidebarConversationItem = {
  id: string;
  isRunning: boolean;
  status: DraftStateLike['status'] | 'idle';
  primaryLabel: string;
  secondaryLabel: string | null;
  timestampLabel: string | null;
};

type BuildSidebarConversationItemsParams = {
  conversations: ConversationSummary[];
  draftsByConversation: Record<string, DraftStateLike | undefined>;
  now: number;
};

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function clipLabel(value: string, maxLength = 90) {
  const normalized = compactWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatRelativeTimestamp(timestamp: string | null | undefined, now: number) {
  if (!timestamp) {
    return null;
  }

  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) {
    return null;
  }

  const diffMs = Math.max(0, now - value);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return 'now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function buildSecondaryLabel(
  conversation: ConversationSummary,
  draft: DraftStateLike | undefined,
  primaryLabel: string
) {
  if (draft?.status === 'streaming') {
    return 'Thinking…';
  }

  if (draft?.status === 'error') {
    return draft.errorMessage ? clipLabel(draft.errorMessage, 70) : 'Something went wrong';
  }

  if (draft?.status === 'aborted') {
    return 'Generation stopped';
  }

  const assistantPreview = clipLabel(conversation.lastAssistantMessagePreview ?? '');
  if (assistantPreview && assistantPreview !== primaryLabel) {
    return assistantPreview;
  }

  const summaryPreview = clipLabel(conversation.lastMessagePreview ?? '');
  if (summaryPreview && summaryPreview !== primaryLabel) {
    return summaryPreview;
  }

  return null;
}

export function buildSidebarConversationItems({
  conversations,
  draftsByConversation,
  now,
}: BuildSidebarConversationItemsParams) {
  return conversations.map<SidebarConversationItem>((conversation) => {
    const draft = draftsByConversation[conversation.id];
    const conversationTitle = clipLabel(conversation.title);
    const primaryLabel =
      clipLabel(conversation.lastUserMessagePreview ?? '') ||
      clipLabel(conversation.lastMessagePreview ?? '') ||
      conversationTitle;

    return {
      id: conversation.id,
      isRunning: draft?.status === 'streaming',
      status: draft?.status ?? 'idle',
      primaryLabel,
      secondaryLabel: buildSecondaryLabel(conversation, draft, primaryLabel),
      timestampLabel: formatRelativeTimestamp(draft?.startedAt ?? conversation.updatedAt, now),
    };
  });
}
