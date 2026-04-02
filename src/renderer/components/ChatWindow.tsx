import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertCircle,
  ArrowDown,
  Bug,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileText,
  Lightbulb,
  MessageSquare,
  PenTool,
  RefreshCw,
  Search,
  StopCircle,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';

import type { ChatMessage, ChatMessagePart, ConversationPage } from '../../shared/contracts';
import type { DraftStateLike } from './types';
import { ConversationEmptyState } from './ai-elements/conversation';
import { MessageResponse } from './ai-elements/message';
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from './ai-elements/confirmation';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from './ai-elements/reasoning';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from './ai-elements/tool';
import { useClipboard } from '../hooks/useClipboard';

type ChatWindowProps = {
  detail: ConversationPage | null;
  draft: DraftStateLike | null;
  hasCredential: boolean;
  isLoadingConversation: boolean;
  isLoadingOlder: boolean;
  onOpenSettings: () => void;
  onSuggestionClick: (prompt: string) => void;
  onLoadOlderMessages: (conversationId: string) => Promise<void>;
};

const HISTORY_LEADING_OVERSCAN = 4;
const HISTORY_TRAILING_OVERSCAN = 2;
const HISTORY_GAP_PX = 32;

const suggestions = [
  { icon: Lightbulb, text: 'Explain a concept', prompt: 'Explain quantum computing in simple terms' },
  { icon: Code2, text: 'Write code', prompt: 'Write a Python function that sorts a list' },
  { icon: Bug, text: 'Debug an error', prompt: 'Help me debug this error: ' },
  { icon: FileText, text: 'Summarize text', prompt: 'Summarize the key points of ' },
  { icon: PenTool, text: 'Help me write', prompt: 'Help me write an email that ' },
  { icon: Search, text: 'Research something', prompt: 'Tell me about ' },
];

function MessageMeta({
  latencyMs,
  modelLabel,
}: {
  latencyMs?: number | null;
  modelLabel?: string | null;
}) {
  if (!latencyMs && !modelLabel) {
    return null;
  }

  return (
    <div className="mt-3 flex min-h-4 flex-wrap items-center gap-2">
      {latencyMs ? (
        <span className="inline-flex items-center rounded-full border border-border-subtle bg-bg-hover px-2.5 py-1 font-mono text-[10.5px] leading-none tabular-nums text-text-faint/85">
          {latencyMs}ms
        </span>
      ) : null}
      {modelLabel ? (
        <span
          className="inline-flex max-w-[min(100%,360px)] items-center rounded-full border border-border-subtle bg-bg-hover px-2.5 py-1 text-[10.5px] leading-none text-text-faint/80"
          title={modelLabel}
        >
          {modelLabel}
        </span>
      ) : null}
    </div>
  );
}

