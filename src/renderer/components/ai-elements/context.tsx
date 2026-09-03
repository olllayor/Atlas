import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { ComponentProps, HTMLAttributes } from "react";
import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type { ContextUsageSnapshot } from "../../../shared/contracts";
import { COMPACTION_THRESHOLD_MIN, COMPACTION_THRESHOLD_MAX } from "../../../shared/contextCompaction";

type ContextUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

type ContextContextValue = {
  maxTokens: number;
  usedTokens: number;
  usage?: ContextUsage;
  modelId?: string;
  remainingPercentage: number;
  remainingLabel: string;
  tone: ContextTone;
  totalCost?: number;
  breakdown?: ContextUsageSnapshot;
  compactionThresholdPercent?: number | null;
  compactionThresholdTokens?: number | null;
  onCompactionThresholdChange?: (next: number) => void;
  onCompactNow?: () => void;
};

const ContextData = createContext<ContextContextValue | null>(null);

function useContextData() {
  const value = useContext(ContextData);
  if (!value) {
    throw new Error("Context components must be used within <Context>.");
  }
  return value;
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

/**
 * Neither end of the scale is allowed to round into an absolute.
 */
export function formatContextPercentage(value: number) {
  if (value <= 0) {
    return "0";
  }
  if (value >= 100) {
    return "100";
  }
  if (value < 1) {
    return "<1";
  }
  if (value < 10) {
    return value.toFixed(1).replace(/\.0$/, "");
  }
  const rounded = Math.round(value);
  return rounded >= 100 ? ">99" : rounded.toString();
}

export function toSpokenPercentage(label: string) {
  if (label.startsWith("<")) {
    return `less than ${label.slice(1)}`;
  }
  if (label.startsWith(">")) {
    return `more than ${label.slice(1)}`;
  }
  return label;
}

export type ContextTone = "normal" | "warning" | "critical";

export function contextToneForRemaining(remainingPercentage: number): ContextTone {
  if (remainingPercentage <= 10) {
    return "critical";
  }
  if (remainingPercentage <= 30) {
    return "warning";
  }
  return "normal";
}

const TONE_COLOR: Record<ContextTone, string> = {
  normal: "var(--accent)",
  warning: "var(--warning)",
  critical: "var(--error)",
};

export function computeRemainingPercentage(usedTokens: number, maxTokens: number) {
  const safeMax = Math.max(1, maxTokens);
  const safeUsed = Math.max(0, usedTokens);
  return Math.min(100, Math.max(0, 100 - (safeUsed / safeMax) * 100));
}

function formatUsd(value?: number) {
  if (value == null) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 0.01 ? 4 : 3,
  }).format(value);
}

/*
  `tokenlens` bundles a model-pricing catalog that costs ~485 kB of the entry
  chunk, and cost only ever renders inside the hover card. So the catalog is
  imported on idle after the meter mounts rather than at boot: `costFromUsage`
  is null until it lands, and `useCostCatalog` re-renders the subscribers that
  display a price once it does. A failed load leaves prices hidden; the token
  counts and the ring do not depend on it.
*/
type CostFromUsage = typeof import("tokenlens").costFromUsage;

let costFromUsage: CostFromUsage | null = null;
let costCatalogLoad: Promise<void> | null = null;
const costCatalogListeners = new Set<() => void>();

function loadCostCatalog() {
  costCatalogLoad ??= import("tokenlens")
    .then((module) => {
      costFromUsage = module.costFromUsage;
      for (const notify of costCatalogListeners) {
        notify();
      }
    })
    .catch(() => {
      // Prices stay hidden. Nothing else in the meter needs the catalog.
    });
  return costCatalogLoad;
}

function subscribeToCostCatalog(notify: () => void) {
  costCatalogListeners.add(notify);
  return () => {
    costCatalogListeners.delete(notify);
  };
}

function readCostCatalog() {
  return costFromUsage;
}

/**
 * Subscribes a component to the deferred pricing catalog so it re-renders when
 * the catalog arrives. Call it in anything that formats a cost.
 */
function useCostCatalog() {
  return useSyncExternalStore(subscribeToCostCatalog, readCostCatalog, readCostCatalog);
}

function getCost(modelId: string | undefined, usage: ContextUsage | undefined) {
  if (!modelId || !usage || !costFromUsage) {
    return undefined;
  }
  try {
    return costFromUsage({ id: modelId, usage });
  } catch {
    return undefined;
  }
}

