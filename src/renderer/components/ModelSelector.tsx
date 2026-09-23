// Aliased: bare `Image` would shadow the DOM constructor in this module.
import {
  Check,
  ChevronRight,
  Image as ImageIcon,
  Search,
  Settings2,
  Sparkles,
  X
} from 'lucide-react';
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
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { ReasoningEffort } from '../../shared/chatParameters';
import {
  REASONING_EFFORTS,
  clampReasoningEffort,
  resolveReasoningEffortMenu
} from '../../shared/chatParameters';
import type { ModelSummary, ProviderCredentialSummary } from '../../shared/contracts';
import { formatContextWindow } from '../../shared/customProviders';
import { resolveProviderLabel } from '../../shared/providerMetadata';
import { ModelLogo, ProviderLogo } from '../lib/providerLogos';
import type { ModelRow, ProviderRef } from './modelSelectorViewModel';
import {
  buildModelSelectorViewModel,
  isSelfManagedProvider,
  modelShortName
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
  /** Kept so callers need not change. */
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

function isSameModel(
  a: Pick<ModelSummary, 'id' | 'providerId'>,
  b: Pick<ModelSummary, 'id' | 'providerId'>
) {
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

function cleanDisplayName(name: string, isFree?: boolean): string {
  if (isFree) {
    return name.replace(/\s*[\(\[]?free[\)\]]?$/i, '').trim() || name;
  }
  return name;
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
  onReasoningEffortChange
}: ModelSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchItemRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');

  const providerRefs = customProviders ?? [];
  const selectedModel = useMemo(() => {
    if (!selectedModelId) return null;
    if (selectedProviderId) {
      const exact = models.find(
        (m) => !m.archived && m.id === selectedModelId && m.providerId === selectedProviderId
      );
      if (exact) return exact;
    }
    const cands = models.filter((m) => m.id === selectedModelId);
    if (cands.length === 0) return null;
    const active = cands.filter((m) => !m.archived);
    const pool = active.length > 0 ? active : cands;
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].providerId < best.providerId) best = pool[i];
    }
    return best;
  }, [models, selectedModelId, selectedProviderId]);

  const { rows, groups } = useMemo(
    () =>
      buildModelSelectorViewModel({
        models,
        customProviders: providerRefs,
        credentials,
        showFreeOnly: false,
        searchQuery
      }),
    [credentials, models, providerRefs, searchQuery]
  );

  // Search query resets whenever the menu closes.
  useEffect(() => {
    if (open) return;
    setSearchQuery('');
  }, [open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
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

  const effortMenu = useMemo(
    () => resolveReasoningEffortMenu(reasoningSupported, selectedModel?.reasoningEfforts),
    [reasoningSupported, selectedModel]
  );

  const effectiveEffort =
    reasoningEffort && effortMenu.length > 0
      ? clampReasoningEffort(reasoningEffort, effortMenu)
      : undefined;

  const selectedProviderLabel = selectedModel
    ? resolveProviderLabel(selectedModel.providerId, providerRefs)
    : null;
  const selectedIsAgent = selectedModel
    ? isSelfManagedProvider(selectedModel.providerId)
    : false;

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
  const chipDisplayLabel =
    showProviderInChip && selectedModel ? `${chipLabel} · ${selectedProviderLabel}` : chipLabel;

  const renderModelRow = useCallback(
    (row: ModelRow, showProviderSubtitle = false) => {
      const isSelected = selectedModel != null && isSameModel(row.model, selectedModel);
      const contextBadge = formatContextWindow(row.model.contextWindow);

      return (
        <DropdownMenuItem
          key={`${row.providerId}:${row.model.id}`}
          onSelect={() => handleSelect(row.model.id, row.providerId)}
          className={cn(
            'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition cursor-pointer',
            isSelected
              ? 'bg-accent/15 text-text-primary font-medium ring-1 ring-accent/30'
              : 'text-text-primary hover:bg-bg-hover focus:bg-bg-hover'
          )}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-bg-subtle/80 border border-border-subtle/80">
            <ModelLogo
              modelId={row.model.id}
              modelLabel={row.name}
              providerId={row.providerId}
              providerLabel={row.providerLabel}
              className="size-4.5"
            />
          </div>

          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <span
              className={cn(
                'truncate leading-tight text-xs',
                isSelected ? 'font-semibold text-text-primary' : 'font-normal text-text-primary'
              )}
              title={row.model.id}
            >
              {cleanDisplayName(row.name, row.model.isFree)}
            </span>
            {showProviderSubtitle || row.ambiguous ? (
              <span className="truncate text-3xs text-text-tertiary leading-tight mt-0.5">
                {row.providerLabel}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {contextBadge ? (
              <span
                title={`Context window: ${row.model.contextWindow?.toLocaleString()} tokens`}
                className="rounded bg-bg-subtle px-1.5 py-0.5 text-3xs font-mono text-text-tertiary"
              >
                {contextBadge}
              </span>
            ) : null}

            {row.model.supportsVision === true ? (
              <span title="Vision supported (reads image inputs)">
                <ImageIcon
                  aria-label="Reads images"
                  className="size-3.5 text-text-tertiary group-hover:text-text-secondary"
                  strokeWidth={1.75}
                />
              </span>
            ) : null}

            {row.model.isFree ? (
              <span className="rounded-full bg-success-bg border border-success-border px-1.5 py-0.5 text-3xs font-medium text-success leading-none">
                Free
              </span>
            ) : null}

            {!row.configured ? (
              <span className="rounded bg-warning-bg px-1 py-0.5 text-3xs font-medium text-warning-text leading-none">
                No key
              </span>
            ) : null}

            {isSelected ? (
              <Check className="size-3.5 shrink-0 text-accent font-bold" strokeWidth={2.5} />
            ) : (
              <div className="size-3.5 shrink-0" />
            )}
          </div>
        </DropdownMenuItem>
      );
    },
    [handleSelect, selectedModel]
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              disabled={disabled}
              className="group flex h-8 min-w-0 max-w-[260px] items-center gap-2 rounded-full px-2.5 text-sm font-normal transition hover:bg-bg-hover data-[state=open]:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={
                selectedModel
                  ? `Model: ${selectedModel.label} from ${selectedProviderLabel}${
                      selectedIsAgent ? ', run by the agent' : ''
                    }${effortLabel ? `, reasoning effort ${effortLabel}` : ''}. Click to change model.`
                  : 'Choose a model'
              }
            >
              {selectedModel ? (
                <ModelLogo
                  modelId={selectedModel.id}
                  modelLabel={selectedModel.label}
                  providerId={selectedModel.providerId}
                  providerLabel={selectedProviderLabel ?? selectedModel.providerId}
                  className="size-4 shrink-0"
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
              {effortLabel ? (
                <span className="shrink-0 rounded-full border border-border-subtle bg-bg-subtle px-1.5 py-0.5 text-2xs font-medium text-text-secondary leading-none">
                  {effortLabel}
                </span>
              ) : null}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {selectedModel ? (
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
        sideOffset={6}
        className="w-[330px] max-w-[calc(100vw-32px)] border border-border-default bg-bg-overlay/95 backdrop-blur-xl p-1.5 shadow-2xl rounded-xl flex flex-col gap-1"
      >
        {groups.length === 0 && !searchQuery ? (
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
                className="px-3 py-2 text-sm cursor-pointer"
              >
                {isRefreshing ? 'Loading…' : 'Refresh catalog'}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : (
          <>
            {/* Search Input Field */}
            <div
              className="px-0.5 pt-0.5"
              onMouseDown={(event) => event.preventDefault()}
            >
              <DropdownMenuItem
                ref={searchItemRef}
                textValue="Search models"
                onSelect={(event) => event.preventDefault()}
                className="p-0 focus:bg-transparent"
                onFocus={(event) => {
                  if (event.target === event.currentTarget) {
                    searchInputRef.current?.focus();
                  }
                }}
              >
                <div className="relative flex w-full items-center">
                  <Search className="pointer-events-none absolute left-2.5 size-3.5 text-text-muted" />
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
                    placeholder="Search all models…"
                    aria-label="Search models"
                    className="h-8 w-full rounded-lg border border-border-subtle bg-bg-subtle pl-8 pr-8 text-xs text-text-primary placeholder:text-text-muted transition focus:border-border-default focus:bg-bg-elevated focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="absolute right-2.5 flex size-4 items-center justify-center rounded text-text-muted hover:text-text-primary transition"
                      aria-label="Clear search"
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </div>
              </DropdownMenuItem>
            </div>

            {/* Menu Body: Search Results OR Native macOS Provider Cascade */}
            {searchQuery ? (
              // Search Mode: Flat results across all providers
              <div className="max-h-[320px] overflow-y-auto px-0.5 py-0.5 space-y-0.5">
                {rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-text-muted">
                    <Search className="size-5 text-text-faint mb-1.5" />
                    <p className="text-xs font-medium text-text-secondary">No matching models</p>
                    <p className="text-3xs text-text-muted mt-0.5">
                      No results for &ldquo;{searchQuery}&rdquo;
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="mt-2.5 rounded-md bg-bg-subtle px-2 py-1 text-2xs font-medium text-text-primary hover:bg-bg-hover transition cursor-pointer"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  rows.map((row) => renderModelRow(row, true))
                )}
              </div>
            ) : (
              // Default Cascade Mode: List of Providers with submenus
              <div className="px-0.5 py-0.5 space-y-0.5">
                {groups.map((group) => {
                  const hasActiveModel =
                    selectedModel != null &&
                    group.rows.some((r) => isSameModel(r.model, selectedModel));

                  return (
                    <DropdownMenuSub key={group.providerId}>
                      <DropdownMenuSubTrigger
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-2.5 py-2 text-xs transition cursor-pointer',
                          hasActiveModel
                            ? 'bg-accent/10 text-text-primary font-medium'
                            : 'text-text-primary hover:bg-bg-hover focus:bg-bg-hover'
                        )}
                      >
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-bg-subtle/80 border border-border-subtle/80 shadow-2xs">
                          <ProviderLogo
                            providerId={group.providerId}
                            label={group.providerLabel}
                            className="size-5"
                          />
                        </div>
                        <span className="min-w-0 flex-1 truncate font-medium text-xs">
                          {group.providerLabel}
                        </span>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {group.selfManaged ? (
                            <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-3xs font-medium text-text-muted leading-none">
                              Agent
                            </span>
                          ) : null}

                          {!group.configured ? (
                            <span className="rounded bg-warning-bg px-1.5 py-0.5 text-3xs font-medium text-warning-text leading-none">
                              No key
                            </span>
                          ) : null}

                          <span className="text-3xs text-text-muted font-normal">
                            {group.rows.length}
                          </span>

                          <ChevronRight className="size-3.5 text-text-tertiary" strokeWidth={1.75} />
                        </div>
                      </DropdownMenuSubTrigger>

                      <DropdownMenuSubContent
                        className="w-[300px] max-h-[min(380px,70vh)] overflow-y-auto border-border-default bg-bg-overlay/95 backdrop-blur-xl p-1.5 rounded-xl shadow-2xl"
                        sideOffset={6}
                      >
                        {/* Submenu Provider Header */}
                        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-subtle/50 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-bg-subtle/80 border border-border-subtle/80">
                              <ProviderLogo
                                providerId={group.providerId}
                                label={group.providerLabel}
                                className="size-4"
                              />
                            </div>
                            <span className="text-xs font-semibold text-text-primary truncate">
                              {group.providerLabel}
                            </span>
                          </div>
                          <span className="text-3xs text-text-muted">
                            {group.rows.length} {group.rows.length === 1 ? 'model' : 'models'}
                          </span>
                        </div>

                        {/* Model Items for this Provider */}
                        <div className="space-y-0.5">
                          {group.rows.map((row) => renderModelRow(row, false))}
                        </div>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                })}
              </div>
            )}
          </>
        )}

        {effortMenu.length > 0 && effectiveEffort && onReasoningEffortChange ? (
          <>
            <DropdownMenuSeparator className="my-0.5 bg-border-subtle" />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-primary hover:bg-bg-hover focus:bg-bg-hover cursor-pointer">
                <Sparkles className="size-3.5 text-text-tertiary" />
                <span className="min-w-0 flex-1 truncate">Reasoning effort</span>
                <span className="shrink-0 rounded-full border border-border-subtle bg-bg-subtle px-1.5 py-0.5 text-2xs font-medium text-text-secondary leading-none">
                  {REASONING_EFFORTS.find((entry) => entry.value === effectiveEffort)?.label}
                </span>
                <ChevronRight className="size-3.5 text-text-tertiary ml-auto" strokeWidth={1.75} />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className="min-w-[160px] border-border-default bg-bg-overlay/95 backdrop-blur-xl p-1.5 rounded-xl shadow-xl"
                sideOffset={6}
              >
                <DropdownMenuRadioGroup
                  value={effectiveEffort}
                  onValueChange={(value) => onReasoningEffortChange(value as ReasoningEffort)}
                >
                  {effortMenu.map((value) => {
                    const entry = REASONING_EFFORTS.find((item) => item.value === value);
                    if (!entry) return null;

                    return (
                      <DropdownMenuRadioItem
                        key={entry.value}
                        value={entry.value}
                        title={entry.hint}
                        className="rounded-lg py-1.5 text-xs text-text-primary cursor-pointer"
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
            <DropdownMenuSeparator className="my-0.5 bg-border-subtle" />
            <DropdownMenuItem
              onSelect={() => onManageProviders()}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover focus:bg-bg-hover cursor-pointer"
            >
              <Settings2 className="size-3.5 text-text-tertiary" />
              <span>Manage models &amp; providers</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
