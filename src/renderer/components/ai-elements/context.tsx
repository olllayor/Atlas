import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { Minimize2, Zap } from "lucide-react";
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
  openDelay = 150,
  closeDelay = 250,
  ...props
}: ContextProps) => {
  const costCatalog = useCostCatalog();

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
          "group relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer",
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
    sideOffset={8}
    className={cn(
      "w-[304px] rounded-xl border border-border-subtle dropdown-glass p-3.5 text-text-primary shadow-elevated outline-none space-y-3",
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
  const { remainingLabel, usedTokens, maxTokens, tone } = useContextData();

  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between text-2xs">
            <span className="font-semibold uppercase tracking-wider text-text-tertiary">Context Window</span>
            <span className="font-mono tabular-nums text-text-muted">
              {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5 text-sm font-semibold tracking-tight text-text-primary">
            <span className={cn(
              tone === "critical" ? "text-error" : tone === "warning" ? "text-warning" : "text-accent"
            )}>
              {remainingLabel}% left
            </span>
            <span className="text-xs font-normal text-text-tertiary">
              ({formatTokenCount(Math.max(0, maxTokens - usedTokens))} free)
            </span>
          </div>
        </>
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
    <div className={cn("space-y-3 text-sm text-text-secondary", className)} {...props}>
      {children ??
        (breakdown ? (
          <>
            <ContextThresholdBar />
            <ContextBreakdownRows breakdown={breakdown} />
          </>
        ) : null)}
    </div>
  );
};

/**
 * Capacity bar with threshold tick marker, integrated threshold range slider, and compact button.
 */
function ContextThresholdBar() {
  const {
    usedTokens,
    maxTokens,
    compactionThresholdPercent,
    compactionThresholdTokens,
    onCompactionThresholdChange,
    onCompactNow,
    tone,
    remainingPercentage,
  } = useContextData();

  const [isCompacting, setIsCompacting] = useState(false);

  const hasThreshold = typeof compactionThresholdPercent === "number" && compactionThresholdTokens != null && maxTokens > 0;
  const thresholdPercent = hasThreshold ? (compactionThresholdPercent as number) : 85;
  const thresholdTokens = hasThreshold ? (compactionThresholdTokens as number) : null;

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
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") {
        handleCommit();
      }
    },
    [handleCommit]
  );

  const handleCompact = useCallback(async () => {
    if (!onCompactNow || isCompacting) return;
    setIsCompacting(true);
    try {
      await Promise.resolve(onCompactNow());
    } finally {
      setTimeout(() => setIsCompacting(false), 500);
    }
  }, [onCompactNow, isCompacting]);

  const usedPercent = Math.min(100, Math.max(0, (usedTokens / Math.max(1, maxTokens)) * 100));
  const markerPercent = hasThreshold && thresholdTokens != null
    ? Math.min(100, Math.max(0, (thresholdTokens / Math.max(1, maxTokens)) * 100))
    : (draftPercent / 100) * 100;

  const effectiveMarker = (() => {
    if (!isDraggingRef.current) return markerPercent;
    if (!hasThreshold || thresholdPercent === 0) return (draftPercent / 100) * 100;
    return Math.min(100, Math.max(0, (draftPercent / thresholdPercent) * markerPercent));
  })();

  const sliderProgress = ((draftPercent - COMPACTION_THRESHOLD_MIN) / (COMPACTION_THRESHOLD_MAX - COMPACTION_THRESHOLD_MIN)) * 100;

  return (
    <div className="space-y-2.5">
      {/* Visual Window Usage Bar with Threshold Tick Marker */}
      <div className="space-y-1.5">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-subtle/80 border border-border-subtle/40" aria-hidden="true">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-all duration-300",
              tone === "critical" ? "bg-error" : tone === "warning" ? "bg-warning" : "bg-accent"
            )}
            style={{ width: `${Math.max(usedPercent > 0 ? 1 : 0, usedPercent)}%` }}
          />
          {hasThreshold ? (
            <div
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-text-primary/80 shadow-[0_0_0_1.5px_var(--bg-overlay)] z-1"
              style={{ left: `${effectiveMarker}%` }}
              title={`Threshold: ${thresholdPercent}% (${thresholdTokens != null ? formatTokenCount(thresholdTokens) : ""})`}
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between text-2xs text-text-tertiary">
          <span className="tabular-nums">
            {usedPercent < 1 && usedPercent > 0 ? "<1%" : `${Math.round(usedPercent)}%`} used
          </span>
          <span className="tabular-nums text-text-secondary font-medium">
            {thresholdTokens != null ? `Threshold: ${formatTokenCount(thresholdTokens)}` : `Threshold: ${thresholdPercent}%`}
          </span>
        </div>
      </div>

      {/* Threshold Slider (cleanly styled with .settings-range, no invisible tracks or floating thumbs) */}
      {onCompactionThresholdChange ? (
        <div className="space-y-1.5 rounded-lg border border-border-subtle/60 bg-bg-subtle/40 p-2.5">
          <div className="flex items-center justify-between text-2xs">
            <span className="font-medium text-text-secondary">Auto-compaction threshold</span>
            <span className="font-mono tabular-nums font-medium text-text-primary">
              {draftPercent}% {thresholdTokens != null ? `(${formatTokenCount(thresholdTokens)})` : ""}
            </span>
          </div>
          <div className="relative flex items-center pt-0.5">
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
              aria-valuetext={`${draftPercent} percent, compact at ${thresholdTokens != null ? formatTokenCount(thresholdTokens) : "—"}`}
              className="settings-range h-1.5 w-full cursor-pointer rounded-full"
              style={{
                "--settings-slider-progress": `${Math.max(0, Math.min(100, sliderProgress))}%`
              } as React.CSSProperties}
            />
          </div>
        </div>
      ) : null}

      {/* Compact Now Action */}
      {onCompactNow ? (
        <button
          type="button"
          onClick={handleCompact}
          disabled={usedTokens <= 0 || isCompacting}
          className="inline-flex h-7.5 w-full items-center justify-center gap-1.5 rounded-lg border border-border-default bg-bg-surface px-3 text-xs font-medium text-text-primary shadow-2xs transition hover:bg-bg-hover hover:border-border-medium active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Minimize2 className={cn("size-3.5 text-text-secondary transition-transform", isCompacting && "animate-spin")} />
          <span>{isCompacting ? "Compacting conversation…" : "Compact Now"}</span>
        </button>
      ) : null}
    </div>
  );
}