export type ContextProps = ComponentProps<typeof HoverCard> & {
  maxTokens: number;
  usedTokens: number;
  usage?: ContextUsage;
  modelId?: string;
  breakdown?: ContextUsageSnapshot;
  compactionThresholdPercent?: number | null;
  compactionThresholdTokens?: number | null;
  onCompactionThresholdChange?: (next: number) => void;
  onCompactNow?: () => void;
};

export const Context = ({
  maxTokens,
  usedTokens,
  usage,
  modelId,
  breakdown,
  compactionThresholdPercent,
  compactionThresholdTokens,
  onCompactionThresholdChange,
  onCompactNow,
  children,
  openDelay = 120,
  closeDelay = 80,
  ...props
}: ContextProps) => {
  const costCatalog = useCostCatalog();

  // Warmed on idle rather than on first hover: the catalog is off the boot
  // critical path either way, and by the time anyone opens the card the price
  // is already there instead of popping in a frame late.
  useEffect(() => {
    if (typeof requestIdleCallback !== "function") {
      const timer = setTimeout(loadCostCatalog, 2000);
      return () => clearTimeout(timer);
    }
    const handle = requestIdleCallback(() => loadCostCatalog(), { timeout: 5000 });
    return () => cancelIdleCallback(handle);
  }, []);

  const value = useMemo<ContextContextValue>(() => {
    const safeMax = Math.max(1, maxTokens);
    const safeUsed = Math.max(0, usedTokens);
    const remainingPercentage = computeRemainingPercentage(safeUsed, safeMax);
    return {
      breakdown,
      maxTokens: safeMax,
      modelId,
      remainingLabel: formatContextPercentage(remainingPercentage),
      remainingPercentage,
      tone: contextToneForRemaining(remainingPercentage),
      totalCost: getCost(modelId, usage),
      usage,
      usedTokens: safeUsed,
      compactionThresholdPercent: compactionThresholdPercent ?? breakdown?.compactionThresholdPercent ?? null,
      compactionThresholdTokens: compactionThresholdTokens ?? breakdown?.compactionThresholdTokens ?? null,
      onCompactionThresholdChange,
      onCompactNow,
    };
  }, [breakdown, compactionThresholdPercent, compactionThresholdTokens, costCatalog, maxTokens, modelId, onCompactNow, onCompactionThresholdChange, usage, usedTokens]);

  return (
    <ContextData.Provider value={value}>
      <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props}>
        {children}
      </HoverCard>
    </ContextData.Provider>
  );
};

export type ContextTriggerProps = ComponentProps<"button">;

