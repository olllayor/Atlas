import { Check, ChevronDown, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

import type { CustomProvider, ModelSummary, ProviderCredentialSummary } from '../../shared/contracts';
import { resolveProviderLabel } from '../../shared/providerMetadata';
import type { ProviderRef } from './modelSelectorViewModel';
import { buildModelSelectorViewModel, modelNeedsApiKey } from './modelSelectorViewModel';

type ModelSelectorProps = {
  models: ModelSummary[];
  selectedModelId: string | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (modelId: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Needed to label models that belong to a user-configured endpoint. */
  customProviders?: ProviderRef[];
  /** Drives the "no key" marker so a model that cannot send is obvious up front. */
  credentials?: ProviderCredentialSummary[];
  /** Seeds the free-only toggle from the user's saved preference. */
  defaultFreeOnly?: boolean;
  onManageProviders?: () => void;
};

/**
 * Provider ids are opaque slugs, which would render as meaningless initials.
 * Using the provider's name instead also lets a provider the user called
 * "NVIDIA" pick up the matching logo.
 */
const logoProviderFor = (model: ModelSummary, customProviders: ProviderRef[]): string =>
  resolveProviderLabel(model.providerId, customProviders);

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
  customProviders,
  credentials,
  defaultFreeOnly = true,
  onManageProviders,
}: ModelSelectorProps) {
  const [showFreeOnly, setShowFreeOnly] = useState(defaultFreeOnly);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Follow the saved preference when it changes, but leave a mid-session
  // override alone until the picker is reopened.
  useEffect(() => {
    if (!open) {
      setShowFreeOnly(defaultFreeOnly);
    }
  }, [defaultFreeOnly, open]);

  const providerRefs = customProviders ?? [];
  const selectedModel = useMemo(() => models.find((m) => m.id === selectedModelId) ?? null, [models, selectedModelId]);

  const { groups, totalCount, hasFreeModels } = useMemo(
    () => buildModelSelectorViewModel({ models, customProviders: providerRefs, credentials, showFreeOnly }),
    [credentials, models, providerRefs, showFreeOnly]
  );

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  const providerSlug = selectedModel ? logoProviderFor(selectedModel, providerRefs) : null;
  const selectedProviderLabel = selectedModel ? resolveProviderLabel(selectedModel.providerId, providerRefs) : null;

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
          aria-label={
            selectedModel
              ? `Model: ${extractModelName(selectedModel.id)} from ${selectedProviderLabel}. Click to change model.`
              : 'Choose a model'
          }
        >
          {providerSlug ? <ModelSelectorLogo provider={providerSlug} /> : null}
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
          placeholder="Search models or providers…"
          className="border-b border-border-subtle px-4 py-3 text-sm"
        />

        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          {hasFreeModels ? (
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
          ) : null}
          <span className="ml-auto text-[10px] text-text-faint">
            {totalCount} model{totalCount === 1 ? '' : 's'}
          </span>
        </div>

        <ModelSelectorList className="max-h-72">
          <ModelSelectorEmpty className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <p className="text-sm text-text-muted">No models found</p>
            <div className="mt-3 flex items-center gap-2">
              {onRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="rounded-md bg-bg-hover px-3 py-1.5 text-xs text-text-secondary transition hover:bg-bg-active disabled:opacity-50"
                >
                  {isRefreshing ? 'Loading…' : 'Refresh catalog'}
                </button>
              ) : null}
              {onManageProviders ? (
                <button
                  type="button"
                  onClick={onManageProviders}
                  className="rounded-md bg-bg-hover px-3 py-1.5 text-xs text-text-secondary transition hover:bg-bg-active"
                >
                  Add a provider
                </button>
              ) : null}
            </div>
          </ModelSelectorEmpty>

          {groups.map((group) => (
            <ModelSelectorGroup key={group.label} heading={group.label}>
              {group.models.map((model) => {
                const isSelected = model.id === selectedModelId;
                const ctxLabel = formatContextWindow(model.contextWindow);
                const shortName = extractModelName(model.id);
                const needsKey = modelNeedsApiKey(model, credentials);

                return (
                  <ModelSelectorItem
                    key={model.id}
                    value={model.id}
                    // cmdk matches on `value` alone, so a search for the display
                    // name or the provider would otherwise find nothing.
                    keywords={[model.label, group.label, shortName]}
                    onSelect={() => handleSelect(model.id)}
                  >
                    <ModelSelectorLogo provider={logoProviderFor(model, providerRefs)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <ModelSelectorName>{model.label}</ModelSelectorName>
                        {model.supportsTools ? <CapabilityTag label="Tools" hint="Supports tool calling" /> : null}
                        {model.supportsVision ? <CapabilityTag label="Vision" hint="Supports vision input" /> : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-text-faint">
                        {/* Custom models use their id as the label; repeating it here is noise. */}
                        {shortName !== model.label ? <span className="truncate">{shortName}</span> : null}
                        {shortName !== model.label && ctxLabel ? (
                          <span aria-hidden="true" className="text-[var(--border-default)]">·</span>
                        ) : null}
                        {ctxLabel ? <span className="shrink-0">{ctxLabel}</span> : null}
                      </div>
                    </div>
                    {needsKey ? (
                      <span
                        title="No API key saved for this provider"
                        className="shrink-0 border border-[var(--border-default)] px-1.5 py-0.5 text-[9px] font-normal uppercase tracking-wider text-[var(--text-faint)]"
                      >
                        No key
                      </span>
                    ) : null}
                    {model.isFree ? (
                      <span className="shrink-0 border border-[var(--border-strong)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] font-normal uppercase tracking-wider text-[var(--text-tertiary)]">
                        Free
                      </span>
                    ) : null}
                    {isSelected ? (
                      <Check className="ml-1 h-4 w-4 text-[var(--text-tertiary)]" />
                    ) : (
                      <div className="ml-1 h-4 w-4" />
                    )}
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>

        {onManageProviders && totalCount > 0 ? (
          <div className="border-t border-border-subtle px-3 py-2">
            <button
              type="button"
              onClick={onManageProviders}
              className="flex w-full items-center gap-1.5 text-[11px] text-text-muted transition hover:text-text-secondary"
            >
              <Settings2 className="h-3 w-3" />
              Manage providers
            </button>
          </div>
        ) : null}
      </ModelSelectorContent>
    </AIModelSelector>
  );
}

function CapabilityTag({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      aria-label={hint}
      title={hint}
      className="shrink-0 border border-[var(--border-default)] px-1 text-[9px] font-normal uppercase leading-[14px] tracking-wider text-[var(--text-faint)]"
    >
      {label}
    </span>
  );
}
