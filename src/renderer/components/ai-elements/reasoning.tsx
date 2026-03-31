"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { BrainCircuit, ChevronDown } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { MessageResponse } from "./message";

type ReasoningContextValue = {
  duration?: number;
  isOpen: boolean;
  isStreaming: boolean;
  setIsOpen: (open: boolean) => void;
};

const ReasoningData = createContext<ReasoningContextValue | null>(null);

export function useReasoning() {
  const value = useContext(ReasoningData);

  if (!value) {
    throw new Error("Reasoning components must be used within <Reasoning>.");
  }

  return value;
}

function formatDuration(duration?: number) {
  if (duration == null || Number.isNaN(duration)) {
    return undefined;
  }

  if (duration < 60) {
    return `${duration}s`;
  }

  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  duration?: number;
  isStreaming?: boolean;
};

export const Reasoning = ({
  children,
  className,
  defaultOpen = false,
  duration: durationProp,
  isStreaming = false,
  onOpenChange,
  open,
  ...props
}: ReasoningProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [liveDuration, setLiveDuration] = useState<number | undefined>(durationProp);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const setIsOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (durationProp != null) {
      setLiveDuration(durationProp);
    }
  }, [durationProp]);

  useEffect(() => {
    if (!isStreaming) {
      setIsOpen(false);
      return;
    }

    setIsOpen(true);

    const startedAt = Date.now();
    setLiveDuration(0);

    const interval = window.setInterval(() => {
      setLiveDuration(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => {
      window.clearInterval(interval);
      setLiveDuration(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    };
  }, [isStreaming]);

  const value = useMemo<ReasoningContextValue>(
    () => ({
      duration: durationProp ?? liveDuration,
      isOpen,
      isStreaming,
      setIsOpen,
    }),
    [durationProp, isOpen, isStreaming, liveDuration]
  );

  return (
    <ReasoningData.Provider value={value}>
      <Collapsible onOpenChange={setIsOpen} open={isOpen} {...props}>
        <div
          className={cn(
            "w-full rounded-[20px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.018))] shadow-[0_16px_36px_-28px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm",
            className
          )}
        >
          {children}
        </div>
      </Collapsible>
    </ReasoningData.Provider>
  );
};

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

export const ReasoningTrigger = ({
  children,
  className,
  getThinkingMessage,
  ...props
}: ReasoningTriggerProps) => {
  const { duration, isOpen, isStreaming } = useReasoning();
  const durationLabel = formatDuration(duration);

  const defaultLabel = getThinkingMessage?.(isStreaming, duration) ?? (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] border border-white/6 bg-[linear-gradient(180deg,rgba(157,176,255,0.12),rgba(157,176,255,0.05))] text-[#aab8ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          {isStreaming ? <Spinner className="size-3.5 text-[#aab8ff]" /> : <BrainCircuit className="size-3.5 text-[#aab8ff]" />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium tracking-[-0.02em] text-white/90">
            {isStreaming ? "Reasoning" : "Thought process"}
          </div>
          <div className="pt-0.5 text-[10.5px] text-white/36">
            Reasoning notes
          </div>
        </div>
      </div>
    </>
  );

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-3.5 px-3.5 py-3 text-left transition hover:bg-white/[0.018]",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {children ?? defaultLabel}
        {durationLabel ? (
          <span className="shrink-0 rounded-full border border-white/8 bg-white/[0.03] px-2.25 py-0.75 text-[9.5px] font-medium tabular-nums text-white/48 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
            {durationLabel}
          </span>
        ) : null}
      </div>
      <span className="inline-flex size-7.5 shrink-0 items-center justify-center rounded-full border border-white/6 bg-white/[0.03] text-white/34 transition">
        <ChevronDown
          className={cn(
            "size-3.25 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </span>
    </CollapsibleTrigger>
  );
};

export type ReasoningContentProps = Omit<ComponentProps<typeof CollapsibleContent>, "children"> & {
  children: string;
};

export const ReasoningContent = ({
  children,
  className,
  ...props
}: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn("overflow-hidden border-t border-white/6 px-3.5 pb-3.5 pt-2.5", className)}
    {...props}
  >
    <MessageResponse className="text-[13px] leading-[1.7] text-white/66 [&_p]:my-1 [&_p+_p]:mt-1.5 [&_[data-streamdown='inline-code']]:bg-white/[0.03] [&_[data-streamdown='inline-code']]:text-white/78 [&_pre]:text-[12.5px]">
      {children}
    </MessageResponse>
  </CollapsibleContent>
);

export type ReasoningBodyProps = HTMLAttributes<HTMLDivElement>;

export const ReasoningBody = ({ className, ...props }: ReasoningBodyProps) => (
  <div className={cn("px-3.5 py-3", className)} {...props} />
);
