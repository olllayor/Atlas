import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  ModelSelector as AIModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';

import type { ModelSummary } from '../../shared/contracts';
import { PROVIDER_METADATA } from '../../shared/providerMetadata';

type ModelSelectorProps = {
  models: ModelSummary[];
  selectedModelId: string | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (modelId: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
};

const extractNamespace = (model: ModelSummary): string => {
  return PROVIDER_METADATA[model.providerId]?.label ?? model.providerId;
};

const extractModelName = (modelId: string): string => {
  const parts = modelId.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : modelId;
};

export function ModelSelector({
  models,
  selectedModelId,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onRefresh,
  isRefreshing,
}: ModelSelectorProps) {
  const [showFreeOnly, setShowFreeOnly] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedModel = useMemo(() => models.find((m) => m.id === selectedModelId) ?? null, [models, selectedModelId]);

  const grouped = useMemo(() => {
    const filtered = models.filter((model) => {
      if (showFreeOnly && !model.isFree) return false;
      return true;
    });

    const groups = new Map<string, ModelSummary[]>();

    for (const model of filtered) {
      const namespace = extractNamespace(model);
      if (!groups.has(namespace)) groups.set(namespace, []);
      groups.get(namespace)!.push(model);
    }

    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [models, showFreeOnly]);

  const totalCount = useMemo(() => grouped.reduce((sum, [, list]) => sum + list.length, 0), [grouped]);

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  const providerSlug = selectedModel?.providerId ?? null;

  return (
    <AIModelSelector open={open} onOpenChange={onOpenChange}>
      <ModelSelectorTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className="flex h-8 max-w-[260px] items-center gap-1.5 border border-transparent px-2.5 text-[12px] font-normal text-white/72 transition hover:border-white/6 hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          {providerSlug && <ModelSelectorLogo provider={providerSlug} />}
          <ModelSelectorName className="truncate text-current">
            {selectedModel ? extractModelName(selectedModel.id) : 'Model'}
          </ModelSelectorName>
          <ChevronDown className={`h-3 w-3 text-text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </ModelSelectorTrigger>

      <ModelSelectorContent
        title="Model Selector"
        className="max-w-sm overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-elevated"
      >
        <ModelSelectorInput 
          placeholder="Search models..." 
          className="border-b border-border-subtle px-4 py-3 text-sm"
        />

        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <button
            type="button"
            onClick={() => setShowFreeOnly((prev) => !prev)}
            className={`px-2 py-0.5 text-[10px] font-normal transition ${
              showFreeOnly ? 'border-white/20 bg-white/[0.05] text-white/50' : 'bg-bg-hover text-text-muted hover:text-text-tertiary'
            }`}
          >
            Free
          </button>
          <span className="ml-auto text-[10px] text-text-faint">
            {totalCount} model{totalCount === 1 ? '' : 's'}
          </span>
        </div>

        <ModelSelectorList className="max-h-72">
          <ModelSelectorEmpty className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <p className="text-sm text-text-muted">No models found</p>
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="mt-3 rounded-md bg-bg-hover px-3 py-1.5 text-xs text-text-secondary transition hover:bg-bg-active disabled:opacity-50"
              >
                {isRefreshing ? 'Loading...' : 'Refresh catalog'}
              </button>
            ) : null}
          </ModelSelectorEmpty>

          {grouped.map(([namespace, providerModels]) => (
            <ModelSelectorGroup key={namespace} heading={namespace}>
              {providerModels.map((model) => {
                const isSelected = model.id === selectedModelId;

                return (
                  <ModelSelectorItem key={model.id} value={model.id} onSelect={() => handleSelect(model.id)}>
                    <ModelSelectorLogo provider={model.providerId} />
                    <div className="min-w-0 flex-1">
                      <ModelSelectorName>{model.label}</ModelSelectorName>
                      <p className="truncate text-[10px] text-text-faint">{extractModelName(model.id)}</p>
                    </div>
                    {model.isFree ? (
                      <span className="shrink-0 border border-white/20 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-normal uppercase tracking-wider text-white/50">
                        Free
                      </span>
                    ) : null}
                    {isSelected ? <Check className="ml-auto h-4 w-4 text-white/50" /> : <div className="ml-auto h-4 w-4" />}
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </AIModelSelector>
  );
}
