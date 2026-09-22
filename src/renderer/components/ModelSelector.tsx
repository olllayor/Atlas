// Aliased: bare `Image` would shadow the DOM constructor in this module.
import { Check, Image as ImageIcon, Layers } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { ProviderLogo } from '../lib/providerLogos';
import type { ProviderRef } from './modelSelectorViewModel';
import {
  buildModelSelectorViewModel,
  isSelfManagedProvider,
  modelShortName,
} from './modelSelectorViewModel';

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

function isSameModel(a: Pick<ModelSummary, 'id' | 'providerId'>, b: Pick<ModelSummary, 'id' | 'providerId'>) {
  return a.id === b.id && a.providerId === b.providerId;
}

const MENU_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Radix roving focus only moves when the keydown target is the menu item
 * itself, so a child field has to hand navigation keys back to its item.
 */
function focusSiblingMenuItem(fromItem: HTMLElement, key: string) {
  const content = fromItem.closest('[data-radix-menu-content]');
  if (!content) return;
  const items = Array.from(
    content.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([data-disabled]), [role="menuitemcheckbox"]:not([data-disabled]), [role="menuitemradio"]:not([data-disabled])'
    )
  );
  const index = items.indexOf(fromItem);
  if (index < 0) return;

  let nextIndex: number | null = null;
  if (key === 'ArrowDown') nextIndex = index + 1 < items.length ? index + 1 : null;
  else if (key === 'ArrowUp') nextIndex = index - 1 >= 0 ? index - 1 : null;
  else if (key === 'Home') nextIndex = items.length > 0 ? 0 : null;
  else if (key === 'End') nextIndex = items.length > 0 ? items.length - 1 : null;

  if (nextIndex == null) return;
  items[nextIndex]?.focus();
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
  const searchItemRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  const { strip, rows } = useMemo(
    () =>
      buildModelSelectorViewModel({
        models,
        customProviders: providerRefs,
        credentials,
        showFreeOnly: false,
        providerFilter,
        searchQuery
      }),
    [credentials, models, providerRefs, providerFilter, searchQuery]
  );

  // Filters are ephemeral chrome for the open menu, not a remembered mode.
  // A parent can flip `open` to false without going through handleOpenChange
  // (Composer / App call setModelPickerOpen directly), so the controlled prop
  // is the reliable reset signal.
  useEffect(() => {
    if (open) return;
    setProviderFilter(null);
    setSearchQuery('');
  }, [open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setProviderFilter(null);
        setSearchQuery('');
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const handleSelect = useCallback(
    (modelId: string, providerId: string) => {
      onSelect(modelId, providerId);
      handleOpenChange(false);
    },
    [onSelect, handleOpenChange]
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
  // just picked from, and truncated the name that actually identifies it. It
  // still names the endpoint in the tooltip and in the accessible name.
  const chipLabel = selectedModel ? modelShortName(selectedModel) : 'Choose model';
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
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              disabled={disabled}
              // Bare label, not a filled pill: in the reference the model is
              // the quietest thing in the control row. Hover and the open state
              // still light the hit area.
              className="group flex h-8 min-w-0 max-w-[240px] items-center gap-2 rounded-full px-2.5 text-sm font-normal transition hover:bg-bg-hover data-[state=open]:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={
                selectedModel
                  ? `Model: ${selectedModel.label} from ${selectedProviderLabel}${selectedIsAgent ? ', run by the agent' : ''}${
                      effortLabel ? `, reasoning effort ${effortLabel}` : ''
                    }. Click to change model.`
                  : 'Choose a model'
              }
            >
              {selectedModel ? (
                <ProviderLogo
                  providerId={selectedModel.providerId}
                  label={selectedProviderLabel ?? selectedModel.providerId}
                  className="h-3.5 w-3.5"
                />
              ) : null}
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

      <DropdownMenuContent
        align="start"
        side="top"
        className="min-w-[320px] max-w-[380px] border-border-default bg-bg-overlay p-1.5"
      >
        {strip.length === 0 ? (
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
          <>
            {/*
              Provider filter and search are still menu items so arrow-key
              roving can reach them. Each filter keeps the menu open on select.
            */}
            <div
              className="flex items-center gap-1 overflow-x-auto px-0.5 pb-1.5"
              onMouseDown={(event) => event.preventDefault()}
            >
              <DropdownMenuItem
                title="All providers"
                textValue="All providers"
                aria-label="All providers"
                aria-pressed={providerFilter == null}
                onSelect={(event) => {
                  event.preventDefault();
                  setProviderFilter(null);
                }}
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md px-0 py-0 transition',
                  providerFilter == null
                    ? 'bg-bg-subtle text-text-primary ring-1 ring-border-default'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
                )}
              >
                <Layers className="size-3.5" strokeWidth={1.75} />
              </DropdownMenuItem>
              {strip.map((item) => {
                const isSelected = providerFilter === item.providerId;
                return (
                  <DropdownMenuItem
                    key={item.providerId}
                    title={item.label}
                    textValue={item.label}
                    aria-label={item.label}
                    aria-pressed={isSelected}
                    onSelect={(event) => {
                      event.preventDefault();
                      setProviderFilter(item.providerId);
                    }}
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md px-0 py-0 transition',
                      isSelected
                        ? 'bg-bg-subtle ring-1 ring-border-default'
                        : 'opacity-55 hover:bg-bg-hover hover:opacity-100'
                    )}
                  >
                    <ProviderLogo
                      providerId={item.providerId}
                      label={item.label}
                      className="h-3.5 w-3.5"
                    />
                  </DropdownMenuItem>
                );
              })}
            </div>

            <div className="px-0.5 pb-1.5" onMouseDown={(event) => event.preventDefault()}>
              <DropdownMenuItem
                ref={searchItemRef}
                textValue="Search models"
                onSelect={(event) => event.preventDefault()}
                className="p-1 focus:bg-transparent"
                // Roving focus lands on the item; typing needs the field.
                onFocus={(event) => {
                  if (event.target === event.currentTarget) {
                    searchInputRef.current?.focus();
                  }
                }}
              >
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.focus();
                  }}
                  onKeyDown={(event) => {
                    // Radix typeahead is exactly character keys. Stop those so
                    // letters and Space stay in the field. Escape is left alone
                    // (Radix closes on a document capture listener).
                    if (event.key.length === 1) {
                      event.stopPropagation();
                      return;
                    }
                    if (MENU_NAV_KEYS.has(event.key) && searchItemRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      focusSiblingMenuItem(searchItemRef.current, event.key);
                    }
                  }}
                  placeholder="Search models"
                  aria-label="Search models"
                  className="h-7 w-full rounded-md border border-border-subtle bg-bg-subtle px-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-border-default"
                />
              </DropdownMenuItem>
            </div>

            <div className="max-h-[320px] overflow-y-auto">
              {rows.length === 0 ? (
                <div className="px-3 py-2 text-sm text-text-muted">No matching models</div>
              ) : (
                rows.map((row) => {
                  const isSelected = selectedModel != null && isSameModel(row.model, selectedModel);

                  return (
                    <DropdownMenuItem
                      key={`${row.providerId}:${row.model.id}`}
                      onSelect={() => handleSelect(row.model.id, row.providerId)}
                      className="gap-2 rounded-md px-3 py-1.5 text-sm text-text-primary"
                    >
                      <span className="min-w-0 flex-1 truncate" title={row.model.id}>
                        {row.name}
                      </span>
                      {row.ambiguous ? (
                        <span className="shrink-0 text-3xs text-text-tertiary">{row.providerLabel}</span>
                      ) : null}
                      {row.selfManaged ? (
                        <span className="shrink-0 rounded-sm bg-bg-subtle px-1.5 py-0.5 text-3xs font-normal text-text-tertiary">
                          Agent
                        </span>
                      ) : null}
                      {row.configured ? null : (
                        <span className="shrink-0 rounded-sm bg-warning-bg px-1 py-px text-3xs font-normal leading-4 text-warning-text">
                          No key
                        </span>
                      )}
                      {/*
                        Only a confirmed yes earns the mark. Unknown stays
                        blank rather than showing a third glyph nobody can
                        read at a glance.
                      */}
                      {row.model.supportsVision === true ? (
                        <ImageIcon
                          aria-label="Reads images"
                          className="size-3.5 shrink-0 text-text-tertiary"
                          strokeWidth={1.75}
                        />
                      ) : null}
                      {row.model.isFree ? (
                        <span className="shrink-0 rounded-sm bg-bg-subtle px-1.5 py-0.5 text-3xs font-normal text-text-tertiary">
                          Free
                        </span>
                      ) : null}
                      {isSelected ? <Check className="size-4 shrink-0 text-text-secondary" /> : null}
                    </DropdownMenuItem>
                  );
                })
              )}
            </div>
          </>
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
