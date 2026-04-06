import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { costFromUsage } from "tokenlens";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

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
  processedTokens: number;
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

function formatContextPercentage(value: number) {
  if (value <= 0) {
    return "0";
  }

  if (value < 1) {
    return value.toFixed(1).replace(/\.0$/, "");
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
  processedTokens?: number;
  usage?: ContextUsage;
  modelId?: string;
};

export const Context = ({
  maxTokens,
  usedTokens,
  processedTokens,
  usage,
  modelId,
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
      maxTokens: safeMax,
      modelId,
      percentageLabel: formatContextPercentage(percentageValue),
      percentageValue,
      processedTokens: Math.max(safeUsed, processedTokens ?? safeUsed),
      totalCost: getCost(modelId, usage),
      usage,
      usedTokens: safeUsed,
    };
  }, [maxTokens, modelId, processedTokens, usage, usedTokens]);

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
  const circumference = 2 * Math.PI * 14;
  const progress = Math.max(0.02, Math.min(1, percentageValue / 100));
  const dashOffset = circumference * (1 - progress);

  if (children) {
    return <HoverCardTrigger asChild>{children}</HoverCardTrigger>;
  }

  return (
    <HoverCardTrigger asChild>
      <button
        type="button"
          className={cn(
            "relative inline-flex size-[34px] items-center justify-center border border-[var(--border-default)] bg-[var(--bg-hover)] text-[9px] font-normal tabular-nums text-[var(--text-tertiary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-active)] hover:text-[var(--text-secondary)]",
            className
          )}
        {...props}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 -rotate-90"
          viewBox="0 0 32 32"
        >
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="2"
          />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="rgba(255,255,255,0.6)"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
        <span className="relative z-10">{percentageLabel}</span>
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
        "w-[292px] border border-[var(--border-default)] bg-bg-elevated p-0 text-text-primary",
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
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Context Window
          </div>
          <div className="text-[13px] font-medium leading-none tracking-tight text-[var(--text-primary)]">
            <span className="tabular-nums font-normal text-white">{percentageLabel}%</span>
            <span className="px-1.5 text-[var(--text-faint)]">•</span>
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              {formatTokenCount(usedTokens)}/{formatTokenCount(maxTokens)} context used
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
  const { processedTokens } = useContextData();

  return (
    <div className={cn("px-4 pt-2 text-[13px] leading-none text-[var(--text-secondary)]", className)} {...props}>
      {children ?? (
        <span>
          Total processed:{" "}
          <span className="tabular-nums text-[var(--text-secondary)]">{formatTokenCount(processedTokens)} tokens</span>
        </span>
      )}
    </div>
  );
};

export type ContextContentFooterProps = HTMLAttributes<HTMLDivElement>;

export const ContextContentFooter = ({
  className,
  children,
  ...props
}: ContextContentFooterProps) => {
  const { totalCost } = useContextData();
  const formattedCost = formatUsd(totalCost);

  return (
    <div
      className={cn(
        "px-4 pb-3.5 pt-2 text-[13px] leading-[1.25] text-[var(--text-muted)]",
        className
      )}
      {...props}
    >
      {children ?? (
        <span>
          {formattedCost
            ? `Estimated cost: ${formattedCost}`
            : "Automatically compacts its context when needed."}
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
    <div className={cn("flex items-center justify-between gap-3 text-[11px]", className)} {...props}>
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
