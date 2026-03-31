import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ConversationDetail, ModelSummary } from '../../shared/contracts';
import { getTextContentFromParts } from '../../shared/messageParts';
import { ModelSelector } from './ModelSelector';
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
  type PromptInputMessage,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from './ai-elements/prompt-input';
import type { DraftStateLike } from './types';

type ComposerProps = {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  models: ModelSummary[];
  selectedModelId: string | null;
  detail: ConversationDetail | null;
  draft: DraftStateLike | null;
  onChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  onSelectModel: (modelId: string) => void;
  onRefreshModels?: () => void;
  isRefreshingModels?: boolean;
};

export function Composer({
  value,
  disabled,
  isStreaming,
  models,
  selectedModelId,
  detail,
  draft,
  onChange,
  onSend,
  onAbort,
  onSelectModel,
  onRefreshModels,
  isRefreshingModels,
}: ComposerProps) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const handleSubmit = (message: PromptInputMessage) => {
    if (message.text.trim() && !disabled && !isStreaming) {
      onSend();
    }
  };

  // Determine status for PromptInputSubmit
  const status = isStreaming ? 'streaming' : 'ready';

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
        0
      ) ?? 0;
    const fallbackConversationInput =
      detail?.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) ?? 0;
    const pendingInput = draft ? 0 : estimateTokens(value);
    const draftText = draft ? getTextContentFromParts(draft.parts) : '';

    const inputTokens =
      Math.max(
        0,
        draft?.inputTokens ?? latestUsageMessage?.inputTokens ?? fallbackConversationInput
      ) + pendingInput;
    const outputTokens = Math.max(0, draft?.outputTokens ?? latestUsageMessage?.outputTokens ?? 0);
    const reasoningTokens = Math.max(
      0,
      draft?.reasoningTokens ?? latestUsageMessage?.reasoningTokens ?? 0
    );

    const parts = selectedModel.id.split('/');
    const tokenLensModelId =
      parts.length > 1 ? `${parts[0]}:${parts.slice(1).join('/').replace(/:free$/i, '')}` : undefined;

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
    <div className="px-6 py-4 lg:px-8">
      <div className="mx-auto max-w-content-max">
        <PromptInput
          onSubmit={handleSubmit}
          className="overflow-hidden rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(24,27,34,0.92),rgba(15,18,24,0.96))] shadow-[0_18px_40px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.03)] transition-all focus-within:border-white/12 focus-within:bg-[linear-gradient(180deg,rgba(26,29,36,0.96),rgba(16,19,25,0.98))]"
        >
          <PromptInputBody className="px-5 pt-4">
            <PromptInputTextarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!disabled && !isStreaming && value.trim()) onSend();
                }
              }}
              disabled={disabled}
              rows={1}
              placeholder="Message..."
              className="w-full resize-none border-0 bg-transparent text-[15px] leading-6 text-text-primary outline-none placeholder:text-white/32 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ maxHeight: '200px' }}
              name="message"
            />
          </PromptInputBody>

          <PromptInputFooter className="flex items-center justify-between px-4 pb-4 pt-1.5">
            <PromptInputTools className="flex items-center gap-1">
              <ModelSelector
                models={models}
                selectedModelId={selectedModelId}
                disabled={isStreaming}
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
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

              {isStreaming ? (
                <button
                  type="button"
                  onClick={onAbort}
                  className="inline-flex size-10 items-center justify-center rounded-full bg-error/12 text-error transition hover:bg-error/20"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <PromptInputSubmit
                  status={status as 'ready' | 'streaming'}
                  disabled={disabled || !value.trim()}
                  className="inline-flex size-10 items-center justify-center rounded-full bg-[#2b468f] text-white shadow-[0_12px_28px_rgba(43,70,143,0.34)] transition hover:bg-[#3553a8] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </PromptInputSubmit>
              )}
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
