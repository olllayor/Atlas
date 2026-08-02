import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { costFromUsage } from "tokenlens";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import type { ContextUsageSnapshot } from "../../../shared/contracts";

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
  percentageValue: number;
  percentageLabel: string;
  totalCost?: number;
  /** Where the prompt's tokens actually go, when the main process measured it. */
  breakdown?: ContextUsageSnapshot;
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
 * A used window is never reported as `0`.
 *
 * The previous rounding sent anything under 0.05% through `toFixed(1)` and then
 * stripped the `.0`, so a real prompt of a few hundred tokens against a 200K
 * window rendered as a flat `0` — the same glyph as an untouched window. Small
 * but nonzero now reads `<1`, which is a fact rather than a rounding artefact.
 */
export function formatContextPercentage(value: number) {
  if (value <= 0) {
    return "0";
  }

  if (value < 1) {
    return "<1";
  }

  if (value < 10) {
    return value.toFixed(1).replace(/\.0$/, "");
  }

  return Math.round(value).toString();
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

function getCost(modelId: string | undefined, usage: ContextUsage | undefined) {
  if (!modelId || !usage) {
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
};

export const Context = ({
  maxTokens,
  usedTokens,
  usage,
  modelId,
  breakdown,
  children,
  openDelay = 120,
  closeDelay = 80,
  ...props
}: ContextProps) => {
  const value = useMemo<ContextContextValue>(() => {
    const safeMax = Math.max(1, maxTokens);
    const safeUsed = Math.max(0, usedTokens);
    const percentageValue = Math.min(100, (safeUsed / safeMax) * 100);

    return {
      breakdown,
      maxTokens: safeMax,
      modelId,
      percentageLabel: formatContextPercentage(percentageValue),
      percentageValue,
      totalCost: getCost(modelId, usage),
      usage,
      usedTokens: safeUsed,
    };
  }, [breakdown, maxTokens, modelId, usage, usedTokens]);

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
  const { percentageLabel, percentageValue } = useContextData();
  const circumference = 2 * Math.PI * 11;
  // An untouched window draws no arc at all — with the figure gone from the
  // face of the ring, a permanent starter stub would be the only mark on it and
  // would read as usage. Anything above zero keeps the 2% minimum so a real but
  // tiny conversation is still visible.
  const ratio = percentageValue / 100;
  const progress = ratio <= 0 ? 0 : Math.max(0.02, Math.min(1, ratio));
  const dashOffset = circumference * (1 - progress);


  // Color based on usage percentage
  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return "var(--error)";
    if (percentage >= 70) return "var(--warning)";
    return "var(--accent)";
  };

  if (children) {
    return <HoverCardTrigger asChild>{children}</HoverCardTrigger>;
  }

  return (
    <HoverCardTrigger asChild>
      <button
        type="button"
        aria-label={`Context used: ${percentageLabel}%`}
        // Borderless size-9 circle so it reads as one of the row's ghost
        // buttons instead of the only bordered, square, press-animated control.
        // The dial is the whole control: the figure it used to carry was three
        // glyphs of noise next to the model name, and the hover card already
        // states it exactly, alongside the breakdown that explains it.
        className={cn(
          "group relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition hover:bg-bg-hover hover:text-[var(--text-primary)]",
          className
        )}
        {...props}
      >
        {/* Main progress ring */}
        <svg
          aria-hidden="true"
          className="absolute inset-[3px] -rotate-90"
          viewBox="0 0 32 32"
        >
          {/* Background track */}
          <circle
            cx="16"
            cy="16"
            r="11"
            fill="none"
            stroke="var(--border-default)"
            strokeWidth="2.5"
            opacity="0.3"
          />
          {/* Progress arc */}
          <circle
            cx="16"
            cy="16"
            r="11"
            fill="none"
            stroke={getProgressColor(percentageValue)}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="2.5"
            className="transition-all duration-300"
            style={{
              filter: percentageValue >= 70 ? `drop-shadow(0 0 4px ${getProgressColor(percentageValue)})` : 'none'
            }}
          />
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
        "w-[292px] border border-[var(--border-strong)] bg-bg-overlay p-0 text-text-primary shadow-elevated",
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
  const { percentageLabel, usedTokens, maxTokens } = useContextData();

  return (
    <div className={cn("px-4 pt-3.5", className)} {...props}>
      {children ?? (
        <div className="space-y-1.5">
          <div className="text-2xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Context Window
          </div>
          <div className="text-sm font-medium leading-none tracking-tight">
            <span className="tabular-nums font-semibold text-[var(--text-primary)]">{percentageLabel}%</span>
            <span className="px-1.5 text-[var(--text-muted)]">•</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {formatTokenCount(usedTokens)}/{formatTokenCount(maxTokens)} used by this chat
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
  const { breakdown } = useContextData();

  return (
    <div className={cn("px-4 pt-2 text-sm leading-[1.4] text-[var(--text-secondary)]", className)} {...props}>
      {children ?? (breakdown ? <ContextBreakdownRows breakdown={breakdown} /> : null)}
    </div>
  );
};

/**
 * Where the prompt's tokens go.
 *
 * The percentage counts only what the conversation put in the window. The
 * instructions and tool schemas are a fixed floor charged on every request, and
 * omitting them entirely would misstate what a turn costs — so they are listed
 * here, below the conversation rows and explicitly marked as sitting outside
 * the figure above. Rows are omitted when zero so a tools-off conversation does
 * not carry an empty line.
 */
function ContextBreakdownRows({ breakdown }: { breakdown: ContextUsageSnapshot }) {
  const rows: Array<{ label: string; tokens: number }> = [
    { label: "Conversation", tokens: breakdown.historyTokens },
    { label: "Older turns (summarised)", tokens: breakdown.summaryTokens },
    { label: "Not yet sent", tokens: breakdown.pendingTokens },
  ].filter((row) => row.tokens > 0);

  const floorTokens = breakdown.systemTokens + breakdown.toolTokens;

  return (
    <div className="flex flex-col gap-1">
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
          {breakdown.droppedTurnCount} older {breakdown.droppedTurnCount === 1 ? "turn" : "turns"} compressed to
          fit; the {breakdown.keptTurnCount} most recent are sent in full.
        </div>
      ) : null}
    </div>
  );
}

export type ContextContentFooterProps = HTMLAttributes<HTMLDivElement>;

export const ContextContentFooter = ({
  className,
  children,
  ...props
}: ContextContentFooterProps) => {
  const { totalCost, breakdown } = useContextData();
  const formattedCost = formatUsd(totalCost);

  return (
    <div
      className={cn(
        "px-4 pb-3.5 pt-2 text-2xs leading-[1.35] text-[var(--text-muted)]",
        className
      )}
      {...props}
    >
      {children ?? (
        <span>
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
