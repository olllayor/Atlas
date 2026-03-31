import { Send, Square } from 'lucide-react';
import { useState } from 'react';

import type { ModelSummary } from '../../shared/contracts';
import { ModelSelector } from './ModelSelector';

type ComposerProps = {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  models: ModelSummary[];
  selectedModelId: string | null;
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
  onChange,
  onSend,
  onAbort,
  onSelectModel,
  onRefreshModels,
  isRefreshingModels,
}: ComposerProps) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  return (
    <div className="border-t border-white/8 bg-[#0a0c10]/80 px-4 py-4 backdrop-blur-sm">
      <div className="mx-auto max-w-[720px]">
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-[#111418] p-2">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!disabled && !isStreaming) onSend();
              }
            }}
            disabled={disabled}
            rows={1}
            placeholder="Message..."
            className="min-h-[40px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex shrink-0 items-center gap-1.5 pb-1">
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
            {isStreaming ? (
              <button
                type="button"
                onClick={onAbort}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={disabled || !value.trim()}
                className="inline-flex items-center justify-center rounded-lg bg-white p-2 text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
