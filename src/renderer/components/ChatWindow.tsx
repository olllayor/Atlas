import {
  defaultRangeExtractor,
  measureElement as measureElementDefault,
  type Range,
  type Virtualizer,
  useVirtualizer,
} from '@tanstack/react-virtual';
import { AlertCircle, ArrowDown, Check, ChevronRight, Copy, Info, RefreshCw, StopCircle } from 'lucide-react';
import {
  memo,
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
import { PluginInvocationRow } from './transcript/PluginInvocationRow';
import { TimelineMinimap } from './transcript/TimelineMinimap';
import { deriveMinimapItems } from '../lib/timelineMinimap';
import { VisualBlock } from './ai-elements/visual';
import { ReasoningCell } from './transcript/ReasoningCell';
import { buildToolCells, collectChangedFiles, toolCellToPlainText } from '../../shared/toolCellGrammar';
import { isPlanToolPart } from '../../shared/planTool';
import { groupAssistantParts, hasPendingApproval, splitAssistantTurn } from './transcript/assistantSegments';
import type { AssistantSegment } from './transcript/assistantSegments';
import { ActivityBlock } from './transcript/ActivityBlock';
import { CHANGED_FILES_VISIBLE_ROWS, ChangedFilesBar } from './transcript/ChangedFilesBar';
import { PlanCell } from './transcript/PlanCell';
import { ToolCellList } from './transcript/ToolCell';
import { RAW_BLOCK, useRawTranscript } from '../lib/rawTranscript';
import { useClipboard } from '../hooks/useClipboard';
import { useTranscriptScroll } from '../hooks/useTranscriptScroll';
import { countCompletedAssistantTurns, deriveJumpState } from './jumpToLatest';
import { AtlasMark } from './ui/atlas-mark';
import { AtlasLoader, AtlasLoaderRow } from './ui/atlas-loader';

import { SpawnAgentCta } from './agents/SpawnAgentCta';
import { SubagentBreadcrumbs } from './subagents/SubagentBreadcrumbs';
import { useAppStore } from '../stores/useAppStore';
import { foldAgents, selectBatchAgents } from '../lib/agentFold';

export type ChatWindowProps = {
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
  /** Opens the Agents panel in the workbench. */
  onOpenAgentsPanel?: () => void;
  /**
   * Rolls back the edits a turn made, named by the tool calls that made them.
   * Absent, the card's Undo is not offered.
   */
  onUndoChanges?: (toolCallIds: string[]) => Promise<void>;
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
 * The history fold (the Codex transcript's "N previous messages" row).
 *
 * Past this many messages the thread opens scrolled to the live end with
 * everything older collapsed behind one disclosure row — the work you are
 * doing now is the part that matters, and a two-hundred-row transcript makes
 * the scrollbar the only navigation. Expanding is one click and stays
 * expanded for the visit; the fold re-arms on conversation switch.
 */
const HISTORY_FOLD_THRESHOLD = 20;
/** How many recent messages stay visible while folded. */
const HISTORY_FOLD_KEEP = 12;

/**
 * Column geometry.
 *
 * The transcript and the composer share one axis but not one measure: both
 * are centred full-bleed rows with the padding *outside* the max width
 * (`px-5 lg:px-6`), and the composer caps itself narrower (`max-w-composer`,
 * 48rem — the t3code composer form's `max-w-3xl`) than the transcript's
 * `content-max`. Panels opening and closing re-centre both automatically —
 * `mx-auto` is the whole mechanism. Putting the padding inside (as this
 * file used to, `px-6 lg:px-7 xl:px-8`) narrowed the message column ~32px
 * per side relative to the composer slab, and the mismatch grew at every
 * breakpoint; keep padding outside whatever the caps become.
 */
const COLUMN_PADDING = 'px-5 lg:px-6';

/**
 * The single text measure — the transcript column.
 *
 * Assistant content and user bubbles share one right rail at `content-max`
 * (860px at its widest). This used to cap at `76ch` inside that column, so
 * on a wide window the text stopped ~170px short of the composer slab below
 * it and left a dead vertical strip down the right of every conversation.
 * The composer has since taken its own narrower cap (`--composer-max`), so
 * the rail intentionally overhangs the slab by a few dozen pixels per side —
 * a centred column inside a slightly wider centred column reads as one
 * object, not as a misalignment.
 */
const MEASURE = 'w-full';

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
      // The visible label swaps to "Copied"; this is what makes the swap
      // audible instead of a silent icon change.
      aria-live="polite"
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
  onOpenAgentsPanel,
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
  onOpenAgentsPanel?: () => void;
}) {
  // Memoised because it used to be recomputed for every visible row on
  // every streamed token.
  const segments = useMemo(() => groupAssistantParts(parts), [parts]);
  // The work/answer cut, so the reply is not buried under the tool calls that
  // produced it. See `splitAssistantTurn`.
  const split = useMemo(() => splitAssistantTurn(segments), [segments]);
  const rawMode = useRawTranscript();

  // The two drivers of the plain-text path. `deferRichContent` is the
  // virtualizer's: a row more than ~1.5 viewports away is stripped to a cheap
  // stub, and that has to stay true in raw mode too — an off-screen row is
  // not in anyone's selection, so paying to render its tool cells as text buys
  // nothing. `rawMode` is the reader's, and it applies to every row that is
  // actually on screen, cell by cell.
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

    if (segment.kind === 'spawn') {
      return (
        <SpawnBatchRow
          key={`spawn-${segment.parts[0].toolCallId}`}
          parts={segment.parts}
          onRespondToolApproval={onRespondToolApproval}
          onOpenAgentsPanel={onOpenAgentsPanel}
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

    if (part.type === 'plugin-invocation') {
      return <PluginInvocationRow key={part.id} part={part} />;
    }

    if (rawMode) {
      // The markdown pipeline is the single largest source of copy artifacts:
      // a numbered list pastes without its numbers, a table pastes as tabs, a
      // fenced block pastes with the highlighter's zero-width spans. The
      // source text has none of those problems.
      return (
        <div
          key={part.id}
          className={cn(
            'app-code-text leading-[1.55]',
            RAW_BLOCK,
            options.dim ? 'text-text-secondary' : 'text-text-primary'
          )}
        >
          {part.text}
        </div>
      );
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

  const activityChildren = split.activity.map((segment, index) =>
    renderSegment(segment, {
      isLast: isStreaming && split.answer.length === 0 && index === split.activity.length - 1,
      dim: true,
    })
  );

  return (
    <>
      {split.activity.length > 0 ? (
        rawMode ? (
          /*
            Raw mode unwraps the activity fold entirely rather than passing
            `forceOpen`. A fold that is permanently open is still a fold — it
            keeps the `Worked for …` header, the chevron and the indent, and
            more to the point the collapsed default would hide the tool output
            that raw mode exists to make selectable.
          */
          <div className="flex flex-col gap-1.5">{activityChildren}</div>
        ) : (
          <ActivityBlock
            id={`activity:${turnId}`}
            isStreaming={isStreaming}
            fallbackDurationMs={durationMs}
            // Open while there is no reply under it — the live run of steps, or
            // a turn that ended without one. It folds as the answer arrives.
            defaultOpen={split.answer.length === 0}
            forceOpen={hasPendingApproval(split.activity)}
          >
            {activityChildren}
          </ActivityBlock>
        )
      ) : null}

      {/* Outside the fold on purpose: agents outlive the turn that launched
          them, so a collapsed turn must not take a live fleet with it. */}
      {split.spawn.map((segment) => renderSegment(segment, { isLast: false, dim: false }))}

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
    <div className="my-1.5 space-y-2">
      <ToolCellList parts={parts} approvals={approvals} />
    </div>
  );
}

/**
 * One row per spawn batch, rendered outside the turn's `Worked for …` fold.
 *
 * Membership is pinned to the batch's own tool calls rather than to the
 * conversation's whole roster, so a second fan-out later in the thread gets
 * its own counters instead of re-reporting the first one's.
 *
 * A spawn still waiting on approval is not a fleet yet: it renders as an
 * ordinary tool cell so the prompt stays in the transcript, where consent
 * belongs.
 */
function SpawnBatchRow({
  parts,
  onRespondToolApproval,
  onOpenAgentsPanel,
}: {
  parts: ChatToolPart[];
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
  onOpenAgentsPanel?: () => void;
}) {
  const activitiesByConversation = useAppStore((state) => state.activitiesByConversation);
  const selectedConversationId = useAppStore((state) => state.selectedConversationId);
  const activities = selectedConversationId ? (activitiesByConversation[selectedConversationId] ?? []) : [];

  const { pendingParts, spawnedToolCallIds } = useMemo(
    () => ({
      pendingParts: parts.filter((part) => part.state === 'approval-requested'),
      spawnedToolCallIds: parts
        .filter((part) => part.state !== 'approval-requested')
        .map((part) => part.toolCallId),
    }),
    [parts]
  );

  const agents = useMemo(
    () => selectBatchAgents(foldAgents(activities).agents, spawnedToolCallIds),
    [activities, spawnedToolCallIds]
  );

  return (
    <>
      {pendingParts.length > 0 && (
        <ToolCellGroup parts={pendingParts} onRespondToolApproval={onRespondToolApproval} />
      )}
      {spawnedToolCallIds.length > 0 && (
        <SpawnAgentCta
          agents={agents}
          spawnCallCount={spawnedToolCallIds.length}
          onOpenAgentsPanel={onOpenAgentsPanel ?? (() => {})}
        />
      )}
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

/**
 * One settled turn in the transcript.
 *
 * Memoised, and the memo is load-bearing rather than defensive: while a
 * response streams, `ChatWindow` re-renders on every 33ms flush because the
 * streaming row below genuinely changed. Every history row above it is
 * identical across those flushes — same `message` object, same callbacks — so
 * without this boundary a ten-row viewport paid ten row renders thirty times a
 * second to draw the same pixels.
 *
 * The default shallow prop compare is exactly right here: `message` is replaced
 * by the store's reducers only when that message changed, and the callbacks are
 * `useCallback`-stable up in `App`.
 */
const MessageRow = memo(function MessageRow({
  message,
  deferRichContent = false,
  onRegenerate,
  onRespondToolApproval,
  onReviewChanges,
  onUndoChanges,
  onOpenAgentsPanel,
}: {
  message: ChatMessage;
  deferRichContent?: boolean;
  onRegenerate?: () => void;
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
  onReviewChanges?: ChatWindowProps['onReviewChanges'];
  onUndoChanges?: ChatWindowProps['onUndoChanges'];
  onOpenAgentsPanel?: ChatWindowProps['onOpenAgentsPanel'];
}) {
  const isAssistant = message.role === 'assistant';
  const fileParts = getMessageFileParts(message.parts);
  // The end-of-turn "Edited N files" card — only for finished assistant
  // turns that actually produced file edits.
  const changedFiles = useMemo(() => {
    if (message.role !== 'assistant' || message.status !== 'complete') return null;
    const toolParts = message.parts.filter((part): part is ChatToolPart => part.type === 'tool');
    return toolParts.length ? collectChangedFiles(toolParts) : null;
  }, [message.role, message.status, message.parts]);
  // Undo is only offered for a turn whose edits can actually be named. A
  // history row replayed from a database written before the call ids were
  // recorded has none, and reverting "whatever touched these paths" would
  // reach into turns the reader did not ask about.
  const undoIds = changedFiles?.toolCallIds ?? [];
  const handleUndo =
    onUndoChanges && undoIds.length ? () => onUndoChanges(undoIds) : undefined;
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
          onOpenAgentsPanel={onOpenAgentsPanel}
        />

        {changedFiles ? (
          <ChangedFilesBar
            summary={changedFiles}
            onReview={onReviewChanges}
            onUndo={handleUndo}
          />
        ) : null}

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
});

function StreamingRow({
  parts,
  turnId,
  errorMessage,
  notice,
  status,
  onRespondToolApproval,
  onRetry,
  onOpenAgentsPanel,
}: {
  parts: ChatMessagePart[];
  /** The draft's request id — keys the turn's `Worked for …` disclosure. */
  turnId: string;
  errorMessage?: string;
  /** Why this turn is taking longer than it looks like it should. */
  notice?: DraftStateLike['notice'];
  status: 'queued' | 'streaming' | 'error' | 'aborted';
  onRespondToolApproval: ChatWindowProps['onRespondToolApproval'];
  onRetry?: () => void;
  onOpenAgentsPanel?: ChatWindowProps['onOpenAgentsPanel'];
}) {
  const isError = status === 'error';
  const isAborted = status === 'aborted';
  // A queued draft has no tokens and no turn — rendering an empty streaming
  // shell would invent a bubble for work that has not begun. The QueueDock
  // above the composer is the waiting state's home.
  if (status === 'queued') {
    return null;
  }
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
              <AssistantParts content="" parts={parts} turnId={turnId} onRespondToolApproval={onRespondToolApproval} onOpenAgentsPanel={onOpenAgentsPanel} />
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
            <AssistantParts content="" isStreaming parts={parts} turnId={turnId} onRespondToolApproval={onRespondToolApproval} onOpenAgentsPanel={onOpenAgentsPanel} />
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
  /** The "Edited N files" card's header and its top margin. */
  changedFilesHeader: 76,
  /** One file row inside that card, and the "Show N more files" row. */
  changedFilesRow: 36,
  visual: 320,
  file: 28,
  /** One line of a raw-mode `<pre>` at `app-code-text` size. */
  rawLine: 20,
} as const;

/**
 * Estimates already computed, keyed by the message they describe.
 *
 * The virtualizer asks for a row's size synchronously, for every row it has not
 * measured, every time the measurement cache is invalidated — and it is
 * invalidated on every stream flush, because the message array behind it is
 * replaced. The estimate is not cheap: it runs the tool-cell grammar, which
 * parses every unified diff in the turn. So a thread with a few edit-heavy
 * turns re-parsed those diffs thirty times a second, on the thread that also
 * has to paint.
 *
 * A `WeakMap` on the message object is the whole fix. Message identity changes
 * exactly when the message's content changes, which is exactly when the
 * estimate could differ, and entries die with the messages they describe.
 */
const rowHeightEstimates = new WeakMap<ChatMessage, { raw?: number; cooked?: number }>();

function estimateHistoryRowHeight(message: ChatMessage, raw: boolean): number {
  const cached = rowHeightEstimates.get(message);
  const hit = raw ? cached?.raw : cached?.cooked;
  if (hit !== undefined) return hit;

  const height = computeHistoryRowHeight(message, raw);
  if (cached) {
    if (raw) cached.raw = height;
    else cached.cooked = height;
  } else {
    rowHeightEstimates.set(message, raw ? { raw: height } : { cooked: height });
  }

  return height;
}

/**
 * @param raw Raw mode expands every cell and removes the activity fold, so the
 * collapsed-row assumptions above are all wrong under it. The runtime
 * calibration in `estimateScaleRef` would eventually absorb the error, but it
 * is a single scalar — it cannot represent "tool-heavy turns are now 20× taller
 * and prose turns are unchanged", so the estimate has to know about the mode
 * rather than be corrected after the fact.
 */
function computeHistoryRowHeight(message: ChatMessage, raw: boolean) {
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
  const diffCells = cells.filter((cell) => cell.detail.type === 'diff');
  const hasChangedFilesBar = message.status === 'complete' && diffCells.length > 0;
  /*
   * How many rows the card shows without being expanded. The card lists its
   * files inline now, so the estimate has to count them; over-counting a
   * twenty-file turn would leave a hole the size of seventeen rows.
   */
  const changedFileRows = hasChangedFilesBar
    ? Math.min(
        CHANGED_FILES_VISIBLE_ROWS,
        new Set(
          diffCells.flatMap((cell) =>
            cell.detail.type === 'diff' ? cell.detail.files.map((file) => file.path) : []
          )
        ).size
      )
    : 0;
  // `buildToolCells` drops plan parts, and however many of them a turn made
  // they collapse into one row — so they are counted once, not N times.
  const hasPlan = toolParts.some(isPlanToolPart);
  /*
   * A finished turn folds its whole work phase — every tool cell, every
   * reasoning row, and the commentary between them — behind one `Worked
   * for …` line, so the estimate counts one row for the lot. While the turn
   * is still streaming the fold is open and the rows are all on screen.
   */
  const activityIsFolded = !raw && message.status !== 'streaming' && cells.length > 0;

  // Line counts per cell, computed once: raw mode needs them for the activity
  // block *and* for the changed-files bar, which republishes the same patches.
  const rawCellLines = raw
    ? cells.map((cell) => ({ cell, lines: toolCellToPlainText(cell).split('\n').length }))
    : [];

  const activityHeight = activityIsFolded
    ? ROW_HEIGHT.reasoning
    : raw
      ? // Every cell is fully expanded, so the row is as tall as the text it
        // renders. Counting the lines is the only honest seed available.
        rawCellLines.reduce((sum, entry) => sum + entry.lines * ROW_HEIGHT.rawLine, 0) +
        reasoningCount * ROW_HEIGHT.reasoning
      : cells.length * ROW_HEIGHT.toolCell + reasoningCount * ROW_HEIGHT.reasoning;

  // In raw mode the card is not a header and a few rows but the full patch
  // text again, so it costs roughly what the diff cells above it cost, plus a
  // header line.
  const changedFilesHeight = !hasChangedFilesBar
    ? 0
    : raw
      ? (rawCellLines
          .filter((entry) => entry.cell.detail.type === 'diff')
          .reduce((sum, entry) => sum + entry.lines, 0) +
          2) *
        ROW_HEIGHT.rawLine
      : ROW_HEIGHT.changedFilesHeader + changedFileRows * ROW_HEIGHT.changedFilesRow;

  return Math.max(
    44,
    ROW_HEIGHT.assistantBase +
      Math.ceil(message.content.length / 100) * ROW_HEIGHT.textLine +
      activityHeight +
      (hasPlan ? ROW_HEIGHT.toolCell : 0) +
      changedFilesHeight +
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
  onUndoChanges,
  onOpenAgentsPanel,
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

  /**
   * During streaming the same content exists in two places: the draft (rendered
   * as `StreamingRow` below the virtualizer) and the persisted assistant
   * placeholder inside `detail.messages` (updated via `applyStreamingEvent` on
   * every 33 ms flush). Rendering both meant the transcript paid two markdown
   * layouts per token — the virtualizer's last row and the streaming row
   * underneath it showed identical text. The virtualizer also double-counted
   * the row's height in its `totalSize` (history estimate + streaming row),
   * which made the scrollbar thumb short by one row.
   *
   * While a draft is live the virtualizer owns only completed history. The
   * streaming row owns the live content. Once the turn settles the draft is
   * gone and the placeholder (now `status: complete`) naturally re-enters the
   * virtualizer as the last history row.
   */
  const historyMessages = useMemo(() => {
    if (!isStreaming || messages.length === 0) return messages;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.status === 'streaming') {
      return messages.slice(0, -1);
    }
    return messages;
  }, [messages, isStreaming]);

  /**
   * The folded view is a *suffix* of the real history. Every index the
   * virtualizer sees — rows, minimap, jump targets — is an index into this
   * array; the fold row itself lives outside the list as ordinary flow, so
   * the virtualizer never counts it.
   */
  const [foldExpanded, setFoldExpanded] = useState(false);
  const folded = historyMessages.length > HISTORY_FOLD_THRESHOLD && !foldExpanded;
  const visibleMessages = useMemo(
    () => (folded ? historyMessages.slice(-HISTORY_FOLD_KEEP) : historyMessages),
    [folded, historyMessages]
  );
  const hiddenMessageCount = historyMessages.length - visibleMessages.length;

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

  const rawTranscript = useRawTranscript();

  const estimateSize = useCallback(
    (index: number) => {
      const message = visibleMessages[index];
      const base = message ? estimateHistoryRowHeight(message, rawTranscript) : 120;
      const { measured, estimated, count } = estimateScaleRef.current;
      if (count < 4 || estimated <= 0) {
        return base;
      }
      const scale = Math.min(4, Math.max(0.4, measured / estimated));
      return Math.round(base * scale);
    },
    [visibleMessages, rawTranscript]
  );

  const measureRow = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLElement, HTMLDivElement>
    ) => {
      const size = measureElementDefault(element, entry, instance);
      const index = Number(element.getAttribute('data-index'));
      const message = Number.isFinite(index) ? visibleMessages[index] : undefined;

      if (message && size > 0) {
        const stats = estimateScaleRef.current;
        stats.measured += size;
        stats.estimated += estimateHistoryRowHeight(message, rawTranscript);
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
    [visibleMessages, rawTranscript]
  );

  /*
    `getItemKey` is one of the inputs the virtualizer memoises its whole
    measurement pass on, so an inline arrow — a new function on every render —
    threw that pass away thirty times a second while a response streamed, and
    every row it had never measured was re-estimated each time. Reading the
    array through a ref keeps the answer identical and the identity fixed.
  */
  const visibleMessagesRef = useRef(visibleMessages);
  visibleMessagesRef.current = visibleMessages;
  const getItemKey = useCallback(
    (index: number) => visibleMessagesRef.current[index]?.id ?? index,
    []
  );

  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: visibleMessages.length,
    estimateSize,
    measureElement: measureRow,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    gap: HISTORY_GAP_PX,
    overscan: 0,
    scrollMargin,
    rangeExtractor,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleRange = rowVirtualizer.range;
  const totalSize = rowVirtualizer.getTotalSize();

  // ---------------------------------------------------------------------
  // Timeline minimap
  // ---------------------------------------------------------------------

  const minimapItems = useMemo(() => deriveMinimapItems(visibleMessages), [visibleMessages]);
  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());

  /** Manual navigation: detach from the bottom first or stick-to-bottom wins. */
  const jumpToRowIndex = useCallback(
    (rowIndex: number) => {
      stopScroll();
      rowVirtualizer.scrollToIndex(rowIndex, { align: 'start' });
    },
    [stopScroll, rowVirtualizer]
  );

  /*
   * Toggling raw mode rewrites the height of every row in the transcript, and
   * the virtualizer is holding a measurement for each one it has ever
   * rendered. Without this the cached heights survive the toggle, so the
   * scrollbar keeps describing the old layout and every scroll into
   * previously-measured territory snaps. `measure()` drops the cache; the
   * calibration accumulator has to go with it, since it was calibrated against
   * estimates for the other mode.
   *
   * Skipped on mount — there is nothing cached yet, and re-measuring would
   * throw away the initial scroll-to-bottom.
   */
  const previousRawRef = useRef(rawTranscript);
  useLayoutEffect(() => {
    if (previousRawRef.current === rawTranscript) return;
    previousRawRef.current = rawTranscript;
    estimateScaleRef.current = { measured: 0, estimated: 0, count: 0 };
    rowVirtualizer.measure();
  }, [rawTranscript, rowVirtualizer]);

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
    // The fold re-arms per conversation: a thread you fully expanded stays
    // expanded for the visit, but the next thread opens at the live end.
    setFoldExpanded(false);

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
  }, [conversationId, hasOlder, showSuggestions, showSetupPrompt, isLoadingConversation, historyMessages.length, folded]);

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

    const prependedCount = historyMessages.length - pending.previousMessageCount;
    if (prependedCount <= 0) {
      return;
    }

    pendingPrependRef.current = null;
    rowVirtualizer.scrollToIndex(prependedCount, { align: 'start' });
  }, [conversationId, historyMessages.length, rowVirtualizer]);

  const loadOlderMessages = useCallback(async () => {
    if (!detail?.conversation || !hasOlder || isLoadingOlder) {
      return;
    }

    pendingPrependRef.current = {
      conversationId: detail.conversation.id,
      previousMessageCount: historyMessages.length,
    };

    await onLoadOlderMessages(detail.conversation.id);
  }, [detail, hasOlder, isLoadingOlder, historyMessages.length, onLoadOlderMessages]);

  /**
   * Auto-load older history when the top of the list comes into view —
   * gated on the user having actually scrolled. `startIndex === 0` is true
   * on the first paint of every thread, which used to fire a page load
   * nobody asked for on every conversation open.
   */
  useEffect(() => {
    // While folded, the top of the *visible* list is the fold boundary, not
    // the top of the history — auto-loading there would page messages the
    // fold is hiding. Expansion is what reopens the paging path.
    if (folded) {
      return;
    }
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
    folded,
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

  const completedAssistantCount = useMemo(() => countCompletedAssistantTurns(historyMessages), [historyMessages]);

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

  /**
   * Expanding the fold inserts the hidden rows *above* the viewport; without
   * compensation the reader is thrown to a different part of the thread.
   * Scroll-height delta keeps the on-screen content pixel-stable — the same
   * trick the pagination prepend uses, applied to a one-shot reveal. The
   * virtualizer's first paint runs on estimates; `measureElement` settles
   * the real heights right after, so any drift is a few pixels of estimate
   * error, not a jump.
   */
  const preExpandScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const expandFold = useCallback(() => {
    const element = scrollRef.current;
    preExpandScrollRef.current = element
      ? { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }
      : null;
    setFoldExpanded(true);
  }, []);

  useLayoutEffect(() => {
    const captured = preExpandScrollRef.current;
    if (!foldExpanded || !captured) {
      return;
    }
    preExpandScrollRef.current = null;
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = captured.scrollTop + (element.scrollHeight - captured.scrollHeight);
  }, [foldExpanded]);

  // ---------------------------------------------------------------------
  // Body
  // ---------------------------------------------------------------------

  const lastAssistantIndex = useMemo(() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      if (visibleMessages[index]?.role === 'assistant') {
        return index;
      }
    }
    return -1;
  }, [visibleMessages]);

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
        icon={<AtlasLoader size="lg" real />}
        title="Loading conversation"
        description="Fetching the latest messages for this session."
        role="status"
      />
    );
  } else if (emptyKind === 'setup') {
    body = (
      // Neutral surface, not the warning palette: a missing key is first-run
      // onboarding with a CTA, not something that broke. Warning colours here
      // read as an error state on the very first screen.
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-border-subtle bg-bg-surface p-6 text-center">
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
            {isLoadingOlder ? <AtlasLoaderRow label="Loading earlier messages" size="sm" /> : null}
          </div>
        ) : null}

        {folded ? (
          /*
            The history fold — one row where the collapsed older messages
            would be. Hairline underneath, per the reference: the rule is the
            seam, the label is the affordance. Sits in ordinary flow above the
            virtual list, so it scrolls away with the content it introduces.
          */
          <div className="relative mb-5">
            <button
              type="button"
              onClick={expandFold}
              className="group inline-flex h-7 items-center gap-1 rounded-sm px-1 text-sm text-text-tertiary transition-colors hover:text-text-secondary"
            >
              {hiddenMessageCount} previous{' '}
              {hiddenMessageCount === 1 ? 'message' : 'messages'}
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform duration-fast motion-reduce:transition-none group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
            <span aria-hidden className="absolute inset-x-0 -bottom-2 h-px bg-border-subtle" />
          </div>
        ) : null}

        <div ref={listRef} className="relative w-full" style={{ height: totalSize }}>
          {virtualItems.map((virtualItem) => {
            const message = visibleMessages[virtualItem.index];
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
                  onUndoChanges={onUndoChanges}
                  onOpenAgentsPanel={onOpenAgentsPanel}
                />
              </div>
            );
          })}
        </div>

        {draft ? (
          <div style={{ marginTop: historyMessages.length > 0 ? HISTORY_GAP_PX : 0 }}>
            <StreamingRow
              parts={draft.parts}
              turnId={draft.requestId}
              errorMessage={draft.errorMessage}
              notice={draft.notice}
              status={draft.status}
              onRespondToolApproval={onRespondToolApproval}
              onRetry={draft.error?.retryable !== false ? onRetryLastMessage : undefined}
              onOpenAgentsPanel={onOpenAgentsPanel}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {conversationId && (
        <>
          {/* Self-styling components: each renders nothing when empty, so an
              ordinary conversation gets no phantom header strip here. */}
          {/* Breadcrumbs only. The fleet roster lives in the Agents panel —
              a second one here is the duplication this replaced. */}
          <SubagentBreadcrumbs conversationId={conversationId} onSelect={(id) => void useAppStore.getState().loadConversation(id)} />
        </>
      )}
      <div
        ref={attachScrollRef}
        /*
          Focusable so PageUp/PageDown/Home/End reach the transcript at all.
          The global `*:focus-visible` outline is pulled inside the box —
          a 2px ring hanging off the pane edge would be clipped.
        */
        tabIndex={0}
        role="region"
        aria-label="Conversation transcript"
        className="scrollbar-auto-hide relative min-h-0 flex-1 overflow-y-auto focus-visible:[outline-offset:-2px]"
      >
        <div
          ref={contentRef}
          className={cn(
            /*
              The bottom pad is exactly the composer's height, published by
              `App.tsx` as `--composer-dock-height` (the fallback covers the
              frame before the dock is measured).

              Exactly, not plus a margin: the composer floats over this
              scroller, so the pad is only there to stop the last message
              being stranded underneath it. The fade band above the dock is
              part of that pad: docked, the newest line rests at the *top* of
              the ramp, so live text is never dimmed and the gradient shows
              only background (invisible); scrolled up, content slides under
              the band and dissolves instead of hard-clipping at the slab
              edge. Keep the two in sync — the band is `3.5rem`
              (`.scroll-edge-fade-bottom`).
            */
            'flex w-full flex-col pt-8 pb-[calc(var(--composer-dock-height,7rem)+3.5rem)]',
            COLUMN_PADDING,
            emptyKind && 'min-h-full justify-center'
          )}
        >
          <div className="mx-auto flex w-full max-w-content-max flex-1 flex-col">{body}</div>
        </div>
      </div>

      {/*
        Jump rail in the side gutter. Sits outside the scroller so it never
        scrolls away; its own hit-strip capping keeps it clear of the text.
      */}
      <TimelineMinimap
        items={minimapItems}
        stripMap={minimapStripMap}
        viewportElement={scrollNode}
        range={visibleRange}
        onSelect={jumpToRowIndex}
      />

      {/*
        Fades transcript lines into the background where they pass under the
        floating composer slab — dsh's composer-seat ramp. Always on, not
        scroll-conditional: detached, mid-transcript content slides under the
        slab and would otherwise hard-clip at its top edge (the cut lands
        mid-glyph, inset from the content edges, because the slab is narrower
        than the transcript column); docked, the band overlaps only the tail
        of the newest message, where a soft dissolve reads as depth rather
        than as loss. A state-dependent seam flickers on every scroll-state
        flip; a constant one is furniture.
      */}
      <div
        aria-hidden
        className="scroll-edge-fade-bottom pointer-events-none absolute inset-x-0 bottom-[var(--composer-dock-height,7rem)] z-[5]"
      />

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
          // Rides above the floating composer rather than behind it.
          'absolute bottom-[calc(var(--composer-dock-height,7rem)+0.75rem)] right-4 z-10 inline-flex h-7 items-center gap-1.5 rounded-full border border-border-subtle bg-bg-overlay px-2.5 text-2xs text-text-secondary shadow-elevated transition-[opacity,transform] duration-150 ease-out hover:text-text-primary motion-reduce:transition-none',
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
