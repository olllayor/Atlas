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
  PenTool,
  RefreshCw,
  Search,
  StopCircle,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';

import appIcon from '../../../icon.png';
import type { ChatMessage, ChatMessagePart, ConversationPage } from '../../shared/contracts';
import { getMessageFileParts } from '../../shared/attachments';
import { cn } from '../lib/utils';
import type { DraftStateLike } from './types';
import { Attachment, AttachmentInfo, AttachmentPreview, Attachments } from './ai-elements/attachments';
import { ConversationEmptyState } from './ai-elements/conversation';
import { MessageResponse } from './ai-elements/message';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from './ai-elements/confirmation';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from './ai-elements/tool';
import { VisualBlock } from './ai-elements/visual';
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
  onRespondToolApproval: (request: { requestId: string; approvalId: string; approved: boolean; reason?: string }) => Promise<void>;
};

const HISTORY_LEADING_OVERSCAN = 4;
const HISTORY_TRAILING_OVERSCAN = 2;
const HISTORY_GAP_PX = 26;

const suggestions = [
  { icon: Lightbulb, text: 'Explain a concept', prompt: 'Explain quantum computing in simple terms' },
  { icon: Code2, text: 'Write code', prompt: 'Write a Python function that sorts a list' },
  { icon: Bug, text: 'Debug an error', prompt: 'Help me debug this error: ' },
  { icon: FileText, text: 'Summarize text', prompt: 'Summarize the key points of ' },
  { icon: PenTool, text: 'Help me write', prompt: 'Help me write an email that ' },
  { icon: Search, text: 'Research something', prompt: 'Tell me about ' },
];

