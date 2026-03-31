import {
  AlertCircle,
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

import type { ConversationDetail } from '../../shared/contracts';
import type { DraftStateLike } from './types';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './ai-elements/conversation';
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
import type { ChatMessagePart } from '../../shared/contracts';

type ChatWindowProps = {
  detail: ConversationDetail | null;
  draft: DraftStateLike | null;
  hasCredential: boolean;
  onOpenSettings: () => void;
  onSuggestionClick: (prompt: string) => void;
};

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
  status,
}: {
  latencyMs?: number | null;
  modelLabel?: string | null;
  status?: 'streaming' | 'error' | 'aborted';
}) {
  if (!latencyMs && !modelLabel && status !== 'streaming') {
    return null;
  }

  return (
    <div className="mt-1 flex min-h-4 flex-wrap items-center gap-1 text-[10.5px] leading-none text-text-faint/65">
      {latencyMs ? <span className="tabular-nums">{latencyMs}ms</span> : null}
      {latencyMs && modelLabel ? <span className="text-text-faint/35">·</span> : null}
      {modelLabel ? (
        <span className="max-w-[320px] truncate text-text-faint/75" title={modelLabel}>
          {modelLabel}
        </span>
      ) : null}
      {status === 'streaming' ? (
        <>
          {(latencyMs || modelLabel) && <span className="text-text-faint/35">·</span>}
          <span className="inline-flex items-center gap-1 text-success-text/80">
            <span className="h-1 w-1 animate-pulse rounded-full bg-success" />
            <span>streaming</span>
          </span>
        </>
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
      {(hasInput || hasOutput || hasApproval) ? (
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
          {hasInput ? (
            <ToolInput input={part.input ?? part.rawInput ?? ''} />
          ) : null}
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

function AssistantParts({
  isStreaming = false,
  latencyMs,
  parts,
}: {
  isStreaming?: boolean;
  latencyMs?: number | null;
  parts: ChatMessagePart[];
}) {
  if (parts.length === 0) {
    return isStreaming ? (
      <div className="text-[13.5px] font-medium text-text-muted">Thinking...</div>
    ) : null;
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
  role,
  content,
  parts,
  latencyMs,
  modelLabel,
  isLast,
  onRegenerate,
}: {
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts: ChatMessagePart[];
  latencyMs?: number | null;
  modelLabel?: string | null;
  isLast: boolean;
  onRegenerate?: () => void;
}) {
  const { copied, copy } = useClipboard();
  const isAssistant = role === 'assistant';

  if (!isAssistant) {
    return (
      <div className="group flex w-full justify-end">
        <div className="max-w-[min(62%,680px)]">
          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.085),rgba(255,255,255,0.045))] px-5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="whitespace-pre-wrap text-[14px] leading-7 text-text-primary">
              {content}
            </p>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => void copy(content)}
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
        <AssistantParts latencyMs={latencyMs} parts={parts} />

        <MessageMeta latencyMs={latencyMs} modelLabel={modelLabel} />

        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void copy(content)}
            className="rounded-full p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-full p-1.5 text-text-faint transition hover:bg-bg-hover hover:text-text-primary"
              title="Regenerate"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
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
          <>
            <AssistantParts isStreaming={status === 'streaming'} parts={parts} />
            <MessageMeta modelLabel={modelLabel} status={status} />
          </>
        )}
      </div>
    </div>
  );
}

export function ChatWindow({ detail, draft, hasCredential, onOpenSettings, onSuggestionClick }: ChatWindowProps) {
  if (!detail) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <Conversation className="mx-auto w-full max-w-content-max">
          <ConversationContent className="items-center justify-center px-8 py-10 lg:px-12">
            <ConversationEmptyState
              icon={<MessageSquare className="h-12 w-12 text-text-muted" />}
              title="What can I help with?"
              description="Start a new conversation or select one from the sidebar."
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
          </ConversationContent>
        </Conversation>
      </div>
    );
  }

  const showSetupPrompt = !hasCredential && detail.messages.length === 0;

  if (showSetupPrompt) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <Conversation className="mx-auto w-full max-w-content-max">
          <ConversationContent className="items-center justify-center px-8 py-10 lg:px-12">
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
          </ConversationContent>
        </Conversation>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <Conversation className="mx-auto w-full max-w-content-max">
        <ConversationContent className="gap-8 px-8 py-8 lg:px-10 xl:px-12 xl:py-10">
          {detail.messages.map((message, i) => {
            const isLast = i === detail.messages.length - 1 && !draft;
            return (
              <MessageRow
                key={message.id}
                role={message.role}
                content={message.content}
                parts={message.parts}
                latencyMs={message.status === 'complete' ? message.latencyMs : null}
                modelLabel={message.role === 'assistant' ? message.modelId : undefined}
                isLast={isLast}
              />
            );
          })}

          {draft && (
            <StreamingRow
              parts={draft.parts}
              modelLabel={draft.modelId}
              errorMessage={draft.errorMessage}
              status={draft.status}
            />
          )}
        </ConversationContent>
        <ConversationScrollButton className="border-border-medium bg-bg-elevated shadow-elevated hover:bg-bg-active" />
      </Conversation>
    </div>
  );
}