export const ContextTrigger = ({
  className,
  children,
  ...props
}: ContextTriggerProps) => {
  const { remainingLabel, remainingPercentage, tone, usedTokens, maxTokens } = useContextData();
  const color = TONE_COLOR[tone];
  const circumference = 2 * Math.PI * 11;
  const isEmpty = usedTokens <= 0 || remainingPercentage >= 99.5;
  const exhausted = remainingPercentage <= 0;
  const progress = exhausted ? 0 : Math.max(0.02, Math.min(1, remainingPercentage / 100));
  const dashOffset = circumference * (1 - progress);
  const glow = `drop-shadow(0 0 4px ${color})`;

  if (children) {
    return <HoverCardTrigger asChild>{children}</HoverCardTrigger>;
  }

  return (
    <HoverCardTrigger asChild>
      <button
        type="button"
        aria-label={`Context: ${toSpokenPercentage(remainingLabel)}% left, ${formatTokenCount(
          usedTokens
        )} of ${formatTokenCount(maxTokens)} used`}
        className={cn(
          "group relative inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition hover:bg-bg-hover hover:text-[var(--text-primary)]",
          className
        )}
        {...props}
      >
        <svg aria-hidden="true" className="absolute inset-[2px] -rotate-90" viewBox="0 0 32 32">
          <circle
            cx="16"
            cy="16"
            r="11"
            fill="none"
            stroke={exhausted ? color : "var(--border-default)"}
            strokeWidth="2.5"
            opacity={exhausted ? 1 : isEmpty ? 0.6 : 0.3}
            style={{ filter: exhausted ? glow : "none" }}
          />
          {isEmpty ? null : (
            <circle
              cx="16"
              cy="16"
              r="11"
              fill="none"
              stroke={color}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth="2.5"
              className="transition-all duration-300"
              style={{
                filter: tone !== "normal" && !exhausted ? glow : "none"
              }}
            />
          )}
        </svg>
      </button>
    </HoverCardTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({ className, ...props }: ContextContentProps) => (
  <HoverCardContent
    side="top"
    align="end"
    sideOffset={12}
    className={cn(
      "w-[280px] border border-[var(--border-strong)] bg-bg-overlay p-0 text-text-primary shadow-elevated",
      className
    )}
    {...props}
  />
);

export type ContextContentHeaderProps = HTMLAttributes<HTMLDivElement>;

export const ContextContentHeader = ({
  className,
  children,
  ...props
}: ContextContentHeaderProps) => {
  const { remainingLabel, usedTokens, maxTokens } = useContextData();

  return (
    <div className={cn("px-3.5 pt-3", className)} {...props}>
      {children ?? (
        <div className="space-y-1.5">
          <div className="text-2xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Context Window</div>
          <div className="text-sm font-medium leading-none tracking-tight">
            <span className="tabular-nums font-semibold text-[var(--text-primary)]">{remainingLabel}% left</span>
            <span className="px-1.5 text-[var(--text-muted)]">•</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {formatTokenCount(usedTokens)} of {formatTokenCount(maxTokens)} used
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export type ContextContentBodyProps = HTMLAttributes<HTMLDivElement>;

export const ContextContentBody = ({
  className,
  children,
  ...props
}: ContextContentBodyProps) => {
  const data = useContextData();
  const { breakdown } = data;

  return (
    <div className={cn("px-3.5 pt-2.5 text-sm leading-[1.4] text-[var(--text-secondary)]", className)} {...props}>
      {children ??
        (breakdown ? (
          <>
            <ContextThresholdBar />
            <div className="mt-2.5">
              <ContextBreakdownRows breakdown={breakdown} />
            </div>
          </>
        ) : null)}
    </div>
  );
};

/**
 * Single blue usage bar with draggable threshold marker.
 * The threshold is the conversation-token budget after reserved output, system and tools excluded.
 */
function ContextThresholdBar() {
  const {
    usedTokens,
    maxTokens,
    compactionThresholdPercent,
    compactionThresholdTokens,
    onCompactionThresholdChange,
    onCompactNow,
  } = useContextData();

  const hasThreshold = typeof compactionThresholdPercent === 'number' && compactionThresholdTokens != null && maxTokens > 0;
  const thresholdPercent = hasThreshold ? (compactionThresholdPercent as number) : 85;
  const thresholdTokens = hasThreshold ? (compactionThresholdTokens as number) : null;

  // Slider local draft so dragging updates marker immediately without spamming IPC.
  const [draftPercent, setDraftPercent] = useState<number>(thresholdPercent);
  const isDraggingRef = useRef(false);
  const committedRef = useRef<number>(thresholdPercent);

  useEffect(() => {
    if (!isDraggingRef.current) {
      setDraftPercent(thresholdPercent);
      committedRef.current = thresholdPercent;
    }
  }, [thresholdPercent]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      const clamped = Math.min(COMPACTION_THRESHOLD_MAX, Math.max(COMPACTION_THRESHOLD_MIN, Math.round(next)));
      setDraftPercent(clamped);
      // Live preview for keyboard; pointer commits on change as well but debounced by parent.
      // We commit on every change for keyboard accessibility; parent should debounce persistence.
      // For pointer, this still updates marker immediately.
    },
    []
  );

  const handleCommit = useCallback(() => {
    if (committedRef.current !== draftPercent) {
      committedRef.current = draftPercent;
      onCompactionThresholdChange?.(draftPercent);
    }
  }, [draftPercent, onCompactionThresholdChange]);

  const handlePointerDown = useCallback(() => {
    isDraggingRef.current = true;
  }, []);
  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    handleCommit();
  }, [handleCommit]);

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
        handleCommit();
      }
    },
    [handleCommit]
  );

  // Percent for bar fill and marker. Conversation threshold vs window scale.
  const usedPercent = Math.min(100, Math.max(0, (usedTokens / Math.max(1, maxTokens)) * 100));
  // Marker position: thresholdTokens / maxTokens (conversation budget on window scale). Fallback to percent of window.
  const markerPercent = hasThreshold && thresholdTokens != null ? Math.min(100, Math.max(0, (thresholdTokens / Math.max(1, maxTokens)) * 100)) : (draftPercent / 100) * 100;
  // Draft marker mirrors the pending percent value while dragging: need to convert draft percent to token space for preview?
  // For preview while dragging, compute draftThresholdTokens = available * draftRatio. Approximate by scaling marker linearly with draft percent.
  // Simpler: marker follows draftPercent proportionally when dragging without recomputed tokens (approx). For committed state, use real tokens.
  const displayMarkerPercent = isDraggingRef.current ? (draftPercent / 100) * (markerPercent / Math.max(1, thresholdPercent)) * 100 : markerPercent;
  // Actually simpler: if dragging, compute marker as draftPercent/100 * 100 but scaled to available ratio? Keep linear to avoid jump.
  // Use draftMarker = (draftPercent / thresholdPercent) * markerPercent while dragging.
  const effectiveMarker = (() => {
    if (!isDraggingRef.current) return markerPercent;
    if (!hasThreshold || thresholdPercent === 0) return (draftPercent / 100) * 100;
    return Math.min(100, Math.max(0, (draftPercent / thresholdPercent) * markerPercent));
  })();

  return (
    <div className="space-y-2.5">
      {/* Blue usage bar with threshold marker */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-subtle" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)] transition-all duration-200" style={{ width: `${usedPercent}%` }} />
        {hasThreshold ? (
          <div
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[var(--text-primary)] shadow-[0_0_0_2px_var(--bg-overlay)]"
            style={{ left: `${effectiveMarker}%` }}
            title={`Threshold ${thresholdPercent}%`}
          />
        ) : null}
      </div>

      {/* Range input overlays bar for a11y; visually separate but controls same value */}
      {onCompactionThresholdChange ? (
        <div className="relative">
          <input
            type="range"
            min={COMPACTION_THRESHOLD_MIN}
            max={COMPACTION_THRESHOLD_MAX}
            step={1}
            value={draftPercent}
            onChange={handleChange}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onTouchEnd={handleCommit}
            onMouseUp={handleCommit}
            onBlur={handleCommit}
            onKeyUp={handleKeyUp}
            aria-label="Automatic compaction threshold"
            aria-valuetext={`${draftPercent} percent, compact at ${thresholdTokens != null ? formatTokenCount(thresholdTokens) : '—'}`}
            className="h-1.5 w-full cursor-pointer appearance-none bg-transparent accent-[var(--accent)]"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between text-2xs">
        <span className="tabular-nums text-text-tertiary">
          {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)}
        </span>
        <span className="tabular-nums text-text-secondary">
          {thresholdTokens != null ? `Compact at ${formatTokenCount(thresholdTokens)}` : `Compact at ${thresholdPercent}%`}
        </span>
      </div>

      {onCompactNow ? (
        <button
          type="button"
          onClick={onCompactNow}
          className="inline-flex h-7 w-full items-center justify-center rounded-md border border-border-default bg-bg-base px-2.5 text-xs font-medium text-text-primary transition hover:bg-bg-hover"
        >
          Compact Now
        </button>
      ) : null}

      <div className="flex items-center justify-between pt-0.5 text-2xs">
        <span className="text-text-tertiary">Automatic Compaction</span>
        <span className="text-[var(--accent)]" aria-hidden="true">
          ✓
        </span>
        <span className="sr-only">enabled</span>
      </div>
    </div>
  );
}

function ContextBreakdownRows({ breakdown }: { breakdown: ContextUsageSnapshot }) {
  const rows: Array<{ label: string; tokens: number }> = [
    { label: "Conversation", tokens: breakdown.historyTokens },
    { label: "Older turns (summarised)", tokens: breakdown.summaryTokens },
    { label: "Not yet sent", tokens: breakdown.pendingTokens },
  ].filter((row) => row.tokens > 0);

  const floorTokens = breakdown.systemTokens + breakdown.toolTokens;

  return (
    <div className="flex flex-col gap-1">
      <ContextCompositionBar breakdown={breakdown} />
      {rows.map((row) => (
        <div className="flex items-center justify-between gap-3 text-2xs" key={row.label}>
          <span className="text-text-tertiary">{row.label}</span>
          <span className="tabular-nums text-text-secondary">{formatTokenCount(row.tokens)}</span>
        </div>
      ))}

      {floorTokens > 0 ? (
        <div className="flex items-center justify-between gap-3 text-2xs">
          <span className="text-text-faint">
            {breakdown.toolTokens > 0 ? "Instructions and tools" : "Instructions"}, sent every turn
          </span>
          <span className="tabular-nums text-text-faint">+{formatTokenCount(floorTokens)}</span>
        </div>
      ) : null}

      {breakdown.droppedTurnCount > 0 ? (
        <div className="pt-1 text-2xs leading-4 text-text-tertiary">
          {breakdown.droppedTurnCount} older {breakdown.droppedTurnCount === 1 ? "turn" : "turns"} compressed to fit; the{" "}
          {breakdown.keptTurnCount} most recent are sent in full.
        </div>
      ) : null}
    </div>
  );
}

function ContextCompositionBar({ breakdown }: { breakdown: ContextUsageSnapshot }) {
  const segments = [
    { label: "Instructions", tokens: breakdown.systemTokens, color: "var(--text-tertiary)" },
    { label: "Tools", tokens: breakdown.toolTokens, color: "color-mix(in oklab, var(--text-tertiary) 55%, transparent)" },
    { label: "Summarised turns", tokens: breakdown.summaryTokens, color: "var(--warning)" },
    { label: "Recent turns", tokens: breakdown.historyTokens, color: "var(--accent)" },
    { label: "Not yet sent", tokens: breakdown.pendingTokens, color: "color-mix(in oklab, var(--accent) 55%, transparent)" },
  ].filter((segment) => segment.tokens > 0);

  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (total <= 0) {
    return null;
  }

  return (
    <div aria-hidden="true" className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-bg-subtle">
      {segments.map((segment) => (
        <div
          key={segment.label}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(segment.tokens / total) * 100}%`, background: segment.color }}
          title={`~${segment.label}`}
        />
      ))}
    </div>
  );
}

export function formatCacheHitRate(hitRate: number) {
  return `${(Math.min(1, Math.max(0, hitRate)) * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export type ContextContentFooterProps = HTMLAttributes<HTMLDivElement>;

export const ContextContentFooter = ({
  className,
  children,
  ...props
}: ContextContentFooterProps) => {
  const { totalCost, breakdown } = useContextData();
  const formattedCost = formatUsd(totalCost);
  const cache = breakdown?.cache ?? null;

  return (
    <div className={cn("px-3.5 pb-3 pt-2 text-2xs leading-[1.35] text-[var(--text-muted)]", className)} {...props}>
      {children ?? (
        <span>
          {cache && cache.hitRate != null ? (
            <>
              {formatCacheHitRate(cache.hitRate)} prompt cache hit across {cache.reportedTurns} {cache.reportedTurns === 1 ? "turn" : "turns"}.
              <br />
            </>
          ) : null}
          {breakdown?.overflow
            ? "Over the window. The oldest turns are being summarised to fit."
            : formattedCost
              ? `Last turn cost about ${formattedCost}.`
              : "Older turns are summarised automatically as the window fills."}
        </span>
      )}
    </div>
  );
};

type UsageRowProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  tokens?: number;
  usageKey: keyof ContextUsage;
};

function UsageRow({ className, children, label, tokens, usageKey, ...props }: UsageRowProps) {
  const { modelId } = useContextData();
  // Subscribed for the re-render, not the value: `getCost` reads the catalog
  // itself once it has landed.
  useCostCatalog();
  const usage = tokens != null ? { [usageKey]: tokens } : undefined;
  const formattedCost = formatUsd(getCost(modelId, usage));

  if (!tokens && !children) {
    return null;
  }

  return (
    <div className={cn("flex items-center justify-between gap-3 text-2xs", className)} {...props}>
      {children ?? (
        <>
          <span className="text-text-tertiary">{label}</span>
          <div className="flex items-center gap-2 tabular-nums">
            <span className="text-text-secondary">{formatTokenCount(tokens ?? 0)}</span>
            <span className="min-w-12 text-right text-text-faint">{formattedCost ?? "—"}</span>
          </div>
        </>
      )}
    </div>
  );
}

export type ContextInputUsageProps = HTMLAttributes<HTMLDivElement>;
export const ContextInputUsage = ({ children, ...props }: ContextInputUsageProps) => {
  const { usage } = useContextData();
  return <UsageRow label="Input" tokens={usage?.inputTokens} usageKey="inputTokens" {...props}>{children}</UsageRow>;
};

export type ContextOutputUsageProps = HTMLAttributes<HTMLDivElement>;
export const ContextOutputUsage = ({ children, ...props }: ContextOutputUsageProps) => {
  const { usage } = useContextData();
  return <UsageRow label="Output" tokens={usage?.outputTokens} usageKey="outputTokens" {...props}>{children}</UsageRow>;
};

export type ContextReasoningUsageProps = HTMLAttributes<HTMLDivElement>;
export const ContextReasoningUsage = ({ children, ...props }: ContextReasoningUsageProps) => {
  const { usage } = useContextData();
  return <UsageRow label="Reasoning" tokens={usage?.reasoningTokens} usageKey="reasoningTokens" {...props}>{children}</UsageRow>;
};

export type ContextCacheUsageProps = HTMLAttributes<HTMLDivElement>;
export const ContextCacheUsage = ({ children, ...props }: ContextCacheUsageProps) => {
  const { usage } = useContextData();
  return <UsageRow label="Cache" tokens={usage?.cachedInputTokens} usageKey="cachedInputTokens" {...props}>{children}</UsageRow>;
};