function ContextBreakdownRows({ breakdown }: { breakdown: ContextUsageSnapshot }) {
  const floorTokens = breakdown.systemTokens + breakdown.toolTokens;

  const rows: Array<{ label: string; tokens: number; color: string; isPerTurn?: boolean }> = [
    { label: "Conversation", tokens: breakdown.historyTokens, color: "var(--accent)" },
    { label: "Older turns (summarised)", tokens: breakdown.summaryTokens, color: "var(--warning)" },
    { label: "System instructions & tools", tokens: floorTokens, color: "var(--text-tertiary)", isPerTurn: true },
    { label: "Not yet sent", tokens: breakdown.pendingTokens, color: "color-mix(in oklab, var(--accent) 55%, transparent)" },
  ].filter((row) => row.tokens > 0);

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between text-3xs font-semibold uppercase tracking-wider text-text-tertiary">
        <span>Turn Composition</span>
        <span className="font-normal normal-case text-text-muted">Breakdown</span>
      </div>

      <ContextCompositionBar breakdown={breakdown} />

      <div className="space-y-1.5 pt-1">
        {rows.map((row) => (
          <div className="flex items-center justify-between gap-3 text-2xs" key={row.label}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
              <span className="truncate text-text-secondary">{row.label}</span>
              {row.isPerTurn ? (
                <span className="text-3xs text-text-tertiary shrink-0">(per turn)</span>
              ) : null}
            </div>
            <span className="tabular-nums font-mono shrink-0 font-medium text-text-primary">
              {row.isPerTurn ? `+${formatTokenCount(row.tokens)}` : formatTokenCount(row.tokens)}
            </span>
          </div>
        ))}
      </div>

      {breakdown.droppedTurnCount > 0 ? (
        <div className="pt-1 text-2xs leading-relaxed text-text-tertiary">
          {breakdown.droppedTurnCount} older {breakdown.droppedTurnCount === 1 ? "turn" : "turns"} compressed to fit; the{" "}
          {breakdown.keptTurnCount} most recent are preserved.
        </div>
      ) : null}
    </div>
  );
}

function ContextCompositionBar({ breakdown }: { breakdown: ContextUsageSnapshot }) {
  const segments = [
    { label: "Conversation", tokens: breakdown.historyTokens, color: "var(--accent)" },
    { label: "Older turns", tokens: breakdown.summaryTokens, color: "var(--warning)" },
    { label: "Instructions & tools", tokens: breakdown.systemTokens + breakdown.toolTokens, color: "var(--text-tertiary)" },
    { label: "Pending", tokens: breakdown.pendingTokens, color: "color-mix(in oklab, var(--accent) 55%, transparent)" },
  ].filter((segment) => segment.tokens > 0);

  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (total <= 0) {
    return null;
  }

  return (
    <div aria-hidden="true" className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-bg-subtle/80 border border-border-subtle/40">
      {segments.map((segment) => (
        <div
          key={segment.label}
          className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
          style={{ width: `${(segment.tokens / total) * 100}%`, backgroundColor: segment.color }}
          title={`${segment.label}: ${formatTokenCount(segment.tokens)}`}
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
    <div className={cn("rounded-lg border border-border-subtle/50 bg-bg-subtle/30 p-2.5 text-2xs text-text-secondary space-y-1.5", className)} {...props}>
      {children ?? (
        <>
          {cache && cache.hitRate != null ? (
            <div className="flex items-center gap-1.5 font-medium text-text-primary">
              <Zap className="size-3 text-accent shrink-0" />
              <span>
                <strong className="font-semibold">{formatCacheHitRate(cache.hitRate)}</strong> prompt cache hit across {cache.reportedTurns} {cache.reportedTurns === 1 ? "turn" : "turns"}
              </span>
            </div>
          ) : null}
          <p className="text-text-tertiary leading-relaxed">
            {breakdown?.overflow
              ? "Over window limit. Older turns are automatically compressed to fit."
              : formattedCost
                ? `Last turn cost ~${formattedCost}. Older turns summarise as window fills.`
                : "Older turns are summarised automatically as the window fills."}
          </p>
        </>
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
