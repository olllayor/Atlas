import {
  defaultRangeExtractor,
  measureElement as measureElementDefault,
  type Range,
  type Virtualizer,
  useVirtualizer,
} from '@tanstack/react-virtual';
import { AlertCircle, ArrowDown, Check, Copy, Info, RefreshCw, StopCircle } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';

import type {
  ApprovalDecision,
  ChatMessage,
  ChatMessagePart,
  ChatToolPart,
  ConversationPage,
} from '../../shared/contracts';
import { getMessageFileParts } from '../../shared/attachments';
import { cn } from '../lib/utils';
import type { DraftStateLike } from './types';
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
  getAttachmentLabel,
  getMediaCategory,
} from './ai-elements/attachments';
import { ConversationEmptyState } from './ai-elements/conversation';
import { ImageLightbox } from './ai-elements/image-lightbox';
import { MessageResponse } from './ai-elements/message';
import { VisualBlock } from './ai-elements/visual';
import { ReasoningCell } from './transcript/ReasoningCell';
import { buildToolCells, collectChangedFiles } from '../../shared/toolCellGrammar';
import { isPlanToolPart } from '../../shared/planTool';
import { groupAssistantParts, hasPendingApproval, splitAssistantTurn } from './transcript/assistantSegments';
import type { AssistantSegment } from './transcript/assistantSegments';
import { ActivityBlock } from './transcript/ActivityBlock';
import { ChangedFilesBar } from './transcript/ChangedFilesBar';
import { PlanCell } from './transcript/PlanCell';
import { ToolCellList } from './transcript/ToolCell';
import { useClipboard } from '../hooks/useClipboard';
import { useTranscriptScroll } from '../hooks/useTranscriptScroll';
import { countCompletedAssistantTurns, deriveJumpState } from './jumpToLatest';
import { AtlasMark } from './ui/atlas-mark';

type ChatWindowProps = {
  detail: ConversationPage | null;
  draft: DraftStateLike | null;
  hasCredential: boolean;
  isLoadingConversation: boolean;
  isLoadingOlder: boolean;
  onOpenSettings: () => void;
  onSuggestionClick: (prompt: string) => void;
  onLoadOlderMessages: (conversationId: string) => Promise<void>;
  onRespondToolApproval: (request: { requestId: string; approvalId: string; decision: ApprovalDecision; reason?: string }) => Promise<void>;
  /** Opens the workbench Changes tab from a turn's changed-files bar. */
  onReviewChanges?: () => void;
  onRetryLastMessage?: () => void;
  hasTools?: boolean;
  /** Attached project, so the opening question names what you are working in. */
  projectName?: string | null;
};

const HISTORY_LEADING_OVERSCAN = 4;
const HISTORY_TRAILING_OVERSCAN = 2;
/**
 * Turn-to-turn whitespace. The reference app separates a user bubble from
 * the next activity row by ~44px of clear space — turns breathe, and there
 * are no dividers anywhere to do that job instead.
 */
const HISTORY_GAP_PX = 40;

/**
 * Column geometry.
 *
 * The transcript and the composer are one column: the composer wraps
 * `max-w-content-max` in a `px-5 lg:px-6` full-bleed row (`Composer.tsx`),
 * so the transcript does exactly the same — padding *outside* the max
 * width, not inside it. Putting the padding inside (as this file used to,
 * `px-6 lg:px-7 xl:px-8`) narrowed the message column ~32px per side
 * relative to the composer slab, and the mismatch grew at every
 * breakpoint.
 */
const COLUMN_PADDING = 'px-5 lg:px-6';

/**
 * The single text measure.
 *
 * Assistant content and user bubbles share one right rail: both live in a
 * `76ch` box pinned to the left of the column, and the user's bubble is
 * right-aligned *inside* that box. Previously assistant text was capped at
 * 76ch while user bubbles were 75% of the full column and flush to its
 * right edge, so the two sides of the conversation had different margins.
 */
const MEASURE = 'w-full max-w-[min(100%,76ch)]';

/** Jump-to-latest hysteresis: show past this, hide inside the other. */
const JUMP_SHOW_PX = 120;
const JUMP_HIDE_PX = 40;

/**
 * How far outside the viewport a row may sit before it degrades to plain
 * text, as a multiple of the viewport height.
 *
 * The old rule degraded every row outside the *visible index range*, which
 * meant the four overscan rows above the fold rendered as stripped-down
 * text, got measured at that height, and then jumped to their real height
 * the moment they scrolled in. Keeping rich content mounted across a
 * generous window makes the swap a rare, far-offscreen event, and rows
 * that do swap are excluded from measurement entirely (below) so their
 * heights never enter the cache.
 */
const RICH_CONTENT_WINDOW = 1.5;

/**
 * Empty-state prompts.
 *
 * The tool-capable set is offered only when the selected model actually
 * supports tool calling — suggesting "search this codebase" to a model
 * that cannot call a tool sets the user up to fail. The generic set is
 * the fallback.
 */