function ReasoningRow({
  text,
  isStreaming = false,
  latencyMs,
}: {
  text?: string | null;
  isStreaming?: boolean;
  latencyMs?: number | null;
}) {
  if (!text?.trim()) {
    return null;
  }

  return (
    <Reasoning
      className="mb-2.5"
      defaultOpen={false}
      duration={latencyMs ? Math.max(1, Math.round(latencyMs / 1000)) : undefined}
      isStreaming={isStreaming}
    >
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

function ToolRow({ part }: { part: Extract<ChatMessagePart, { type: 'tool' }> }) {
  const isOutputState =
    part.state === 'output-available' ||
    part.state === 'output-error' ||
    part.state === 'output-denied';
  const hasInput = part.rawInput != null || part.input != null;
  const hasOutput = part.output != null || Boolean(part.errorText) || part.state === 'output-denied';
  const hasApproval = Boolean(part.approval);
  const resolvedName = part.title?.trim() || part.toolName.replace(/[_-]+/g, ' ');

  return (
    <Tool className="mb-2.5" defaultOpen={isOutputState}>
      <ToolHeader
        type={part.dynamic ? 'dynamic-tool' : `tool-${part.toolName}`}
        toolName={part.toolName}
        title={part.title}
        state={part.state}
      />
      {hasInput || hasOutput || hasApproval ? (
        <ToolContent>
          <Confirmation approval={part.approval} state={part.state} className={hasInput || hasOutput ? 'mb-3' : undefined}>
            <ConfirmationTitle>Tool approval</ConfirmationTitle>
            <ConfirmationRequest>
              <div>
                Approve running <span className="font-medium text-white/86">{resolvedName}</span>.
              </div>
              {part.input ? (
                <pre className="mt-2 overflow-x-auto rounded-[12px] border border-white/6 bg-black/20 px-3 py-2 font-mono text-[11px] leading-5 text-white/58">
                  {JSON.stringify(part.input, null, 2)}
                </pre>
              ) : null}
            </ConfirmationRequest>
            <ConfirmationAccepted>
              <CheckCircle2 className="size-4" />
              <span>Tool execution approved</span>
            </ConfirmationAccepted>
            <ConfirmationRejected>
              <XCircle className="size-4" />
              <span>Tool execution rejected</span>
            </ConfirmationRejected>
          </Confirmation>
          {hasInput ? <ToolInput input={part.input ?? part.rawInput ?? ''} /> : null}
          {hasOutput ? (
            <ToolOutput
              errorText={part.state === 'output-denied' ? 'Tool execution was denied.' : part.errorText}
              output={part.output}
              className={hasInput ? 'mt-3' : undefined}
            />
          ) : null}
        </ToolContent>
      ) : null}
    </Tool>
  );
}

function AssistantTextFallback({ content }: { content: string }) {
  if (!content.trim()) {
    return <div className="text-[13.5px] font-medium text-text-muted">Assistant response</div>;
  }

  return (
    <div className="whitespace-pre-wrap break-words text-[15.5px] leading-[1.85] tracking-[-0.01em] text-text-primary">
      {content}
    </div>
  );
}

function AssistantParts({
  content,
  isStreaming = false,
  latencyMs,
  parts,
  deferRichContent = false,
}: {
  content: string;
  isStreaming?: boolean;
  latencyMs?: number | null;
  parts: ChatMessagePart[];
  deferRichContent?: boolean;
}) {
  if (deferRichContent) {
    return <AssistantTextFallback content={content} />;
  }

  if (parts.length === 0) {
    return isStreaming ? (
      <div className="text-[13.5px] font-medium text-text-muted">Thinking...</div>
    ) : (
      <AssistantTextFallback content={content} />
    );
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'reasoning') {
          return (
            <ReasoningRow
              key={`reasoning-${index}`}
              text={part.text}
              latencyMs={latencyMs}
              isStreaming={isStreaming}
            />
          );
        }

        if (part.type === 'tool') {
          return <ToolRow key={part.toolCallId} part={part} />;
        }

        return (
          <MessageResponse
            key={`text-${index}`}
            className="text-[15.5px] leading-[1.85] tracking-[-0.01em] text-text-primary"
            isAnimating={isStreaming && index === parts.length - 1}
          >
            {part.text}
          </MessageResponse>
        );
      })}
    </>
  );
}

function MessageRow({
  message,
  deferRichContent = false,
  onRegenerate,
}: {
  message: ChatMessage;
  deferRichContent?: boolean;
  onRegenerate?: () => void;
}) {
  const { copied, copy } = useClipboard();
  const isAssistant = message.role === 'assistant';

  if (!isAssistant) {
    return (
      <div className="group flex w-full justify-end">
        <div className="max-w-[min(62%,680px)]">
          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.085),rgba(255,255,255,0.045))] px-5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="whitespace-pre-wrap text-[14px] leading-7 text-text-primary">{message.content}</p>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => void copy(message.content)}
              className="rounded-full p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
              title={copied ? 'Copied!' : 'Copy'}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full">
      <div className="min-w-0 max-w-[min(100%,82ch)] flex-1">
        <AssistantParts
          content={message.content}
          latencyMs={message.status === 'complete' ? message.latencyMs : null}
          parts={message.parts}
          deferRichContent={deferRichContent}
        />

        <MessageMeta latencyMs={message.status === 'complete' ? message.latencyMs : null} modelLabel={message.modelId} />

        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void copy(message.content)}
            className="rounded-full p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {onRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-full p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
              title="Regenerate"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StreamingRow({
  parts,
  modelLabel,
  errorMessage,
  status,
}: {
  parts: ChatMessagePart[];
  modelLabel?: string;
  errorMessage?: string;
  status: 'streaming' | 'error' | 'aborted';
}) {
  const isError = status === 'error';
  const isAborted = status === 'aborted';

  return (
    <div className="group flex w-full">
      <div className="min-w-0 max-w-[min(100%,84ch)] flex-1">
        {isError ? (
          <div className="rounded-2xl border border-error-border bg-error-bg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-error-text">Something went wrong</p>
                <p className="mt-1 text-xs text-error-text/80">{errorMessage}</p>
              </div>
            </div>
          </div>
        ) : isAborted ? (
          <div className="rounded-2xl border border-border-subtle bg-bg-subtle p-4">
            <div className="flex items-start gap-3">
              <StopCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              <p className="text-sm text-text-muted">Generation stopped</p>
            </div>
          </div>
        ) : (
          <AssistantParts content="" isStreaming latencyMs={null} parts={parts} />
        )}

        {modelLabel ? <MessageMeta modelLabel={modelLabel} /> : null}
      </div>
    </div>
  );
}

