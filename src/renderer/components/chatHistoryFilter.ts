import type { ChatMessage } from '../../shared/contracts';

/**
 * Filters conversation messages for display in the virtualized history.
 *
 * During streaming the live assistant turn is rendered outside the virtualizer
 * (by StreamingRow). To prevent duplicate rendering and height double-counting,
 * the streaming placeholder message at the end of the list is omitted from
 * history while the draft is actively streaming.
 *
 * Once the turn settles (draft is cleared or status is complete), the message
 * is included in history normally.
 */
export function filterHistoryMessages(
  messages: ChatMessage[],
  streaming: boolean | string | null | undefined,
): ChatMessage[] {
  const isStreaming = typeof streaming === 'boolean' ? streaming : streaming === 'streaming';
  if (!isStreaming || messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.status === 'streaming') {
    return messages.slice(0, -1);
  }
  return messages;
}
