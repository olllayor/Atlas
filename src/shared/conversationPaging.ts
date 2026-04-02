export type ConversationPageCursorPayload = {
  createdAt: string;
  id: string;
};

export function encodeConversationPageCursor(payload: ConversationPageCursorPayload) {
  return encodeURIComponent(JSON.stringify(payload));
}

export function decodeConversationPageCursor(cursor: string) {
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor)) as ConversationPageCursorPayload;
    if (!parsed?.createdAt || !parsed?.id) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