function buildHistoryRangeExtractor(isStreaming: boolean) {
  return (range: Range) => {
    const trailingOverscan = isStreaming ? 0 : HISTORY_TRAILING_OVERSCAN;
    const start = Math.max(0, range.startIndex - HISTORY_LEADING_OVERSCAN);
    const end = Math.min(range.count - 1, range.endIndex + trailingOverscan);
    const indexes = new Set(defaultRangeExtractor(range));

    for (let index = start; index <= end; index += 1) {
      indexes.add(index);
    }

    return [...indexes].sort((left, right) => left - right);
  };
}

function estimateHistoryRowHeight(message: ChatMessage) {
  if (message.role === 'user') {
    return Math.min(260, 96 + Math.ceil(message.content.length / 120) * 22);
  }

  const toolCount = message.parts.filter((part) => part.type === 'tool').length;
  const reasoningCount = message.parts.filter((part) => part.type === 'reasoning').length;
  return Math.min(520, 156 + Math.ceil(message.content.length / 100) * 24 + toolCount * 84 + reasoningCount * 56);
}

function SuggestionsState({ onSuggestionClick }: { onSuggestionClick: (prompt: string) => void }) {
  return (
    <ConversationEmptyState
      icon={<MessageSquare className="h-12 w-12 text-text-muted" />}
      title="What can I help with?"
      description="Start with a prompt below or type your own message."
    >
      <div className="mt-6 grid w-full max-w-lg grid-cols-2 gap-3">
        {suggestions.map(({ icon: Icon, text, prompt }) => (
          <button
            key={text}
            type="button"
            onClick={() => onSuggestionClick(prompt)}
            className="flex items-center gap-3 rounded-xl border border-border-medium bg-bg-hover px-4 py-3 text-left text-sm text-text-tertiary transition hover:bg-bg-active hover:text-text-primary"
          >
            <Icon className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="truncate">{text}</span>
          </button>
        ))}
      </div>
    </ConversationEmptyState>
  );
}