const toolSuggestions = [
  { text: 'Search a codebase', prompt: 'Search my project for every place that ' },
  { text: 'Read and explain a file', prompt: 'Read and walk me through the file at ' },
  { text: 'Run a command', prompt: 'Run the test suite and summarise what fails' },
  { text: 'Track down a bug', prompt: 'Find the cause of this error and propose a fix: ' },
  { text: 'Research on the web', prompt: 'Search the web and summarise the current state of ' },
  { text: 'Make an edit', prompt: 'Edit the following file so that ' },
];

const genericSuggestions = [
  { text: 'Explain a concept', prompt: 'Explain quantum computing in simple terms' },
  { text: 'Write code', prompt: 'Write a Python function that sorts a list' },
  { text: 'Debug an error', prompt: 'Help me debug this error: ' },
  { text: 'Summarize text', prompt: 'Summarize the key points of ' },
  { text: 'Help me write', prompt: 'Help me write an email that ' },
  { text: 'Research something', prompt: 'Tell me about ' },
];

/**
 * Neutral progress ring.
 *
 * `RefreshCw` — a *retry* glyph — used to spin here, which reads as "this
 * failed and is being retried" rather than "this is loading".
 */
function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border border-border-strong border-t-transparent motion-reduce:animate-none',
        className
      )}
    />
  );
}

/** Hover/focus action rows share one recipe so keyboard users see them too. */
const ACTION_ROW =
  'mt-1.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100';
const ACTION_BUTTON =
  'inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-text-faint transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:opacity-100';

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
        // An image in the transcript is shown, not named. The chip stays for
        // everything else, where the filename *is* the only identity.
        if (getMediaCategory(attachment) === 'image' && attachment.url) {
          return (
            <TranscriptImageAttachment
              key={attachment.id}
              url={attachment.url}
              label={getAttachmentLabel(attachment)}
            />
          );
        }

        const sizeLabel = formatBytes(attachment.sizeBytes ?? null);

        return (
          <Attachment data={attachment} key={attachment.id} className="max-w-full">
            <AttachmentPreview />
            <AttachmentInfo />
            {sizeLabel ? <span className="shrink-0 text-3xs text-text-faint/70">{sizeLabel}</span> : null}
          </Attachment>
        );
      })}
    </Attachments>
  );
}

/**
 * A sent image, at thumbnail size with the full picture one click away.
 *
 * Same 80px tile and same viewer as the composer's staged files, so an image
 * looks and behaves identically before and after you send it.
 */
function TranscriptImageAttachment({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span className="text-2xs text-text-faint">{label}</span>;
  }

  return (
    <>
      <button
        type="button"
        aria-label={`${label} — open`}
        onClick={() => setOpen(true)}
        className="size-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-border-subtle bg-bg-base transition-opacity hover:opacity-90"
      >
        <img
          alt={label}
          src={url}
          onError={() => setFailed(true)}
          className="size-full object-cover"
          height={80}
          width={80}
        />
      </button>
      <ImageLightbox open={open} onOpenChange={setOpen} src={url} filename={label} />
    </>
  );
}

/**
 * Copy button with a real confirmation.
 *
 * The check used to render in `--text-faint`, i.e. *dimmer* than the copy
 * glyph it replaced, so a successful copy looked like the button had gone
 * disabled. Success is now success-coloured and says so in words for the
 * ~1.5s the state lasts.
 */
function CopyAction({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useClipboard(1500);

  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      className={cn(ACTION_BUTTON, copied && 'text-success hover:text-success')}
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className={cn('text-2xs', copied ? 'inline' : 'sr-only')}>{copied ? 'Copied' : label}</span>
    </button>
  );
}

function AssistantTextFallback({ content }: { content: string }) {
  if (!content.trim()) {
    return <div className="text-sm font-medium text-text-muted">Assistant response</div>;
  }

  return (
    <div className="whitespace-pre-wrap break-words text-md leading-relaxed text-text-primary">
      {content}
    </div>
  );
}

