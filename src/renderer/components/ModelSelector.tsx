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

const formatContextWindow = (tokens: number | null | undefined): string | null => {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k ctx`;
  }
  return `${tokens} ctx`;
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
          className={`flex h-8 max-w-[260px] items-center gap-1.5 border px-2.5 text-[12px] font-normal transition disabled:cursor-not-allowed disabled:opacity-50 ${
            selectedModel
              ? 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-ghost)] hover:text-white'
              : 'border-dashed border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-text-secondary'
          }`}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={selectedModel ? `Model: ${extractModelName(selectedModel.id)}. Click to change model.` : 'Choose a model'}
        >
          {providerSlug && <ModelSelectorLogo provider={providerSlug} />}
          <ModelSelectorName className="truncate text-current">
            {selectedModel ? extractModelName(selectedModel.id) : 'Choose model'}
          </ModelSelectorName>
          <ChevronDown className={`h-3 w-3 text-text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </ModelSelectorTrigger>

      <ModelSelectorContent
        title="Model Selector"
        className="max-w-sm overflow-hidden rounded-xl border border-border-medium bg-bg-overlay shadow-elevated"
      >
        <ModelSelectorInput 
          placeholder="Search models…" 
          className="border-b border-border-subtle px-4 py-3 text-sm"
        />

        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <div
            role="radiogroup"
            aria-label="Filter by price"
            className="inline-flex border border-border-default bg-bg-subtle p-0.5"
          >
            {([
              { id: 'free', label: 'Free only', value: true },
              { id: 'all', label: 'All', value: false },
            ] as const).map((option) => {
              const isActive = showFreeOnly === option.value;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setShowFreeOnly(option.value)}
                  className={`h-6 px-2 text-[10px] font-normal uppercase tracking-wider transition ${
                    isActive
                      ? 'bg-bg-overlay text-text-primary'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
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
                {isRefreshing ? 'Loading…' : 'Refresh catalog'}
              </button>
            ) : null}
          </ModelSelectorEmpty>

          {grouped.map(([namespace, providerModels], index) => (
            <ModelSelectorGroup
              key={namespace}
              heading={grouped.length > 1 ? namespace : undefined}
              className={index === 0 ? '[&_[cmdk-group-heading]]:sr-only' : undefined}
            >
              {providerModels.map((model) => {
                const isSelected = model.id === selectedModelId;
                const ctxLabel = formatContextWindow(model.contextWindow);

                return (
                  <ModelSelectorItem key={model.id} value={model.id} onSelect={() => handleSelect(model.id)}>
                    <ModelSelectorLogo provider={model.providerId} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <ModelSelectorName>{model.label}</ModelSelectorName>
                        {model.supportsTools ? (
                          <span
                            aria-label="Supports tool calling"
                            title="Supports tool calling"
                            className="shrink-0 border border-[var(--border-default)] px-1 text-[9px] font-normal uppercase leading-[14px] tracking-wider text-[var(--text-faint)]"
                          >
                            Tools
                          </span>
                        ) : null}
                        {model.supportsVision ? (
                          <span
                            aria-label="Supports vision input"
                            title="Supports vision input"
                            className="shrink-0 border border-[var(--border-default)] px-1 text-[9px] font-normal uppercase leading-[14px] tracking-wider text-[var(--text-faint)]"
                          >
                            Vision
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-text-faint">
                        <span className="truncate">{extractModelName(model.id)}</span>
                        {ctxLabel ? (
                          <>
                            <span aria-hidden="true" className="text-[var(--border-default)]">·</span>
                            <span className="shrink-0">{ctxLabel}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {model.isFree ? (
                      <span className="shrink-0 border border-[var(--border-strong)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] font-normal uppercase tracking-wider text-[var(--text-tertiary)]">
                        Free
                      </span>
                    ) : null}
                    {isSelected ? <Check className="ml-1 h-4 w-4 text-[var(--text-tertiary)]" /> : <div className="ml-1 h-4 w-4" />}
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
