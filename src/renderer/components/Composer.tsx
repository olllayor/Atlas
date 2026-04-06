import { PlusIcon } from '@radix-ui/react-icons';
import { Palette } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE_BYTES,
  getAttachmentCapabilityError,
} from '../../shared/attachments';
import type { ConversationDetail, ModelSummary } from '../../shared/contracts';
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
          className="max-w-[240px] border border-[var(--border-default)] bg-bg-elevated px-2.5 py-1.5 text-[12px] font-normal text-white"
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
  contextStats,
  onOpenGallery,
}: {
  attachmentError: string | null;
  disabled: boolean;
  hasText: boolean;
  isRefreshingModels?: boolean;
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

      <PromptInputFooter className="flex items-center justify-between px-3.5 pb-3 pt-0.5">
        <PromptInputTools className="flex items-center gap-1">
          <PromptInputButton
            className="size-8 border border-[var(--border-default)] bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-white"
            disabled={disabled || isStreaming}
            onClick={() => attachments.openFileDialog()}
            tooltip="Attach from disk"
          >
            <PlusIcon className="h-4 w-4" />
          </PromptInputButton>

          <PromptInputButton
            className="size-8 rounded-full border border-white/8 bg-white/[0.03] text-white/58 hover:bg-white/[0.07] hover:text-white"
            onClick={onOpenGallery}
            tooltip="Visual Gallery"
          >
            <Palette className="h-4 w-4" />
          </PromptInputButton>

          <ModelSelector
            models={models}
            selectedModelId={selectedModelId}
            disabled={isStreaming}
            open={modelPickerOpen}
            onOpenChange={onModelPickerOpenChange}
            onSelect={onSelectModel}
            onRefresh={onRefreshModels}
            isRefreshing={isRefreshingModels}
          />
        </PromptInputTools>

        <div className="flex items-center gap-2">
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

          <PromptInputSubmit
            className="inline-flex size-8 items-center justify-center bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={isStreaming ? false : !hasSubmittableContent || disabled || Boolean(unsupportedReason)}
            onStop={onAbort}
            size="icon-sm"
            status={isStreaming ? 'streaming' : 'ready'}
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
  onOpenGallery,
}: ComposerProps) {
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
          className="overflow-hidden border border-[var(--border-default)] bg-bg-base transition-colors focus-within:border-[var(--border-strong)]"
          globalDrop
          maxFileSize={MAX_ATTACHMENT_SIZE_BYTES}
          maxFiles={MAX_ATTACHMENT_COUNT}
          multiple
          onError={(error) => setAttachmentError(error.message)}
          onSubmit={handleSubmit}
        >
          <ComposerAttachmentsHeader />

          <PromptInputBody className="px-4 pt-3.5 pb-1.5">
            <PromptInputTextarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => onComposerFocusChange(false)}
              onFocus={() => onComposerFocusChange(true)}
              disabled={disabled}
              rows={1}
              placeholder="Message..."
              className="w-full min-h-10.5 resize-none border-0 bg-transparent px-0 py-0 text-[14.5px] leading-6 text-text-primary outline-none placeholder:text-[var(--text-faint)] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ maxHeight: '180px' }}
              name="message"
            />
          </PromptInputBody>

          <ComposerFooter
            attachmentError={attachmentError}
            disabled={disabled}
            hasText={Boolean(value.trim())}
            isRefreshingModels={isRefreshingModels}
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