function MessageMeta({ latencyMs, modelLabel }: { latencyMs?: number | null; modelLabel?: string | null }) {
  if (!latencyMs && !modelLabel) {
    return null;
  }

  const seconds = latencyMs ? (latencyMs / 1000).toFixed(1) : null;

  return (
    <div className="mt-3 flex min-h-4 flex-wrap items-center gap-2">
      {latencyMs ? (
        <span className="app-code-chip inline-flex items-center rounded-full border border-border-subtle bg-bg-hover px-2.5 py-1 tabular-nums text-text-faint/85">
          {seconds}s
        </span>
      ) : null}
      {modelLabel ? (
        <span
          className="inline-flex max-w-[min(100%,360px)] items-center border border-border-subtle bg-bg-hover px-2.5 py-1 text-[10.5px] leading-none text-text-faint/80"
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

function ToolRow({
  part,
  onRespondToolApproval,
}: {
  part: Extract<ChatMessagePart, { type: 'tool' }>;
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
}) {
  const isCompletedState =
    part.state === 'output-available' || part.state === 'output-error' || part.state === 'output-denied';
  const hasInput = part.rawInput != null || part.input != null;
  const hasOutput = part.output != null || Boolean(part.errorText) || part.state === 'output-denied';
  const hasApproval = Boolean(part.approval);
  const resolvedName = part.title?.trim() || part.toolName.replace(/[_-]+/g, ' ');
  const [isOpen, setIsOpen] = useState(!isCompletedState);
  const [submittingApproval, setSubmittingApproval] = useState<null | 'approve' | 'deny'>(null);
  const approvalRequestId = part.requestId;
  const approvalId = part.approval?.id;
  const canRespondApproval =
    part.state === 'approval-requested' && Boolean(approvalRequestId) && Boolean(approvalId);
  const fallbackDeniedMessage = /search/i.test(resolvedName)
    ? 'Search was not run because permission was denied.'
    : `${resolvedName} was not run because permission was denied.`;
  const deniedMessage =
    typeof part.output === 'string' && part.output.trim() ? part.output : fallbackDeniedMessage;

  useEffect(() => {
    // Keep details open while the tool is in progress, collapse when finalized.
    setIsOpen(!isCompletedState);
  }, [isCompletedState]);

  const sendApproval = useCallback(
    async (approved: boolean) => {
      if (!canRespondApproval || !approvalRequestId || !approvalId || submittingApproval) {
        return;
      }

      setSubmittingApproval(approved ? 'approve' : 'deny');
      try {
        await onRespondToolApproval({
          requestId: approvalRequestId,
          approvalId,
          approved,
        });
      } finally {
        setSubmittingApproval(null);
      }
    },
    [approvalId, approvalRequestId, canRespondApproval, onRespondToolApproval, submittingApproval]
  );

  return (
    <Tool className="mb-2.5" onOpenChange={setIsOpen} open={isOpen}>
      <ToolHeader
        type={part.dynamic ? 'dynamic-tool' : `tool-${part.toolName}`}
        toolName={part.toolName}
        title={part.title}
        state={part.state}
      />
      {hasInput || hasOutput || hasApproval ? (
        <ToolContent>
          <Confirmation
            approval={part.approval}
            state={part.state}
            className={hasInput || hasOutput ? 'mb-3' : undefined}
          >
            <ConfirmationTitle>Tool approval</ConfirmationTitle>
            <ConfirmationRequest>
              <div>
                Approve running <span className="font-medium text-[var(--text-secondary)]">{resolvedName}</span>.
              </div>
              <div className="mt-1 text-[var(--text-faint)]">
                {part.approval?.reason?.trim()
                  ? part.approval.reason
                  : 'Permission is required because this tool can access external resources or execute commands.'}
              </div>
              {part.input ? (
                <pre className="app-code-compact mt-2 overflow-x-auto rounded-[12px] border border-[var(--border-subtle)] bg-black/20 px-3 py-2 text-[var(--text-muted)]">
                  {JSON.stringify(part.input, null, 2)}
                </pre>
              ) : null}
            </ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction
                onClick={() => void sendApproval(true)}
                disabled={!canRespondApproval || submittingApproval != null}
              >
                Approve
              </ConfirmationAction>
              <ConfirmationAction
                variant="outline"
                onClick={() => void sendApproval(false)}
                disabled={!canRespondApproval || submittingApproval != null}
              >
                Deny
              </ConfirmationAction>
            </ConfirmationActions>
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
              errorText={part.state === 'output-denied' ? deniedMessage : part.errorText}
              output={part.output}
              className={hasInput ? 'mt-3' : undefined}
            />
          ) : null}
        </ToolContent>
      ) : null}
    </Tool>
  );
}

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) {
    return null;
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function AttachmentRow({
  attachments,
  align = 'start',
}: {
  attachments: Extract<ChatMessagePart, { type: 'file' }>[];
  align?: 'start' | 'end';
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <Attachments
      variant="inline"
      className={align === 'end' ? 'mb-2 ml-auto max-w-[min(56%,560px)] justify-end' : 'mb-2 max-w-full'}
    >
      {attachments.map((attachment) => {
        const sizeLabel = formatBytes(attachment.sizeBytes ?? null);

        return (
          <Attachment data={attachment} key={attachment.id} className="max-w-full">
            <AttachmentPreview />
            <AttachmentInfo />
            {sizeLabel ? <span className="shrink-0 text-[10px] text-text-faint/70">{sizeLabel}</span> : null}
          </Attachment>
        );
      })}
    </Attachments>
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
  onRespondToolApproval,
}: {
  content: string;
  isStreaming?: boolean;
  latencyMs?: number | null;
  parts: ChatMessagePart[];
  deferRichContent?: boolean;
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
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
            <ReasoningRow key={`reasoning-${index}`} text={part.text} latencyMs={latencyMs} isStreaming={isStreaming} />
          );
        }

        if (part.type === 'tool') {
          return <ToolRow key={part.toolCallId} part={part} onRespondToolApproval={onRespondToolApproval} />;
        }

        if (part.type === 'file') {
          return <AttachmentRow key={part.id} attachments={[part]} />;
        }

        if (part.type === 'visual') {
          return <VisualBlock key={part.id} visualId={part.id} content={part.content} title={part.title} state={part.state} />;
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

function hasRenderableAssistantParts(parts: ChatMessagePart[]) {
  return parts.some((part) => {
    if (part.type === 'text') {
      return part.text.trim().length > 0;
    }

    if (part.type === 'reasoning') {
      return part.text?.trim().length > 0;
    }

    return true;
  });
}

function MessageRow({
  message,
  deferRichContent = false,
  onRegenerate,
  onRespondToolApproval,
}: {
  message: ChatMessage;
  deferRichContent?: boolean;
  onRegenerate?: () => void;
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
}) {
  const { copied, copy } = useClipboard();
  const isAssistant = message.role === 'assistant';
  const fileParts = getMessageFileParts(message.parts);
  const userText =
    message.parts
      .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
      .trim() || (message.parts.length === 0 ? message.content.trim() : '');

  if (!isAssistant) {
    return (
      <div className="group flex w-full justify-end">
        <div className="max-w-[min(56%,560px)]">
          <AttachmentRow attachments={fileParts} align="end" />
          {userText ? (
            <div className="border border-[var(--border-default)] bg-transparent px-4 py-2.5">
              <p className="whitespace-pre-wrap text-[13.5px] leading-[1.65rem] text-text-primary">{userText}</p>
            </div>
          ) : null}
          {userText ? (
            <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => void copy(userText)}
                className="p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
                title={copied ? 'Copied!' : 'Copy'}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--text-faint)]" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full">
      <div className="min-w-0 max-w-[min(100%,76ch)] flex-1">
        <AssistantParts
          content={message.content}
          latencyMs={message.status === 'complete' ? message.latencyMs : null}
          parts={message.parts}
          deferRichContent={deferRichContent}
          onRespondToolApproval={onRespondToolApproval}
        />

        <MessageMeta
          latencyMs={message.status === 'complete' ? message.latencyMs : null}
        />

        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void copy(message.content)}
            className="p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--text-faint)]" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {onRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className="p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
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
  onRespondToolApproval,
}: {
  parts: ChatMessagePart[];
  modelLabel?: string;
  errorMessage?: string;
  status: 'streaming' | 'error' | 'aborted';
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
}) {
  const isError = status === 'error';
  const isAborted = status === 'aborted';
  const hasParts = hasRenderableAssistantParts(parts);

  return (
    <div className="group flex w-full">
      <div className="min-w-0 max-w-[min(100%,76ch)] flex-1">
        {isError ? (
          <div className="border border-error-border bg-error-bg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-normal text-error-text">Something went wrong</p>
                <p className="mt-1 text-xs text-error-text/80">{errorMessage}</p>
              </div>
            </div>
          </div>
        ) : isAborted ? (
          <>
            {hasParts ? (
              <AssistantParts
                content=""
                latencyMs={null}
                parts={parts}
                onRespondToolApproval={onRespondToolApproval}
              />
            ) : null}
            <div className={cn('border border-border-subtle bg-bg-subtle p-4', hasParts ? 'mt-3' : undefined)}>
              <div className="flex items-start gap-3">
                <StopCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                <p className="text-sm text-text-muted">Generation stopped</p>
              </div>
            </div>
          </>
        ) : (
          <AssistantParts content="" isStreaming latencyMs={null} parts={parts} onRespondToolApproval={onRespondToolApproval} />
        )}

        {modelLabel ? <MessageMeta latencyMs={null} /> : null}
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
  const fileCount = getMessageFileParts(message.parts).length;
  if (message.role === 'user') {
    return Math.min(320, 84 + Math.ceil(message.content.length / 120) * 22 + fileCount * 28);
  }

  const toolCount = message.parts.filter((part) => part.type === 'tool').length;
  const reasoningCount = message.parts.filter((part) => part.type === 'reasoning').length;
  const visualCount = message.parts.filter((part) => part.type === 'visual').length;
  return Math.min(
    560,
    156 +
      Math.ceil(message.content.length / 100) * 24 +
      toolCount * 84 +
      reasoningCount * 56 +
      visualCount * 320 +
      fileCount * 28,
  );
}

function SuggestionsState({ onSuggestionClick }: { onSuggestionClick: (prompt: string) => void }) {
  return (
    <ConversationEmptyState>
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <h2 className="xai-mono text-[26px] font-light tracking-[-0.025em] text-text-primary">What can I help with?</h2>
        <p className="mt-2 max-w-md text-[14px] leading-6 text-text-tertiary">
          Start with a prompt below or type your own message.
        </p>

        <div className="mt-8 grid w-full max-w-lg grid-cols-2 gap-3">
          {suggestions.map(({ icon: Icon, text, prompt }) => (
            <button
              key={text}
              type="button"
              onClick={() => onSuggestionClick(prompt)}
              className="flex items-center gap-3 border border-border-medium bg-bg-hover px-4 py-3 text-left text-sm text-text-tertiary transition hover:bg-bg-active hover:text-text-primary"
            >
              <Icon className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="truncate">{text}</span>
            </button>
          ))}
        </div>
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
  onRespondToolApproval,
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
    estimateSize: (index) =>
      estimateHistoryRowHeight(
        messages[index] ?? {
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
          createdAt: new Date(0).toISOString(),
        },
      ),
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
        <div className="mx-auto w-full max-w-2xl border border-warning-border bg-warning-bg p-6 text-center">
          <h2 className="text-lg font-normal text-text-primary">Add your API key to start</h2>
          <p className="mt-2 text-sm text-text-tertiary">
            Credentials are stored in your OS keychain. Nothing leaves your machine.
          </p>
          <button type="button" onClick={onOpenSettings} className="btn-primary mt-4 px-4 py-2 text-sm">
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="scrollbar-auto-hide relative min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
      >
        <div
          ref={contentRef}
          className={cn(
            'mx-auto flex w-full max-w-content-max flex-col px-6 py-7 lg:px-7 lg:py-8 xl:px-8 xl:py-9',
            showSuggestions && 'min-h-full justify-center',
          )}
        >
          {hasOlder ? (
            <div className="mb-6 flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlderMessages()}
                disabled={isLoadingOlder}
                className="inline-flex h-9 items-center gap-2 border border-border-default bg-bg-subtle px-4 text-[12.5px] font-normal text-text-secondary transition hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-70"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingOlder ? 'animate-spin' : ''}`} />
                <span>{isLoadingOlder ? 'Loading older messages…' : 'Load older messages'}</span>
              </button>
            </div>
          ) : null}

          {showSuggestions ? (
            <div className="flex flex-1 items-center justify-center">
              <SuggestionsState onSuggestionClick={onSuggestionClick} />
            </div>
          ) : shouldRenderVirtualizedHistory ? (
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
                    <MessageRow
                      message={message}
                      deferRichContent={isOutsideVisibleRange}
                      onRespondToolApproval={onRespondToolApproval}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-[26px]">
              {messages.map((message) => (
                <MessageRow key={message.id} message={message} onRespondToolApproval={onRespondToolApproval} />
              ))}
            </div>
          )}

          {draft ? (
            <div className={messages.length > 0 || showSuggestions ? 'mt-6' : undefined}>
              <StreamingRow
                parts={draft.parts}
                modelLabel={draft.modelId}
                errorMessage={draft.errorMessage}
                status={draft.status}
                onRespondToolApproval={onRespondToolApproval}
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
