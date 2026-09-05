// Aliased: bare `Image` would shadow the DOM constructor in this module.
import { Check, Image as ImageIcon } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { ReasoningEffort } from '../../shared/chatParameters';
import { REASONING_EFFORTS, clampReasoningEffort, resolveReasoningEffortMenu } from '../../shared/chatParameters';
import type { ModelSummary, ProviderCredentialSummary } from '../../shared/contracts';
import { resolveProviderLabel } from '../../shared/providerMetadata';
import type { ProviderRef } from './modelSelectorViewModel';
import { buildModelSelectorViewModel, isSelfManagedProvider } from './modelSelectorViewModel';

type ModelSelectorProps = {
  models: ModelSummary[];
  selectedModelId: string | null;
  selectedProviderId?: string | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (modelId: string, providerId: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Needed to label models that belong to a user-configured endpoint. */
  customProviders?: ProviderRef[];
  /** Drives the "no key" marker so a model that cannot send is obvious up front. */
  credentials?: ProviderCredentialSummary[];
  /** Unused since the cascade shows every provider; kept so callers need not change. */
  defaultFreeOnly?: boolean;
  onManageProviders?: () => void;
  /**
   * Reasoning effort lives inside this menu rather than as a separate word in
   * the control row: it is a property of the chosen model, and rendering it
   * conditionally beside the chip made the whole row reflow on model switch.
   */
  reasoningEffort?: ReasoningEffort;
  reasoningSupported?: boolean;
  onReasoningEffortChange?: (value: ReasoningEffort) => void;
};

const extractModelName = (modelId: string): string => {
  const parts = modelId.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : modelId;
};

/**
 * The chip names the model the way a person would, not the way the gateway
 * does. The catalog's `label` is the human name ("DeepSeek V4 Flash"); a raw
 * id segment ("DeepSeek-V4-Flash-01:free") is what filled the chip before,
 * and its length is why the name truncated mid-word. The gateway suffix only
 * ever marked pricing, which the menu's Free badge already says.
 */
const compactChipLabel = (model: ModelSummary): string => {
  if (model.label && model.label !== model.id) {
    return model.label;
  }
  return extractModelName(model.id).replace(/[:@](free|beta|preview|latest)$/i, '');
};

function isSameModel(a: Pick<ModelSummary, 'id' | 'providerId'>, b: Pick<ModelSummary, 'id' | 'providerId'>) {
  return a.id === b.id && a.providerId === b.providerId;
}

export function ModelSelector({
  models,
  selectedModelId,
  selectedProviderId,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onRefresh,
  isRefreshing,
  customProviders,
  credentials,
  onManageProviders,
  reasoningEffort,
  reasoningSupported = false,
  onReasoningEffortChange,
}: ModelSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  const providerRefs = customProviders ?? [];
  const selectedModel = useMemo(() => {
    if (!selectedModelId) return null;
    if (selectedProviderId) {
      const exact = models.find((m) => !m.archived && m.id === selectedModelId && m.providerId === selectedProviderId);
      if (exact) return exact;
    }
    const cands = models.filter((m) => m.id === selectedModelId);
    if (cands.length === 0) return null;
    const active = cands.filter((m) => !m.archived);
    const pool = active.length > 0 ? active : cands;
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) if (pool[i].providerId < best.providerId) best = pool[i];
    return best;
  }, [models, selectedModelId, selectedProviderId]);

  const { groups } = useMemo(
    () => buildModelSelectorViewModel({ models, customProviders: providerRefs, credentials, showFreeOnly: false }),
    [credentials, models, providerRefs]
  );

  const handleSelect = useCallback(
    (modelId: string, providerId: string) => {
      onSelect(modelId, providerId);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  // The menu offers only what the selected model accepts: its catalog levels,
  // the default ladder when the catalog is silent, or nothing for a model
  // whose reasoning has no control at all.
  const effortMenu = useMemo(
    () => resolveReasoningEffortMenu(reasoningSupported, selectedModel?.reasoningEfforts),
    [reasoningSupported, selectedModel]
  );
  // A stored effort the model does not take displays as the level it will
  // actually be sent as.
  const effectiveEffort =
    reasoningEffort && effortMenu.length > 0 ? clampReasoningEffort(reasoningEffort, effortMenu) : undefined;

  const selectedProviderLabel = selectedModel ? resolveProviderLabel(selectedModel.providerId, providerRefs) : null;
  // Which OpenCode answered matters once one is also configured as a plain
  // base-URL provider, and the chip shows no provider name at all.
  const selectedIsAgent = selectedModel ? isSelfManagedProvider(selectedModel.providerId) : false;
  // Model name only. The provider used to be prefixed here, which spent most of
  // a 240px chip on a word that is the same for every model in the list you
  // just picked from — and truncated the name that actually identifies it. It
  // still names the endpoint in the tooltip, in the menu's group headings, and
  // in the accessible name.
  const chipLabel = selectedModel ? compactChipLabel(selectedModel) : 'Choose model';
  const effortLabel = effectiveEffort
    ? REASONING_EFFORTS.find((entry) => entry.value === effectiveEffort)?.label
    : null;
  const selectedProviderCount = useMemo(() => {
    if (!selectedModel) return 0;
    return new Set(
      models.filter((m) => !m.archived && m.id === selectedModel.id).map((m) => m.providerId)
    ).size;
  }, [models, selectedModel]);
  const showProviderInChip = selectedProviderCount > 1;
  const chipDisplayLabel = showProviderInChip && selectedModel ? `${chipLabel} · ${selectedProviderLabel}` : chipLabel;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              disabled={disabled}
              // Bare label, not a filled pill: in the reference the model is
              // the quietest thing in the control row — a tinted chip plus a
              // chevron made the least-changed setting the loudest. Hover and
              // the open state still light the hit area.
              className="group flex h-8 min-w-0 max-w-[240px] items-center gap-2 rounded-full px-2.5 text-sm font-normal transition hover:bg-bg-hover data-[state=open]:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={
                selectedModel
                  ? `Model: ${selectedModel.label} from ${selectedProviderLabel}${selectedIsAgent ? ', run by the agent' : ''}${
                      effortLabel ? `, reasoning effort ${effortLabel}` : ''
                    }. Click to change model.`
                  : 'Choose a model'
              }
            >
              <span
                className={`min-w-0 truncate transition-colors ${
                  selectedModel
                    ? 'text-text-tertiary group-hover:text-text-primary group-data-[state=open]:text-text-primary'
                    : 'text-text-tertiary'
                }`}
              >
                {chipDisplayLabel}
              </span>
              {/*
                A subtle, compact pill distinguishes reasoning effort from the
                model name so it is immediately readable at a glance.
              */}
              {effortLabel ? (
                <span className="shrink-0 rounded-full border border-border-subtle bg-bg-subtle px-1.5 py-0.5 text-2xs font-medium text-text-secondary leading-none">
                  {effortLabel}
                </span>
              ) : null}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {selectedModel ? (
          // The provider is only ever ambiguous when two endpoints serve the
          // same model name, so it moves here rather than costing chip width on
          // every render. The full id comes along because the chip shows the
          // name with any vendor segment stripped.
          <TooltipContent side="top" className="max-w-[280px]">
            {selectedProviderLabel}
            {selectedIsAgent ? ' (agent)' : ''} · {selectedModel.id}
            {effortLabel ? ` · ${effortLabel} reasoning` : ''}
          </TooltipContent>
        ) : null}
      </Tooltip>

      <DropdownMenuContent align="start" side="top" className="min-w-[220px] border-border-default bg-bg-overlay p-1.5">
        {groups.length === 0 ? (
          <>
            <DropdownMenuItem disabled className="px-3 py-2 text-sm text-text-muted">
              No models available
            </DropdownMenuItem>
            {onRefresh ? (
              <DropdownMenuItem
                disabled={isRefreshing}
                onSelect={(event) => {
                  event.preventDefault();
                  onRefresh();
                }}
                className="px-3 py-2 text-sm"
              >
                {isRefreshing ? 'Loading…' : 'Refresh catalog'}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : (
          groups.map((group) => {
            const isActiveProvider = selectedModel != null && group.models.some((m) => isSameModel(m, selectedModel));

            return (
              <DropdownMenuSub key={group.providerId}>
                <DropdownMenuSubTrigger
                  className={cn(
                    'gap-2 rounded-md px-3 py-2 text-sm text-text-primary',
                    isActiveProvider && 'bg-bg-subtle font-medium text-text-primary'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  {/*
                    The same OpenCode can be reached two ways: as this
                    integration, or as a base-URL provider someone added by
                    hand. They can even carry the same name, so the one that
                    runs the turn itself says so.
                  */}
                  {(group.selfManaged || !group.configured) && (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {group.selfManaged ? (
                        <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 text-3xs font-normal text-text-tertiary">
                          Agent
                        </span>
                      ) : null}
                      {group.configured ? null : (
                        <span className="rounded-sm bg-warning-bg px-1 py-px text-3xs font-normal leading-4 text-warning-text">
                          No key
                        </span>
                      )}
                    </span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className="max-h-[min(420px,60vh)] min-w-[220px] max-w-[300px] overflow-y-auto border-border-default bg-bg-overlay p-1.5"
                  sideOffset={6}
                >
                  {group.models.map((model) => {
                    const isSelected = selectedModel != null && isSameModel(model, selectedModel);
                    const shortName = extractModelName(model.id);

                    return (
                      <DropdownMenuItem
                        key={`${model.providerId}:${model.id}`}
                        onSelect={() => handleSelect(model.id, model.providerId)}
                        className="gap-2 rounded-md px-3 py-2 text-sm text-text-primary"
                      >
                        <span className="min-w-0 flex-1 truncate" title={model.id}>
                          {shortName}
                        </span>
                        {/*
                          Only a confirmed yes earns the mark. Unknown stays
                          blank rather than showing a third glyph nobody can
                          read at a glance — an image sent to it is allowed to
                          be attempted, and the answer arrives from the
                          provider, not from this list.
                        */}
                        {model.supportsVision === true ? (
                          <ImageIcon
                            aria-label="Reads images"
                            className="size-3.5 shrink-0 text-text-tertiary"
                            strokeWidth={1.75}
                          />
                        ) : null}
                        {model.isFree ? (
                          <span className="shrink-0 rounded-sm bg-bg-subtle px-1.5 py-0.5 text-3xs font-normal text-text-tertiary">
                            Free
                          </span>
                        ) : null}
                        {isSelected ? <Check className="size-4 shrink-0 text-text-secondary" /> : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })
        )}

        {effortMenu.length > 0 && effectiveEffort && onReasoningEffortChange ? (
          <>
            <DropdownMenuSeparator className="my-1.5 bg-border-subtle" />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2 rounded-md px-3 py-2 text-sm text-text-primary">
                <span className="min-w-0 flex-1 truncate">Reasoning effort</span>
                <span className="shrink-0 rounded-full border border-border-subtle bg-bg-subtle px-1.5 py-0.5 text-2xs font-medium text-text-secondary leading-none">
                  {REASONING_EFFORTS.find((entry) => entry.value === effectiveEffort)?.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className="min-w-[160px] border-border-default bg-bg-overlay p-1.5"
                sideOffset={6}
              >
                <DropdownMenuRadioGroup
                  value={effectiveEffort}
                  onValueChange={(value) => onReasoningEffortChange(value as ReasoningEffort)}
                >
                  {effortMenu.map((value) => {
                    const entry = REASONING_EFFORTS.find((item) => item.value === value);
                    if (!entry) {
                      return null;
                    }

                    return (
                      <DropdownMenuRadioItem
                        key={entry.value}
                        value={entry.value}
                        title={entry.hint}
                        className="rounded-md py-2 text-sm text-text-primary"
                      >
                        {entry.label}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}

        {onManageProviders ? (
          <>
            <DropdownMenuSeparator className="my-1.5 bg-border-subtle" />
            <DropdownMenuItem
              onSelect={() => onManageProviders()}
              className="rounded-md px-3 py-2 text-sm text-text-primary"
            >
              Manage models
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