function AssistantParts({
  content,
  isStreaming = false,
  parts,
  deferRichContent = false,
  turnId,
  durationMs,
  onRespondToolApproval,
}: {
  content: string;
  isStreaming?: boolean;
  parts: ChatMessagePart[];
  deferRichContent?: boolean;
  /** Keys the turn's `Worked for …` disclosure: the message id, or the draft's request id. */
  turnId: string;
  /** The turn's persisted latency, for history that never streamed here. */
  durationMs?: number | null;
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
}) {
  // Memoised because it used to be recomputed for every visible row on
  // every streamed token.
  const segments = useMemo(() => groupAssistantParts(parts), [parts]);
  // The work/answer cut, so the reply is not buried under the tool calls that
  // produced it. See `splitAssistantTurn`.
  const split = useMemo(() => splitAssistantTurn(segments), [segments]);

  if (deferRichContent) {
    return <AssistantTextFallback content={content} />;
  }

  if (parts.length === 0) {
    return isStreaming ? (
      // Reserve one line so the first token does not shove the transcript.
      <div className="flex min-h-[1.5rem] items-center text-sm font-normal text-text-tertiary">
        <span className="motion-shimmer">Thinking</span>
      </div>
    ) : (
      <AssistantTextFallback content={content} />
    );
  }

  const renderSegment = (segment: AssistantSegment, options: { isLast: boolean; dim: boolean }) => {
    if (segment.kind === 'tools') {
      // Consecutive tool calls are handed to the transcript as one run
      // so read-only calls can coalesce into a single `Explored` cell.
      return (
        <ToolCellGroup
          key={`tools-${segment.parts[0].toolCallId}`}
          parts={segment.parts}
          onRespondToolApproval={onRespondToolApproval}
        />
      );
    }

    if (segment.kind === 'plan') {
      return (
        <PlanCell
          key={`plan-${segment.parts[0].id}`}
          parts={segment.parts}
          isStreaming={isStreaming}
        />
      );
    }

    const part = segment.part;

    if (part.type === 'reasoning') {
      // `partId` keys the reasoning cell's timing and expand state in
      // the transcript UI store; without it the store falls back to
      // hashing the text, which only settles after ~96 characters.
      return <ReasoningCell key={part.id} partId={part.id} text={part.text} isStreaming={isStreaming} />;
    }

    if (part.type === 'file') {
      return <AttachmentRow key={part.id} attachments={[part]} />;
    }

    if (part.type === 'visual') {
      return <VisualBlock key={part.id} visualId={part.id} content={part.content} title={part.title} state={part.state} />;
    }

    return (
      <MessageResponse
        key={part.id}
        // Commentary inside the fold keeps the reply's measure and size — it
        // is the same voice — but sits a shade back so the answer below the
        // fold is the thing the eye lands on.
        className={cn(
          'text-md leading-relaxed',
          options.dim ? 'text-text-secondary' : 'text-text-primary'
        )}
        isAnimating={isStreaming && options.isLast}
      >
        {part.text}
      </MessageResponse>
    );
  };

  return (
    <>
      {split.activity.length > 0 ? (
        <ActivityBlock
          id={`activity:${turnId}`}
          isStreaming={isStreaming}
          fallbackDurationMs={durationMs}
          // Open while there is no reply under it — the live run of steps, or
          // a turn that ended without one. It folds as the answer arrives.
          defaultOpen={split.answer.length === 0}
          forceOpen={hasPendingApproval(split.activity)}
        >
          {split.activity.map((segment, index) =>
            renderSegment(segment, {
              isLast: isStreaming && split.answer.length === 0 && index === split.activity.length - 1,
              dim: true,
            })
          )}
        </ActivityBlock>
      ) : null}

      {split.plan.map((segment) => renderSegment(segment, { isLast: false, dim: false }))}

      {split.answer.map((segment, index) =>
        renderSegment(segment, { isLast: index === split.answer.length - 1, dim: false })
      )}
    </>
  );
}

/**
 * Bridges the transcript's approval affordances to the IPC call, and owns
 * the in-flight flag so a double-click cannot submit two decisions.
 */
