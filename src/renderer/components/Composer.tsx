import { PlusIcon } from '@radix-ui/react-icons';
import { Palette } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE_BYTES,
  getAttachmentCapabilityError,
} from '../../shared/attachments';
import type { ReasoningEffort, ToolPermissionMode } from '../../shared/chatParameters';
import type {
  ConversationDetail,
  CustomProvider,
  ModelSummary,
  ProviderCredentialSummary,
} from '../../shared/contracts';
import { ReasoningEffortControl, ToolPermissionModeControl } from './composer/ComposerParameters';
import { getTextContentFromParts } from '../../shared/messageParts';
import { ModelSelector } from './ModelSelector';
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  getAttachmentLabel,
  getMediaCategory,
  type AttachmentData,
} from './ai-elements/attachments';
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from './ai-elements/context';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from './ai-elements/prompt-input';
import { MentionAutocompleteList, useMentionAutocomplete } from './MentionAutocomplete';
import type { DraftStateLike } from './types';

type ComposerProps = {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  models: ModelSummary[];
  selectedModelId: string | null;
  modelPickerOpen: boolean;
  composerFocusNonce: number;
  detail: ConversationDetail | null;
  draft: DraftStateLike | null;
  onChange: (value: string) => void;
  onSend: (message: PromptInputMessage) => Promise<void> | void;
  onAbort: () => void;
  onSelectModel: (modelId: string) => void;
  onModelPickerOpenChange: (open: boolean) => void;
  onComposerFocusChange: (focused: boolean) => void;
  onRefreshModels?: () => void;
  isRefreshingModels?: boolean;
  customProviders?: CustomProvider[];
  credentials?: ProviderCredentialSummary[];
  defaultFreeOnly?: boolean;
  onManageProviders?: () => void;
  reasoningEffort: ReasoningEffort;
  toolPermissionMode: ToolPermissionMode;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onToolPermissionModeChange: (value: ToolPermissionMode) => void;
  onOpenGallery: () => void;
};

const ComposerAttachmentItem = memo(
  ({
    attachment,
    onRemove,
  }: {
    attachment: AttachmentData;
    onRemove: (id: string) => void;
  }) => {
    const handleRemove = useCallback(() => onRemove(attachment.id), [attachment.id, onRemove]);
    const mediaCategory = getMediaCategory(attachment);
    const label = getAttachmentLabel(attachment);
    const isImage = mediaCategory === 'image';
    const [thumbnailFailed, setThumbnailFailed] = useState(false);
    const inlinePreview =
      isImage && attachment.type === 'file' && attachment.url && !thumbnailFailed ? (
        <img
          alt={label}
          className="size-full rounded-[6px] object-cover"
          height={18}
          onError={() => setThumbnailFailed(true)}
          src={attachment.url}
          width={18}
        />
      ) : (
        <AttachmentPreview className="size-full rounded-[6px] bg-transparent" />
      );

    return (
      <AttachmentHoverCard>
        <AttachmentHoverCardTrigger asChild>
          <Attachment
            className="h-7 max-w-[148px] gap-1.5 border border-[var(--border-default)] bg-[var(--bg-subtle)] pl-1.5 pr-1 text-text-secondary hover:bg-[var(--bg-hover)] hover:text-text-primary"
            data={attachment}
            onRemove={handleRemove}
          >
            <div className="flex size-[18px] shrink-0 items-center justify-center overflow-hidden bg-[var(--bg-hover)]">
              {inlinePreview}
            </div>
            <AttachmentInfo className="min-w-0 max-w-[92px] flex-none text-[11px] leading-none text-inherit" />
            <AttachmentRemove className="!ml-0 !size-4 shrink-0 !p-0 !opacity-100 text-[var(--text-faint)] transition hover:bg-[var(--bg-active)] hover:text-white [&>svg]:size-[10px]" />
          </Attachment>
        </AttachmentHoverCardTrigger>
        <AttachmentHoverCardContent
          className="max-w-[240px] border border-[var(--border-default)] bg-bg-overlay px-2.5 py-1.5 text-[12px] font-normal text-white shadow-elevated"
          side="top"
          sideOffset={6}
        >
          <div className="truncate">{label}</div>
        </AttachmentHoverCardContent>
      </AttachmentHoverCard>
    );
  },
);

