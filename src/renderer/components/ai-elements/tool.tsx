"use client";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CodeBlock } from "@/components/CodeBlock";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  Loader2,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { isValidElement, useMemo } from "react";

import type { DynamicToolUIPart, ToolUIPart } from "ai";

export type ToolPart = ToolUIPart<any> | DynamicToolUIPart;

type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-partial"
  | "output-available"
  | "output-error"
  | "approval-requested"
  | "approval-responded"
  | "output-denied";

type ToolPartLike = {
  type?: string;
  toolName?: string;
  title?: string;
  state?: ToolState;
};

function formatToolName(value?: string) {
  if (!value) {
    return "Tool";
  }

  const normalized = value
    .replace(/^tool-/, "")
    .replace(/^dynamic-tool$/, "dynamic tool")
    .replace(/[_-]+/g, " ")
    .trim();

  if (!normalized) {
    return "Tool";
  }

  return normalized
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatJson(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderNodeOrCode(value: ReactNode | unknown, language = "json") {
  if (isValidElement(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().startsWith("{") || value.trim().startsWith("[") ? (
      <CodeBlock code={value} language={language} />
    ) : (
      <MessageResponse>{value}</MessageResponse>
    );
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return <MessageResponse>{String(value)}</MessageResponse>;
  }

  if (value == null) {
    return null;
  }

  return <CodeBlock code={formatJson(value)} language={language} />;
}

export function getStatusBadge(state: ToolState) {
  switch (state) {
    case "input-streaming":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-tertiary)]"
        >
          <CircleDashed className="size-3 animate-spin" />
          Pending
        </Badge>
      );
    case "input-available":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-tertiary)]"
        >
          <Wrench className="size-3" />
          Running
        </Badge>
      );
    case "approval-requested":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-strong)] bg-[var(--bg-hover)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-secondary)]"
        >
          <ShieldAlert className="size-3" />
          Awaiting Approval
        </Badge>
      );
    case "approval-responded":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-tertiary)]"
        >
          <ArrowRightLeft className="size-3" />
          Responded
        </Badge>
      );
    case "output-available":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-strong)] bg-[var(--bg-hover)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-secondary)]"
        >
          <CheckCircle2 className="size-3" />
          Completed
        </Badge>
      );
    case "output-partial":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-tertiary)]"
        >
          <Loader2 className="size-3 animate-spin" />
          Partial
        </Badge>
      );
    case "output-error":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-strong)] bg-[var(--bg-hover)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-secondary)]"
        >
          <CircleAlert className="size-3" />
          Error
        </Badge>
      );
    case "output-denied":
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-tertiary)]"
        >
          <Ban className="size-3" />
          Denied
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="gap-1.25 border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.25 py-0.75 text-[9.5px] font-normal text-[var(--text-tertiary)]"
        >
          <Loader2 className="size-3 animate-spin" />
          Running
        </Badge>
      );
  }
}

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({
  className,
  defaultOpen = true,
  ...props
}: ToolProps) => (
    <Collapsible
    defaultOpen={defaultOpen}
    className={cn(
      "group/tool w-full overflow-hidden border border-[var(--border-default)] bg-[var(--bg-subtle)]",
      className
    )}
    {...props}
  />
);

type ToolHeaderOwnProps = {
  type: ToolPartLike["type"];
  state: ToolState;
  title?: string;
  toolName?: string;
};

export type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "type"> &
  ToolHeaderOwnProps;

export const ToolHeader = ({
  className,
  type,
  state,
  title,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const resolvedName = useMemo(() => {
    if (title?.trim()) {
      return title.trim();
    }

    if (type === "dynamic-tool") {
      return formatToolName(toolName);
    }

    return formatToolName(type);
  }, [title, toolName, type]);

  const metaLabel = type === "dynamic-tool" ? "Dynamic tool call" : "Tool execution";

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-3.5 px-3.5 py-3 text-left transition hover:bg-[var(--bg-subtle)]",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex size-9 shrink-0 items-center justify-center border border-[var(--border-default)] bg-[var(--bg-hover)] text-[var(--text-tertiary)]">
          <Wrench className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-normal tracking-[-0.02em] text-[var(--text-secondary)]">
            {resolvedName}
          </div>
          <div className="truncate pt-0.5 text-[10.5px] text-[var(--text-faint)]">
            {metaLabel}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {getStatusBadge(state)}
        <span className="inline-flex size-7.5 items-center justify-center border border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-faint)] transition group-hover/tool:text-[var(--text-tertiary)]">
          <ChevronDown className="size-3.25 transition-transform group-data-[state=open]/tool:rotate-180" />
        </span>
      </div>
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn("border-t border-[var(--border-default)] px-3.5 pb-3.5 pt-3", className)}
    {...props}
  />
);

export type ToolInputProps = HTMLAttributes<HTMLDivElement> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  const serialized = useMemo(() => formatJson(input), [input]);

  return (
    <div
      className={cn(
        "border border-[var(--border-default)] bg-[var(--bg-subtle)]",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
        <span className="text-[9.5px] font-normal uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Input
        </span>
      </div>
      <CodeBlock code={serialized} language="json" className="my-0 border-0 bg-transparent" />
    </div>
  );
};

export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
  output?: ReactNode | unknown;
  errorText?: string | null;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (errorText) {
    return (
      <div
        className={cn(
          "border border-[var(--border-strong)] bg-[var(--bg-hover)] px-3 py-3 text-[var(--text-secondary)]",
          className
        )}
        {...props}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--text-secondary)]" />
          <div className="min-w-0">
            <div className="text-[10px] font-normal uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Error
            </div>
            <div className="mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
              {errorText}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (output == null) {
    return null;
  }

  return (
    <div
      className={cn(
        "border border-[var(--border-default)] bg-[var(--bg-subtle)]",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
        <span className="text-[9.5px] font-normal uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Output
        </span>
      </div>
      <div className="px-3 py-2.5 text-[12.5px] leading-[1.65] text-[var(--text-secondary)]">
        {typeof output === "string" ? (
          <MessageResponse>{output}</MessageResponse>
        ) : (
          renderNodeOrCode(output)
        )}
      </div>
    </div>
  );
};