function ToolCellGroup({
  parts,
  onRespondToolApproval,
}: {
  parts: ChatToolPart[];
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
}) {
  const [submittingApprovalId, setSubmittingApprovalId] = useState<string | null>(null);

  const respond = useCallback(
    async (part: ChatToolPart, decision: ApprovalDecision) => {
      const approvalId = part.approval?.id;
      const requestId = part.requestId;
      if (!approvalId || !requestId || submittingApprovalId) return;

      setSubmittingApprovalId(approvalId);
      try {
        await onRespondToolApproval({ requestId, approvalId, decision });
      } finally {
        setSubmittingApprovalId(null);
      }
    },
    [onRespondToolApproval, submittingApprovalId]
  );

  const approvals = useMemo(
    () => ({
      submittingApprovalId,
      onApprove: (part: ChatToolPart, scope: 'once' | 'session') =>
        void respond(part, scope === 'session' ? 'accept_for_session' : 'accept'),
      onDeny: (part: ChatToolPart) => void respond(part, 'decline'),
      onCancel: (part: ChatToolPart) => void respond(part, 'cancel'),
    }),
    [respond, submittingApprovalId]
  );

  return (
    <div className="my-1.5">
      <ToolCellList parts={parts} approvals={approvals} />
    </div>
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
  onReviewChanges,
}: {
  message: ChatMessage;
  deferRichContent?: boolean;
  onRegenerate?: () => void;
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
  onReviewChanges?: ChatWindowProps['onReviewChanges'];
}) {
  const isAssistant = message.role === 'assistant';
  const fileParts = getMessageFileParts(message.parts);
  // The end-of-turn "Changed N files" bar — only for finished assistant
  // turns that actually produced file edits.
  const changedFiles = useMemo(() => {
    if (message.role !== 'assistant' || message.status !== 'complete') return null;
    const toolParts = message.parts.filter((part): part is ChatToolPart => part.type === 'tool');
    return toolParts.length ? collectChangedFiles(toolParts) : null;
  }, [message.role, message.status, message.parts]);
  const userText =
    message.parts
      .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
      .trim() || (message.parts.length === 0 ? message.content.trim() : '');

  if (!isAssistant) {
    return (
      <div className="group flex w-full">
        {/* Same box as the assistant column, contents right-aligned inside
            it — one right rail for both sides of the conversation. */}
        <div className={cn(MEASURE, 'flex min-w-0 flex-col items-end')}>
          <AttachmentRow attachments={fileParts} align="end" />
          {userText ? (
            // Right-aligned bubble on a subtle elevated tint — no border,
            // no avatar, no name, no timestamp (reference-visual-spec §5).
            // Radius ~22px: a single-line message reads as a pill.
            <div className="max-w-full rounded-2xl bg-bg-surface px-5 py-3">
              <p className="whitespace-pre-wrap break-words text-md leading-relaxed text-text-primary">{userText}</p>
            </div>
          ) : null}
          {userText ? (
            <div className={cn(ACTION_ROW, 'justify-end')}>
              <CopyAction text={userText} label="Copy message" />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full">
      <div className={cn(MEASURE, 'min-w-0')}>
        <AssistantParts
          content={message.content}
          parts={message.parts}
          deferRichContent={deferRichContent}
          turnId={message.id}
          durationMs={message.latencyMs}
          isStreaming={message.status === 'streaming'}
          onRespondToolApproval={onRespondToolApproval}
        />

        {changedFiles ? <ChangedFilesBar summary={changedFiles} onReview={onReviewChanges} /> : null}

        <div className={ACTION_ROW}>
          <CopyAction text={message.content} label="Copy response" />
          {onRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className={ACTION_BUTTON}
              aria-label="Regenerate response"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="sr-only">Regenerate response</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StreamingRow({
  parts,
  turnId,
  errorMessage,
  notice,
  status,
  onRespondToolApproval,
  onRetry,
}: {
  parts: ChatMessagePart[];
  /** The draft's request id — keys the turn's `Worked for …` disclosure. */
  turnId: string;
  errorMessage?: string;
  /** Why this turn is taking longer than it looks like it should. */
  notice?: DraftStateLike['notice'];
  status: 'streaming' | 'error' | 'aborted';
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
  onRetry?: () => void;
}) {
  const isError = status === 'error';
  const isAborted = status === 'aborted';
  const hasParts = hasRenderableAssistantParts(parts);

  return (
    <div className="group flex w-full">
      <div className={cn(MEASURE, 'min-w-0')}>
        {isError ? (
          <div className="rounded-lg border border-error-border bg-error-bg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-normal text-error-text">Something went wrong</p>
                <p className="mt-1 text-xs text-error-text/80">{errorMessage}</p>
              </div>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-error-border bg-transparent px-2.5 text-2xs font-normal text-error-text transition hover:border-error-text hover:bg-error-bg hover:text-text-primary"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : isAborted ? (
          <>
            {hasParts ? (
              <AssistantParts content="" parts={parts} turnId={turnId} onRespondToolApproval={onRespondToolApproval} />
            ) : null}
            <div
              className={cn(
                'rounded-lg border border-border-subtle bg-bg-subtle p-4',
                hasParts ? 'mt-3' : undefined
              )}
            >
              <div className="flex items-start gap-3">
                <StopCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                <p className="text-sm text-text-muted">Generation stopped</p>
              </div>
            </div>
          </>
        ) : (
          <>
            <AssistantParts content="" isStreaming parts={parts} turnId={turnId} onRespondToolApproval={onRespondToolApproval} />
            {/*
              A dim line under the shimmer, not a banner: the turn has not
              failed, and a warning-shaped box would say it had. Before this
              existed a turn that timed out and retried was indistinguishable
              from a turn that was simply slow.
            */}
            {notice ? (
              <div
                aria-live="polite"
                role="status"
                className={cn(
                  'mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed',
                  notice.level === 'warning' ? 'text-warning-text' : 'text-text-tertiary'
                )}
              >
                <Info aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{notice.message}</span>
              </div>
            ) : null}
          </>
        )}
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

/**
 * Rough row height, used only to seed the virtualizer before a row has
 * been measured.
 *
 * Recalibrated for the Codex cell grammar. The previous constants were
 * tuned against bordered tool cards (~52px each, always their own row);
 * cells are now a single ~22px line by default, and consecutive
 * read-only calls coalesce, so N reads occupy roughly one line rather
 * than N cards.
 *
 * There are deliberately **no upper clamps** here any more. The old
 * `Math.min(560, …)` / `Math.min(320, …)` caps meant a 4,000px answer and
 * a 600px one were both estimated at 560px, so the scrollbar thumb was a
 * lie and every scroll into unmeasured territory produced a correction.
 * Systematic error left over from the heuristic is removed at runtime by
 * `estimateScaleRef` (see `ChatWindow`), which calibrates these numbers
 * against what the same messages actually measured.
 */
const ROW_HEIGHT = {
  /** Row padding + hover-action line. */
  assistantBase: 44,
  userBase: 60,
  /** One wrapped line of body text. */
  textLine: 24,
  /** One collapsed activity row. */
  toolCell: 24,
  /** Reasoning collapses to a single activity row. */
  reasoning: 28,
  /** The end-of-turn "Changed N files" bar (48px + margin). */
  changedFilesBar: 64,
  visual: 320,
  file: 28,
} as const;

function estimateHistoryRowHeight(message: ChatMessage) {
  const fileCount = getMessageFileParts(message.parts).length;

  if (message.role === 'user') {
    return Math.max(
      44,
      ROW_HEIGHT.userBase + Math.ceil(message.content.length / 120) * 22 + fileCount * ROW_HEIGHT.file
    );
  }

  const toolParts = message.parts.filter((part): part is ChatToolPart => part.type === 'tool');
  const reasoningCount = message.parts.filter((part) => part.type === 'reasoning').length;
  const visualCount = message.parts.filter((part) => part.type === 'visual').length;

  // Ask the grammar how many cells these parts actually produce rather
  // than assuming one row per call — coalescing means the two numbers
  // diverge sharply on read-heavy turns. Details stay collapsed by
  // default, so only the summary rows count.
  const cells = toolParts.length ? buildToolCells(toolParts) : [];
  const hasChangedFilesBar =
    message.status === 'complete' && cells.some((cell) => cell.detail.type === 'diff');
  // `buildToolCells` drops plan parts, and however many of them a turn made
  // they collapse into one row — so they are counted once, not N times.
  const hasPlan = toolParts.some(isPlanToolPart);
  /*
   * A finished turn folds its whole work phase — every tool cell, every
   * reasoning row, and the commentary between them — behind one `Worked
   * for …` line, so the estimate counts one row for the lot. While the turn
   * is still streaming the fold is open and the rows are all on screen.
   */
  const activityIsFolded = message.status !== 'streaming' && cells.length > 0;
  const activityHeight = activityIsFolded
    ? ROW_HEIGHT.reasoning
    : cells.length * ROW_HEIGHT.toolCell + reasoningCount * ROW_HEIGHT.reasoning;

  return Math.max(
    44,
    ROW_HEIGHT.assistantBase +
      Math.ceil(message.content.length / 100) * ROW_HEIGHT.textLine +
      activityHeight +
      (hasPlan ? ROW_HEIGHT.toolCell : 0) +
      (hasChangedFilesBar ? ROW_HEIGHT.changedFilesBar : 0) +
      visualCount * ROW_HEIGHT.visual +
      fileCount * ROW_HEIGHT.file
  );
}

/*
 * Keeping the reader still — when a row above the viewport re-measures,
 * `scrollTop` shifts by the same delta so content under the reader does not
 * move — is virtual-core's own default
 * (`item.start < getScrollOffset() + scrollAdjustments`). We used to restate
 * it as an override, but dropped the `scrollAdjustments` term, which loses
 * every correction already queued in the same measurement pass. Both members
 * are private on `Virtualizer`, so the correct expression is not writable
 * from here; leaving the default in place is both correct and shorter.
 */

function SuggestionsState({
  onSuggestionClick,
  hasTools,
  projectName,
}: {
  onSuggestionClick: (prompt: string) => void;
  hasTools: boolean;
  projectName?: string | null;
}) {
  const suggestions = hasTools ? toolSuggestions : genericSuggestions;

  return (
    <ConversationEmptyState className="p-0">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        {/* Ghost logo: the Atlas keycap, outlined, in the faint text colour.
            This was a generic `Sparkles` standing in for a mark we already
            had. */}
        <AtlasMark variant="outline" className="mb-5 h-10 w-10 text-text-faint" />
        <h2 className="text-3xl font-normal leading-[1.15] text-text-primary">
          {projectName ? (
            <>
              {/* The project is underlined rather than bolded: it names the
                  working directory, and the dotted rule reads as a label
                  instead of as emphasis on one word of a question. */}
              What should we build in{' '}
              <span className="underline decoration-border-strong decoration-dotted underline-offset-4">
                {projectName}
              </span>
              ?
            </>
          ) : (
            'What can I help with?'
          )}
        </h2>

        <div className="mt-6 flex max-w-lg flex-wrap items-center justify-center gap-2">
          {suggestions.map(({ text, prompt }) => (
            <button
              key={text}
              type="button"
              onClick={() => onSuggestionClick(prompt)}
              className="rounded-full border border-border-default px-3.5 py-1.5 text-sm font-normal text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            >
              {text}
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
  onRetryLastMessage,
  onReviewChanges,
  hasTools = false,
  projectName = null,
}: ChatWindowProps) {
  const {
    scrollRef,
    contentRef,
    scrollToBottom,
    stopScroll,
    isAtBottom,
    state: stickState,
  } = useStickToBottom({
    initial: 'instant',
    /*
      Always instant. With a spring here, expanding a reasoning or tool
      cell near the bottom animated the transcript away from the row the
      user had just clicked.
    */
    resize: 'instant',
  });

  // The library's `scrollRef` is a ref *callback*; mirroring it into state
  // is what lets effects below re-bind when the container mounts.
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const attachScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef(node);
      setScrollNode(node);
    },
    [scrollRef]
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingPrependRef = useRef<{ conversationId: string; previousMessageCount: number } | null>(null);
  const lastAutoLoadCursorRef = useRef<string | null>(null);
  /** Running calibration of `estimateHistoryRowHeight` against reality. */
  const estimateScaleRef = useRef({ measured: 0, estimated: 0, count: 0 });

  const conversationId = detail?.conversation?.id ?? null;
  const messages = useMemo(() => detail?.messages ?? [], [detail]);
  const hasOlder = detail?.hasOlder ?? false;
  const nextCursor = detail?.nextCursor ?? null;
  const isStreaming = draft?.status === 'streaming';
  const showSetupPrompt = Boolean(detail && !hasCredential && messages.length === 0);
  const showSuggestions = Boolean(detail && hasCredential && messages.length === 0 && !draft);

  const { userHasScrolledRef, isScrolledUp } = useTranscriptScroll({
    element: scrollNode,
    onUserScrollUp: stopScroll,
    showAt: JUMP_SHOW_PX,
    hideAt: JUMP_HIDE_PX,
  });

  // ---------------------------------------------------------------------
  // Virtualizer
  // ---------------------------------------------------------------------

  const rangeExtractor = useMemo(() => buildHistoryRangeExtractor(isStreaming), [isStreaming]);

  /**
   * The virtual list does not start at the scroller's origin — the column
   * has vertical padding and, when there is older history, a status slot
   * above it. `scrollMargin` tells the virtualizer about that offset so
   * `scrollToIndex` lands where it says it will.
   */
  const [scrollMargin, setScrollMargin] = useState(0);

  const estimateSize = useCallback(
    (index: number) => {
      const message = messages[index];
      const base = message ? estimateHistoryRowHeight(message) : 120;
      const { measured, estimated, count } = estimateScaleRef.current;
      if (count < 4 || estimated <= 0) {
        return base;
      }
      const scale = Math.min(4, Math.max(0.4, measured / estimated));
      return Math.round(base * scale);
    },
    [messages]
  );

  const measureRow = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLElement, HTMLDivElement>
    ) => {
      const size = measureElementDefault(element, entry, instance);
      const index = Number(element.getAttribute('data-index'));
      const message = Number.isFinite(index) ? messages[index] : undefined;

      if (message && size > 0) {
        const stats = estimateScaleRef.current;
        stats.measured += size;
        stats.estimated += estimateHistoryRowHeight(message);
        stats.count += 1;
        // Halve the accumulator periodically so the calibration tracks the
        // conversation's recent shape instead of everything ever measured.
        if (stats.count > 160) {
          stats.measured /= 2;
          stats.estimated /= 2;
          stats.count = Math.round(stats.count / 2);
        }
      }

      return size;
    },
    [messages]
  );

  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: messages.length,
    estimateSize,
    measureElement: measureRow,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => messages[index]?.id ?? index,
    gap: HISTORY_GAP_PX,
    overscan: 0,
    scrollMargin,
    rangeExtractor,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleRange = rowVirtualizer.range;
  const totalSize = rowVirtualizer.getTotalSize();

  // ---------------------------------------------------------------------
  // Scroll lifecycle
  // ---------------------------------------------------------------------

  /**
   * Conversation switch.
   *
   * `ChatWindow` cannot be keyed by conversation id from here (`App.tsx`
   * owns that element), so the equivalent reset happens by hand: drop every
   * per-conversation ref, clear the escape lock inside the stick-to-bottom
   * state object, and land at the bottom instantly. Without this you used
   * to arrive in a new thread parked wherever you left the previous one.
   */
  useLayoutEffect(() => {
    estimateScaleRef.current = { measured: 0, estimated: 0, count: 0 };
    pendingPrependRef.current = null;
    lastAutoLoadCursorRef.current = null;
    userHasScrolledRef.current = false;

    const element = scrollRef.current;
    if (!element) {
      return;
    }

    stickState.escapedFromLock = false;
    element.scrollTop = element.scrollHeight;
    void scrollToBottom({ animation: 'instant', wait: false });
  }, [conversationId, scrollRef, scrollToBottom, stickState, userHasScrolledRef]);

  /** Measure where the virtual list sits inside the scroller. */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const offset = Math.round(list.offsetTop);
    setScrollMargin((current) => (current === offset ? current : offset));
  }, [conversationId, hasOlder, showSuggestions, showSetupPrompt, isLoadingConversation, messages.length]);

  /**
   * Restore the reading position after older messages are prepended.
   *
   * The old implementation diffed `scrollHeight` before and after, which is
   * measured against *estimated* heights for the newly inserted rows and
   * therefore drifted. Re-anchoring on the message that used to be first is
   * exact: it was already measured, and any correction as the prepended
   * rows measure is absorbed by
   * `shouldAdjustScrollPositionOnItemSizeChange`.
   */
  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    if (!pending || !conversationId) {
      return;
    }
    if (pending.conversationId !== conversationId) {
      pendingPrependRef.current = null;
      return;
    }

    const prependedCount = messages.length - pending.previousMessageCount;
    if (prependedCount <= 0) {
      return;
    }

    pendingPrependRef.current = null;
    rowVirtualizer.scrollToIndex(prependedCount, { align: 'start' });
  }, [conversationId, messages.length, rowVirtualizer]);

  const loadOlderMessages = useCallback(async () => {
    if (!detail?.conversation || !hasOlder || isLoadingOlder) {
      return;
    }

    pendingPrependRef.current = {
      conversationId: detail.conversation.id,
      previousMessageCount: messages.length,
    };

    await onLoadOlderMessages(detail.conversation.id);
  }, [detail, hasOlder, isLoadingOlder, messages.length, onLoadOlderMessages]);

  /**
   * Auto-load older history when the top of the list comes into view —
   * gated on the user having actually scrolled. `startIndex === 0` is true
   * on the first paint of every thread, which used to fire a page load
   * nobody asked for on every conversation open.
   */
  useEffect(() => {
    if (!hasOlder || isLoadingOlder || !nextCursor || visibleRange?.startIndex !== 0) {
      return;
    }
    if (!userHasScrolledRef.current) {
      return;
    }
    if (lastAutoLoadCursorRef.current === nextCursor) {
      return;
    }

    lastAutoLoadCursorRef.current = nextCursor;
    void loadOlderMessages();
  }, [
    hasOlder,
    isLoadingOlder,
    nextCursor,
    loadOlderMessages,
    userHasScrolledRef,
    visibleRange?.startIndex,
  ]);

  /**
   * Post-send.
   *
   * Previously `{ animation: 'smooth', ignoreEscapes: true }`: the spring
   * took ~1s from far up the thread and, while it ran, the library actively
   * reverted any `scrollTop` the user produced. Sending a message therefore
   * confiscated the scroll wheel. Now it is instant, and it only happens if
   * the user was at the live edge to begin with — send while reading
   * history and the transcript stays exactly where it is (the pill picks up
   * the unread count instead).
   */
  const scrolledUpRef = useRef(false);
  scrolledUpRef.current = isScrolledUp;

  useEffect(() => {
    if (!draft?.requestId || scrolledUpRef.current) {
      return;
    }
    void scrollToBottom({ animation: 'instant', wait: false });
  }, [draft?.requestId, scrollToBottom]);

  // ---------------------------------------------------------------------
  // Jump-to-latest / unread
  // ---------------------------------------------------------------------

  const completedAssistantCount = useMemo(() => countCompletedAssistantTurns(messages), [messages]);

  /**
   * What counts as seen. Tracks the arrival count while the view is following
   * the live edge, then freezes the moment the user reads away from it, so
   * "unread" is growth since that point.
   */
  const seenAssistantCountRef = useRef(0);
  const [seenAssistantCount, setSeenAssistantCount] = useState(0);

  const { isDetached, unreadCount } = deriveJumpState({
    isScrolledUp,
    isAtBottom,
    completedAssistantCount,
    seenAssistantCount,
  });

  useEffect(() => {
    // A conversation switch starts from what is on screen; the previous
    // thread's backlog is not unread in this one.
    seenAssistantCountRef.current = completedAssistantCount;
    setSeenAssistantCount(completedAssistantCount);
    // Deliberately keyed on the conversation alone: this is the reset, and must
    // not re-run as the count changes within a conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (isDetached || seenAssistantCountRef.current === completedAssistantCount) {
      return;
    }

    // Attached, so everything that has landed has been seen.
    seenAssistantCountRef.current = completedAssistantCount;
    setSeenAssistantCount(completedAssistantCount);
  }, [completedAssistantCount, isDetached]);

  // ---------------------------------------------------------------------
  // Turn-completion announcement
  // ---------------------------------------------------------------------

  /*
    `role="log" aria-live="polite"` used to sit on the scroll container, so
    every token *and* every virtualizer row swap was re-announced. The
    transcript is now inert to assistive tech during streaming and a single
    off-screen region reports turn boundaries.
  */
  const [announcement, setAnnouncement] = useState('');
  const previousDraftStatusRef = useRef<DraftStateLike['status'] | null>(null);

  useEffect(() => {
    const status = draft?.status ?? null;
    const previous = previousDraftStatusRef.current;
    previousDraftStatusRef.current = status;

    if (previous !== 'streaming' || status === 'streaming') {
      return;
    }

    setAnnouncement(
      status === 'error'
        ? 'Response failed'
        : status === 'aborted'
          ? 'Response stopped'
          : 'Response complete'
    );
  }, [draft?.status]);

  // ---------------------------------------------------------------------
  // Body
  // ---------------------------------------------------------------------

  const lastAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') {
        return index;
      }
    }
    return -1;
  }, [messages]);

  const viewportHeight = rowVirtualizer.scrollRect?.height ?? 0;
  const scrollOffset = rowVirtualizer.scrollOffset ?? 0;
  const richWindow = Math.max(800, viewportHeight * RICH_CONTENT_WINDOW);
  const richStart = scrollOffset - richWindow;
  const richEnd = scrollOffset + viewportHeight + richWindow;

  const emptyKind = isLoadingConversation
    ? 'loading'
    : showSetupPrompt
      ? 'setup'
      : !detail || showSuggestions
        ? 'suggestions'
        : null;

  let body: ReactNode;

  if (emptyKind === 'loading') {
    body = (
      <ConversationEmptyState
        className="p-0"
        icon={<Spinner className="h-6 w-6 border-2" />}
        title="Loading conversation"
        description="Fetching the latest messages for this session."
        role="status"
      />
    );
  } else if (emptyKind === 'setup') {
    body = (
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-warning-border bg-warning-bg p-6 text-center">
        <h2 className="text-lg font-normal text-text-primary">Add your API key to start</h2>
        <p className="mt-2 text-sm text-text-tertiary">
          Credentials are stored in your OS keychain. Nothing leaves your machine.
        </p>
        <button type="button" onClick={onOpenSettings} className="btn-primary mt-4 px-4 py-2 text-sm">
          Open Settings
        </button>
      </div>
    );
  } else if (emptyKind === 'suggestions') {
    // One wrapper for both the "no conversation selected" and the "empty
    // conversation" paths — they used to be two states with different
    // padding and centring, so the view jumped when `detail` resolved.
    body = (
      <SuggestionsState
        onSuggestionClick={onSuggestionClick}
        hasTools={hasTools}
        projectName={projectName}
      />
    );
  } else {
    body = (
      <>
        {hasOlder ? (
          /* Constant-height slot: the spinner appearing must not shove the
             transcript. There is no manual button any more — one mechanism
             (scroll to the top) instead of two competing ones. */
          <div className="mb-4 flex h-6 shrink-0 items-center justify-center">
            {isLoadingOlder ? (
              <span className="inline-flex items-center gap-2 text-2xs text-text-faint">
                <Spinner className="h-3 w-3" />
                Loading earlier messages
              </span>
            ) : null}
          </div>
        ) : null}

        <div ref={listRef} className="relative w-full" style={{ height: totalSize }}>
          {virtualItems.map((virtualItem) => {
            const message = messages[virtualItem.index];
            if (!message) {
              return null;
            }

            /*
              Rows are only stripped to plain text when they are more than
              ~1.5 viewports outside the window — the old rule degraded the
              four overscan rows just above the fold, measured them at that
              (much shorter) height, then jumped them to full height the
              moment they scrolled in.

              A stripped row is pinned to the height it was last measured
              at. Detaching `measureElement` would not help — the
              virtualizer's ResizeObserver keeps observing a still-connected
              node — but a pinned height makes the re-measurement a no-op,
              so the fallback's height can never enter the cache.
            */
            const isFarOutside = virtualItem.end < richStart || virtualItem.start > richEnd;

            return (
              <div
                key={virtualItem.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualItem.index}
                className={cn('absolute left-0 top-0 w-full', isFarOutside && 'overflow-hidden')}
                style={{
                  transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                  height: isFarOutside ? virtualItem.size : undefined,
                }}
                onTransitionEnd={(event) => {
                  // Disclosures animate `grid-template-rows` over 160ms; the
                  // ResizeObserver tracks it, this settles the final value.
                  if (event.propertyName === 'grid-template-rows') {
                    rowVirtualizer.measureElement(event.currentTarget);
                  }
                }}
              >
                <MessageRow
                  message={message}
                  deferRichContent={isFarOutside}
                  onRegenerate={
                    onRetryLastMessage && !draft && virtualItem.index === lastAssistantIndex
                      ? onRetryLastMessage
                      : undefined
                  }
                  onRespondToolApproval={onRespondToolApproval}
                  onReviewChanges={onReviewChanges}
                />
              </div>
            );
          })}
        </div>

        {draft ? (
          <div style={{ marginTop: messages.length > 0 ? HISTORY_GAP_PX : 0 }}>
            <StreamingRow
              parts={draft.parts}
              turnId={draft.requestId}
              errorMessage={draft.errorMessage}
              notice={draft.notice}
              status={draft.status}
              onRespondToolApproval={onRespondToolApproval}
              onRetry={onRetryLastMessage}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={attachScrollRef}
        /*
          Focusable so PageUp/PageDown/Home/End reach the transcript at all.
          The global `*:focus-visible` outline is pulled inside the box —
          a 2px ring hanging off the pane edge would be clipped.
        */
        tabIndex={0}
        aria-label="Conversation transcript"
        className="scrollbar-auto-hide relative min-h-0 flex-1 overflow-y-auto focus-visible:[outline-offset:-2px]"
      >
        <div
          ref={contentRef}
          className={cn(
            'flex w-full flex-col py-8',
            COLUMN_PADDING,
            emptyKind && 'min-h-full justify-center'
          )}
        >
          <div className="mx-auto flex w-full max-w-content-max flex-1 flex-col">{body}</div>
        </div>
      </div>

      {/*
        Always mounted so it can animate, and hysteretic (show past 120px,
        hide inside 40px) so it cannot strobe while the transcript settles.
      */}
      <button
        type="button"
        onClick={() => void scrollToBottom({ animation: 'smooth' })}
        tabIndex={isDetached ? 0 : -1}
        aria-hidden={!isDetached}
        className={cn(
          'absolute bottom-3 right-4 z-10 inline-flex h-7 items-center gap-1.5 rounded-full border border-border-subtle bg-bg-overlay px-2.5 text-2xs text-text-secondary shadow-elevated transition-[opacity,transform] duration-150 ease-out hover:text-text-primary motion-reduce:transition-none',
          isDetached ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        )}
      >
        <ArrowDown className="h-3.5 w-3.5" />
        <span>{unreadCount > 0 ? `${unreadCount} new` : 'Latest'}</span>
      </button>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
