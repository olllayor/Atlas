"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

/**
 * The transcript's empty state.
 *
 * `Conversation`, `ConversationContent`, `ConversationScrollButton`,
 * `ConversationDownload` and `messagesToMarkdown` used to live here with
 * no importers — `ChatWindow` implements its own sticky-scroll container
 * and jump-to-latest button — so only the empty state remains.
 */

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-text-muted">{icon}</div>}
        <div className="space-y-1">
          <h3 className="text-base font-medium text-text-primary">{title}</h3>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
      </>
    )}
  </div>
);
