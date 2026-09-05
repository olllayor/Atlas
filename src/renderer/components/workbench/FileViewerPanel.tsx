/**
 * One file, read-only, as its own surface.
 *
 * Opened from the Files tree, and later from a diff row or a tool call. The
 * path is workspace-relative and main resolves it against the conversation's
 * own root, so the renderer never names a location on disk.
 */

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import type { WorkspaceFileFailure, WorkspaceFileResult } from '../../../shared/contracts';
import { CodeBlock } from '../CodeBlock';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { languageForPath } from './fileTreeModel';

export type FileViewerPanelProps = {
  conversationId: string;
  relativePath: string;
};

/** Each failure gets a sentence that says what to do about it, or that nothing can be. */
const FAILURE_MESSAGE: Record<WorkspaceFileFailure, string> = {
  'no-workspace': 'This conversation has no project folder attached.',
  'outside-root': 'That path is outside the conversation’s workspace.',
  'not-found': 'That file is no longer on disk.',
  'not-a-file': 'That path is not a regular file.',
  binary: 'This file is binary, so there is nothing to show as text.',
  'read-failed': 'That file could not be read.',
};

export function FileViewerPanel({ conversationId, relativePath }: FileViewerPanelProps) {
  const [result, setResult] = useState<WorkspaceFileResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setResult(null);
    setError(null);

    void window.atlasChat.workspace
      .readFile(conversationId, relativePath)
      .then((value) => {
        if (!disposed) setResult(value);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : 'That file could not be read.');
      });

    return () => {
      disposed = true;
    };
  }, [conversationId, relativePath]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-text-faint" title={relativePath}>
          {relativePath}
        </span>
        {result?.ok ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Open in editor"
                onClick={() => void window.atlasChat.workspace.openFile(relativePath)}
                className="rounded p-1 text-text-faint transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in editor</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 scrollbar-auto-hide">
        {error ? (
          <Message body={error} />
        ) : !result ? null : !result.ok ? (
          <Message body={FAILURE_MESSAGE[result.failure]} />
        ) : (
          <>
            <CodeBlock code={result.contents} language={languageForPath(relativePath)} />
            {result.truncated ? (
              <p className="px-2 pt-2 text-xs text-text-faint">
                This file is larger than the viewer reads. The rest is not shown.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Message({ body }: { body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="max-w-[36ch] text-sm leading-relaxed text-text-faint">{body}</p>
    </div>
  );
}
