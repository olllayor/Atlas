"use client";

import { cn } from "@/lib/utils";
import { loadMessageRenderingModule } from "@/lib/messageRendering";
import { Suspense, lazy, memo } from "react";

/**
 * Markdown rendering for message bodies.
 *
 * This file used to carry a full message-chrome kit — `Message`,
 * `MessageContent`, `MessageActions`, `MessageAction`, `MessageToolbar`
 * and a seven-component `MessageBranch*` pager — none of which had a
 * single importer. `ChatWindow` composes its own message rows and only
 * ever needed `MessageResponse`, so the rest is gone.
 */

const LazyMessageResponseContent = lazy(loadMessageRenderingModule);

export type MessageResponseProps = {
  children?: string;
  className?: string;
  isAnimating?: boolean;
};

/**
 * Shown until the markdown module resolves. Rendering the raw text keeps
 * the content readable during the swap instead of flashing empty.
 */
function PlainMessageResponse({ children, className }: Pick<MessageResponseProps, "children" | "className">) {
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {children ?? ''}
    </div>
  );
}

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Suspense fallback={<PlainMessageResponse className={className}>{props.children}</PlainMessageResponse>}>
      <LazyMessageResponseContent className={className} {...props} />
    </Suspense>
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";
