import type {
  ChatMessagePart,
  ChatReasoningPart,
  ChatTextPart,
  ChatToolPart,
  MessageRole,
  StreamEvent
} from './contracts';

function stringifyJson(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildFallbackMessageParts({
  content,
  reasoning,
  role
}: {
  content: string;
  reasoning?: string | null;
  role: MessageRole;
}): ChatMessagePart[] {
  if (role !== 'assistant') {
    return content.trim()
      ? [{ id: 'text-legacy', type: 'text', text: content, state: 'done' }]
      : [];
  }

  const parts: ChatMessagePart[] = [];

  if (reasoning?.trim()) {
    parts.push({ id: 'reasoning-legacy', type: 'reasoning', text: reasoning, state: 'done' });
  }

  if (content.trim()) {
    parts.push({ id: 'text-legacy', type: 'text', text: content, state: 'done' });
  }

  return parts;
}

function appendOrCreateTextPart(
  parts: ChatMessagePart[],
  id: string,
  type: 'text' | 'reasoning',
  delta: string
): ChatMessagePart[] {
  if (!delta) {
    return parts;
  }

  const index = parts.findIndex((part) => part.type === type && part.id === id);

  if (index === -1) {
    const part: ChatTextPart | ChatReasoningPart =
      type === 'text'
        ? { id, type, text: delta, state: 'streaming' }
        : { id, type, text: delta, state: 'streaming' };

    return [...parts, part];
  }

  return parts.map((part, partIndex) =>
    partIndex === index && part.type === type
      ? { ...part, text: `${part.text}${delta}`, state: 'streaming' }
      : part
  );
}

export function upsertToolPart(
  parts: ChatMessagePart[],
  toolCallId: string,
  updater: (part: ChatToolPart | undefined) => ChatToolPart
): ChatMessagePart[] {
  const index = parts.findIndex(
    (part) => part.type === 'tool' && part.toolCallId === toolCallId
  );
  const existing = index === -1 ? undefined : (parts[index] as ChatToolPart);
  const nextPart = updater(existing);

  if (index === -1) {
    return [...parts, nextPart];
  }

  return parts.map((part, currentIndex) => {
    if (currentIndex !== index) {
      return part;
    }

    return nextPart;
  });
}

export function applyStreamEventToParts(parts: ChatMessagePart[], event: StreamEvent): ChatMessagePart[] {
  switch (event.type) {
    case 'chunk':
      return appendOrCreateTextPart(parts, event.id, 'text', event.delta);
    case 'reasoning':
      return appendOrCreateTextPart(parts, event.id, 'reasoning', event.delta);
    case 'tool-input-start':
      return upsertToolPart(parts, event.toolCallId, (part) => ({
        id: part?.id ?? event.toolCallId,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state: 'input-streaming',
        rawInput: part?.rawInput ?? '',
        input: part?.input,
        output: part?.output,
        errorText: part?.errorText,
        dynamic: event.dynamic ?? part?.dynamic,
        providerExecuted: event.providerExecuted ?? part?.providerExecuted,
        title: event.title ?? part?.title,
        preliminary: part?.preliminary,
        approval: part?.approval
      }));
    case 'tool-input-delta':
      return upsertToolPart(parts, event.toolCallId, (part) => ({
        id: part?.id ?? event.toolCallId,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: part?.toolName ?? 'tool',
        state: 'input-streaming',
        rawInput: `${part?.rawInput ?? ''}${event.delta}`,
        input: part?.input,
        output: part?.output,
        errorText: part?.errorText,
        dynamic: part?.dynamic,
        providerExecuted: part?.providerExecuted,
        title: part?.title,
        preliminary: part?.preliminary,
        approval: part?.approval
      }));
    case 'tool-input-available':
      return upsertToolPart(parts, event.toolCallId, (part) => ({
        id: part?.id ?? event.toolCallId,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state: 'input-available',
        rawInput: part?.rawInput ?? stringifyJson(event.input),
        input: event.input,
        output: part?.output,
        errorText: undefined,
        dynamic: event.dynamic ?? part?.dynamic,
        providerExecuted: event.providerExecuted ?? part?.providerExecuted,
        title: event.title ?? part?.title,
        preliminary: part?.preliminary,
        approval: part?.approval
      }));
    case 'tool-output-available':
      return upsertToolPart(parts, event.toolCallId, (part) => ({
        id: part?.id ?? event.toolCallId,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state: 'output-available',
        rawInput: part?.rawInput ?? stringifyJson(event.input),
        input: event.input ?? part?.input,
        output: event.output,
        errorText: undefined,
        dynamic: event.dynamic ?? part?.dynamic,
        providerExecuted: event.providerExecuted ?? part?.providerExecuted,
        title: event.title ?? part?.title,
        preliminary: event.preliminary,
        approval: part?.approval
      }));
    case 'tool-output-error':
      return upsertToolPart(parts, event.toolCallId, (part) => ({
        id: part?.id ?? event.toolCallId,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state: 'output-error',
        rawInput: part?.rawInput ?? stringifyJson(event.input),
        input: event.input ?? part?.input,
        output: undefined,
        errorText: event.errorText,
        dynamic: event.dynamic ?? part?.dynamic,
        providerExecuted: event.providerExecuted ?? part?.providerExecuted,
        title: event.title ?? part?.title,
        preliminary: false,
        approval: part?.approval
      }));
    case 'tool-output-denied':
      return upsertToolPart(parts, event.toolCallId, (part) => ({
        id: part?.id ?? event.toolCallId,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: part?.toolName ?? 'tool',
        state: 'output-denied',
        rawInput: part?.rawInput,
        input: part?.input,
        output: undefined,
        errorText: undefined,
        dynamic: part?.dynamic,
        providerExecuted: part?.providerExecuted,
        title: part?.title,
        preliminary: false,
        approval: {
          id: event.toolCallId,
          approved: false
        }
      }));
    default:
      return parts;
  }
}

export function finalizeMessageParts(parts: ChatMessagePart[]) {
  return parts.map((part) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      return {
        ...part,
        state: 'done' as const
      };
    }

    return part;
  });
}

export function getTextContentFromParts(parts: ChatMessagePart[]) {
  return parts
    .filter((part): part is ChatTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim();
}

export function getReasoningContentFromParts(parts: ChatMessagePart[]) {
  const value = parts
    .filter((part): part is ChatReasoningPart => part.type === 'reasoning')
    .map((part) => part.text)
    .join('\n\n')
    .trim();

  return value || null;
}