ComposerAttachmentItem.displayName = 'ComposerAttachmentItem';

function ComposerAttachmentsHeader() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <PromptInputHeader className="px-4 pt-3">
      <Attachments variant="inline" className="max-w-full">
        {attachments.files.map((attachment) => (
          <ComposerAttachmentItem
            attachment={attachment}
            key={attachment.id}
            onRemove={attachments.remove}
          />
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

function ComposerFooter({
  attachmentError,
  disabled,
  hasText,
  isRefreshingModels,
  customProviders,
  credentials,
  defaultFreeOnly,
  onManageProviders,
  reasoningEffort,
  toolPermissionMode,
  onReasoningEffortChange,
  onToolPermissionModeChange,
  isStreaming,
  modelPickerOpen,
  models,
  onAbort,
  onAttachmentErrorClear,
  onModelPickerOpenChange,
  onRefreshModels,
  onSelectModel,
  selectedModel,
  selectedModelId,
  modelSupportsTools,
  contextStats,
  onOpenGallery,
}: {
  attachmentError: string | null;
  disabled: boolean;
  hasText: boolean;
  isRefreshingModels?: boolean;
  customProviders?: CustomProvider[];
  credentials?: ProviderCredentialSummary[];
  defaultFreeOnly?: boolean;
  onManageProviders?: () => void;
  reasoningEffort: ReasoningEffort;
  toolPermissionMode: ToolPermissionMode;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onToolPermissionModeChange: (value: ToolPermissionMode) => void;
  isStreaming: boolean;
  modelPickerOpen: boolean;
  models: ModelSummary[];
  onAbort: () => void;
  onAttachmentErrorClear: () => void;
  onModelPickerOpenChange: (open: boolean) => void;
  onRefreshModels?: () => void;
  onSelectModel: (modelId: string) => void;
  selectedModel: ModelSummary | null;
  selectedModelId: string | null;
  modelSupportsTools: boolean;
  contextStats: {
    maxTokens: number;
    modelId?: string;
    processedTokens: number;
    usage: {
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
    };
    usedTokens: number;
  } | null;
  onOpenGallery: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const unsupportedReason = getAttachmentCapabilityError(selectedModel, attachments.files);
  const hasSubmittableContent = hasText || attachments.files.length > 0;
  const footerMessage = attachmentError ?? unsupportedReason;

  useEffect(() => {
    if (attachments.files.length > 0) {
      onAttachmentErrorClear();
    }
  }, [attachments.files.length, onAttachmentErrorClear]);

  return (
    <>
      {footerMessage ? <div className="px-4 pb-2 text-[11px] leading-5 text-[var(--text-tertiary)]">{footerMessage}</div> : null}

      <PromptInputFooter className="flex items-center gap-2 px-3 pb-2.5 pt-0.5">
        <PromptInputTools className="flex min-w-0 items-center gap-0.5">
          <PromptInputButton
            className="size-8 rounded-full bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-ghost)] hover:text-white"
            disabled={disabled || isStreaming}
            onClick={() => attachments.openFileDialog()}
            tooltip="Attach from disk"
          >
            <PlusIcon className="h-4 w-4" />
          </PromptInputButton>

          <PromptInputButton
            className="size-8 rounded-full bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-ghost)] hover:text-white"
            onClick={onOpenGallery}
            tooltip="Visual Gallery"
          >
            <Palette className="h-4 w-4" />
          </PromptInputButton>

          <ToolPermissionModeControl
            value={toolPermissionMode}
            disabled={isStreaming || !modelSupportsTools}
            onChange={onToolPermissionModeChange}
          />
        </PromptInputTools>

        {/* The right cluster is the per-turn parameter strip: how much context
            is left, which model, how hard it thinks, then send. */}
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          {contextStats ? (
            <Context
              maxTokens={contextStats.maxTokens}
              usedTokens={contextStats.usedTokens}
              processedTokens={contextStats.processedTokens}
              usage={contextStats.usage}
              modelId={contextStats.modelId}
            >
              <ContextTrigger />
              <ContextContent>
                <ContextContentHeader />
                <ContextContentBody />
                <ContextContentFooter />
              </ContextContent>
            </Context>
          ) : null}

          <ModelSelector
            models={models}
            selectedModelId={selectedModelId}
            disabled={isStreaming}
            open={modelPickerOpen}
            onOpenChange={onModelPickerOpenChange}
            onSelect={onSelectModel}
            onRefresh={onRefreshModels}
            isRefreshing={isRefreshingModels}
            customProviders={customProviders}
            credentials={credentials}
            defaultFreeOnly={defaultFreeOnly}
            onManageProviders={onManageProviders}
          />

          <ReasoningEffortControl
            value={reasoningEffort}
            disabled={isStreaming}
            supported={Boolean(selectedModel?.supportsReasoning)}
            onChange={onReasoningEffortChange}
          />

          <PromptInputSubmit
            className="ml-1 inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={isStreaming ? false : !hasSubmittableContent || disabled || Boolean(unsupportedReason)}
            onStop={onAbort}
            size="icon-sm"
            status={isStreaming ? 'streaming' : 'ready'}
            title={isStreaming ? 'Stop generating' : 'Send message'}
          />
        </div>
      </PromptInputFooter>
    </>
  );
}

export function Composer({
  value,
  disabled,
  isStreaming,
  models,
  selectedModelId,
  modelPickerOpen,
  composerFocusNonce,
  detail,
  draft,
  onChange,
  onSend,
  onAbort,
  onSelectModel,
  onModelPickerOpenChange,
  onComposerFocusChange,
  onRefreshModels,
  isRefreshingModels,
  customProviders,
  credentials,
  defaultFreeOnly,
  onManageProviders,
  reasoningEffort,
  toolPermissionMode,
  onReasoningEffortChange,
  onToolPermissionModeChange,
  onOpenGallery,
}: ComposerProps) {
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionAutocomplete({ value, onChange, textareaRef, disabled });
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [composerFocusNonce]);

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text.trim());
    const hasAttachments = message.files.length > 0;

    if ((!hasText && !hasAttachments) || disabled || isStreaming) {
      return;
    }

    setAttachmentError(null);
    return onSend(message);
  };

  const contextStats = useMemo(() => {
    const contextWindow = selectedModel?.contextWindow ?? null;
    if (!contextWindow || !selectedModel) {
      return null;
    }

    const estimateTokens = (text: string) => {
      const trimmed = text.trim();
      return trimmed ? Math.ceil(trimmed.length / 4) : 0;
    };

    const latestUsageMessage = detail?.messages
      .slice()
      .reverse()
      .find((message) => message.inputTokens || message.outputTokens || message.reasoningTokens);

    const processedFromMessages =
      detail?.messages.reduce(
        (sum, message) => sum + Math.max(0, message.inputTokens ?? 0) + Math.max(0, message.outputTokens ?? 0),
        0,
      ) ?? 0;
    const fallbackConversationInput =
      detail?.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) ?? 0;
    const pendingInput = draft ? 0 : estimateTokens(value);
    const draftText = draft ? getTextContentFromParts(draft.parts) : '';

    const inputTokens =
      Math.max(0, draft?.inputTokens ?? latestUsageMessage?.inputTokens ?? fallbackConversationInput) + pendingInput;
    const outputTokens = Math.max(0, draft?.outputTokens ?? latestUsageMessage?.outputTokens ?? 0);
    const reasoningTokens = Math.max(0, draft?.reasoningTokens ?? latestUsageMessage?.reasoningTokens ?? 0);

    const parts = selectedModel.id.split('/');
    const tokenLensModelId =
      parts.length > 1
        ? `${parts[0]}:${parts
            .slice(1)
            .join('/')
            .replace(/:free$/i, '')}`
        : undefined;

    return {
      maxTokens: contextWindow,
      modelId: tokenLensModelId,
      processedTokens: processedFromMessages + pendingInput,
      usage: {
        inputTokens,
        outputTokens,
        reasoningTokens,
      },
      usedTokens: Math.max(inputTokens + outputTokens, estimateTokens(draftText) + outputTokens),
    };
  }, [detail, draft, selectedModel, value]);

  return (
    <div className="px-5 py-3 lg:px-6">
      <div className="mx-auto max-w-content-max">
        <PromptInput
          accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
          className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-bg-base transition-colors focus-within:border-[var(--border-strong)]"
          globalDrop
          maxFileSize={MAX_ATTACHMENT_SIZE_BYTES}
          maxFiles={MAX_ATTACHMENT_COUNT}
          multiple
          onError={(error) => setAttachmentError(error.message)}
          onSubmit={handleSubmit}
        >
          <ComposerAttachmentsHeader />

          <PromptInputBody className="relative px-4 pt-3.5 pb-1.5">
            {mentions.isOpen ? (
              <MentionAutocompleteList
                suggestions={mentions.suggestions}
                activeIndex={mentions.activeIndex}
                onHover={mentions.setActiveIndex}
                onSelect={mentions.select}
              />
            ) : null}
            <PromptInputTextarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                mentions.syncCaret();
              }}
              onKeyDown={(e) => {
                // Consumed keys must stop here: PromptInputTextarea submits on
                // Enter unless the external handler prevented default.
                if (mentions.handleKeyDown(e)) {
                  e.preventDefault();
                }
              }}
              onSelect={mentions.syncCaret}
              onClick={mentions.syncCaret}
              onBlur={() => {
                onComposerFocusChange(false);
                mentions.dismiss();
              }}
              onFocus={() => onComposerFocusChange(true)}
              disabled={disabled}
              rows={1}
              placeholder="Message…"
              // The shadcn textarea ships a focus ring and its own rounding. Inside
              // the composer shell that paints a second box around the text area,
              // in whichever accent the active theme maps --ring to.
              className="w-full min-h-10.5 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[14.5px] leading-6 text-text-primary shadow-none outline-none ring-0 placeholder:text-[var(--text-faint)] focus-visible:border-0 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ maxHeight: '180px' }}
              name="message"
            />
          </PromptInputBody>

          <ComposerFooter
            attachmentError={attachmentError}
            disabled={disabled}
            hasText={Boolean(value.trim())}
            isRefreshingModels={isRefreshingModels}
            customProviders={customProviders}
            credentials={credentials}
            defaultFreeOnly={defaultFreeOnly}
            onManageProviders={onManageProviders}
            reasoningEffort={reasoningEffort}
            toolPermissionMode={toolPermissionMode}
            onReasoningEffortChange={onReasoningEffortChange}
            onToolPermissionModeChange={onToolPermissionModeChange}
            modelSupportsTools={Boolean(selectedModel?.supportsTools)}
            isStreaming={isStreaming}
            modelPickerOpen={modelPickerOpen}
            models={models}
            onAbort={onAbort}
            onAttachmentErrorClear={() => setAttachmentError(null)}
            onModelPickerOpenChange={onModelPickerOpenChange}
            onRefreshModels={onRefreshModels}
            onSelectModel={(modelId) => {
              onModelPickerOpenChange(false);
              onSelectModel(modelId);
            }}
            selectedModel={selectedModel}
            selectedModelId={selectedModelId}
            contextStats={contextStats}
            onOpenGallery={onOpenGallery}
          />
        </PromptInput>
      </div>
    </div>
  );
}