export function ChatWindow({
  detail,
  draft,
  hasCredential,
  isLoadingConversation,
  isLoadingOlder,
  onOpenSettings,
  onSuggestionClick,
  onLoadOlderMessages,
}: ChatWindowProps) {
  const { scrollRef, contentRef, scrollToBottom, isAtBottom } = useStickToBottom({
    initial: 'instant',
    resize: 'smooth',
  });
  const pendingPrependRef = useRef<{
    conversationId: string;
    previousMessageCount: number;
    previousScrollHeight: number;
  } | null>(null);
  const lastAutoLoadCursorRef = useRef<string | null>(null);
  const conversationId = detail?.conversation.id ?? null;
  const messages = detail?.messages ?? [];
  const hasOlder = detail?.hasOlder ?? false;
  const nextCursor = detail?.nextCursor ?? null;
  const showSetupPrompt = Boolean(detail && !hasCredential && messages.length === 0);

  const rangeExtractor = useMemo(() => buildHistoryRangeExtractor(draft?.status === 'streaming'), [draft?.status]);
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: messages.length,
    estimateSize: (index) => estimateHistoryRowHeight(messages[index] ?? {
      id: `placeholder-${index}`,
      conversationId: conversationId ?? 'placeholder',
      role: 'assistant',
      content: '',
      reasoning: null,
      parts: [],
      status: 'complete',
      providerId: null,
      modelId: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: new Date(0).toISOString()
    }),
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => messages[index]?.id ?? index,
    gap: HISTORY_GAP_PX,
    overscan: 0,
    rangeExtractor,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleRange = rowVirtualizer.range;
  const shouldRenderVirtualizedHistory = messages.length === 0 || virtualItems.length > 0;

  const loadOlderMessages = useCallback(async () => {
    if (!detail || !hasOlder || isLoadingOlder) {
      return;
    }

    const scrollElement = scrollRef.current;
    if (scrollElement) {
      pendingPrependRef.current = {
        conversationId: detail.conversation.id,
        previousMessageCount: messages.length,
        previousScrollHeight: scrollElement.scrollHeight,
      };
    }

    await onLoadOlderMessages(detail.conversation.id);
  }, [detail, hasOlder, isLoadingOlder, messages.length, onLoadOlderMessages, scrollRef]);

  useEffect(() => {
    lastAutoLoadCursorRef.current = null;
  }, [conversationId]);

  useLayoutEffect(() => {
    if (!detail) {
      return;
    }

    const pendingPrepend = pendingPrependRef.current;
    const scrollElement = scrollRef.current;

    if (
      !pendingPrepend ||
      !scrollElement ||
      pendingPrepend.conversationId !== detail.conversation.id ||
      messages.length <= pendingPrepend.previousMessageCount
    ) {
      return;
    }

    const heightDelta = scrollElement.scrollHeight - pendingPrepend.previousScrollHeight;
    if (heightDelta > 0) {
      scrollElement.scrollTop += heightDelta;
    }

    pendingPrependRef.current = null;
  }, [detail, messages.length, scrollRef]);

  useEffect(() => {
    if (!detail || !hasOlder || isLoadingOlder || visibleRange?.startIndex !== 0 || !nextCursor) {
      return;
    }

    if (lastAutoLoadCursorRef.current === nextCursor) {
      return;
    }

    lastAutoLoadCursorRef.current = nextCursor;
    void loadOlderMessages();
  }, [detail, hasOlder, nextCursor, isLoadingOlder, loadOlderMessages, visibleRange?.startIndex]);

  useEffect(() => {
    if (!draft?.requestId) {
      return;
    }

    void scrollToBottom({
      animation: 'smooth',
      wait: false,
      ignoreEscapes: true,
    });
  }, [draft?.requestId, scrollToBottom]);

  const showSuggestions = Boolean(detail && hasCredential && messages.length === 0 && !draft);

  if (!detail) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-8 py-10 lg:px-12">
        {isLoadingConversation ? (
          <ConversationEmptyState
            icon={<RefreshCw className="h-10 w-10 animate-spin text-text-muted" />}
            title="Loading conversation"
            description="Fetching the latest messages for this session."
          />
        ) : (
          <SuggestionsState onSuggestionClick={onSuggestionClick} />
        )}
      </div>
    );
  }

  if (showSetupPrompt) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-8 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-2xl rounded-[24px] border border-warning-border bg-warning-bg p-6 text-center">
          <h2 className="text-lg font-medium text-text-primary">Add your API key to start</h2>
          <p className="mt-2 text-sm text-text-tertiary">
            Credentials are stored in your OS keychain. Nothing leaves your machine.
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-primary mt-4 px-4 py-2 text-sm"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite">
        <div ref={contentRef} className="mx-auto flex w-full max-w-content-max flex-col px-8 py-8 lg:px-10 xl:px-12 xl:py-10">
          {hasOlder ? (
            <div className="mb-6 flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlderMessages()}
                disabled={isLoadingOlder}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-border-default bg-bg-subtle px-4 text-[12.5px] font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-70"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingOlder ? 'animate-spin' : ''}`} />
                <span>{isLoadingOlder ? 'Loading older messages…' : 'Load older messages'}</span>
              </button>
            </div>
          ) : null}

          {showSuggestions ? (
            <SuggestionsState onSuggestionClick={onSuggestionClick} />
          ) : (
            shouldRenderVirtualizedHistory ? (
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {virtualItems.map((virtualItem) => {
                  const message = messages[virtualItem.index];
                  const isOutsideVisibleRange =
                    visibleRange != null &&
                    (virtualItem.index < visibleRange.startIndex || virtualItem.index > visibleRange.endIndex);

                  if (!message) {
                    return null;
                  }

                  return (
                    <div
                      key={virtualItem.key}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualItem.index}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${virtualItem.start}px)` }}
                    >
                      <MessageRow message={message} deferRichContent={isOutsideVisibleRange} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-8">
                {messages.map((message) => (
                  <MessageRow key={message.id} message={message} />
                ))}
              </div>
            )
          )}

          {draft ? (
            <div className={messages.length > 0 || showSuggestions ? 'mt-8' : undefined}>
              <StreamingRow
                parts={draft.parts}
                modelLabel={draft.modelId}
                errorMessage={draft.errorMessage}
                status={draft.status}
              />
            </div>
          ) : null}
        </div>
      </div>

      {!isAtBottom ? (
        <button
          type="button"
          onClick={() => void scrollToBottom({ animation: 'smooth' })}
          className="absolute bottom-4 left-1/2 inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-full border border-border-medium bg-bg-elevated px-4 text-sm text-text-primary shadow-elevated transition hover:bg-bg-active"
        >
          <ArrowDown className="h-4 w-4" />
          <span>Jump to latest</span>
        </button>
      ) : null}
    </div>
  );
}
