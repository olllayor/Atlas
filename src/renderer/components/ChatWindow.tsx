import { useEffect, useMemo, useRef } from 'react';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

import type { ConversationDetail } from '../../shared/contracts';
import type { DraftStateLike } from './types';

type ChatWindowProps = {
  detail: ConversationDetail | null;
  draft: DraftStateLike | null;
  hasCredential: boolean;
  onOpenSettings: () => void;
};

export function ChatWindow({ detail, draft, hasCredential, onOpenSettings }: ChatWindowProps) {
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const items = useMemo(() => {
    if (!detail) return [];
    return [...detail.messages];
  }, [detail]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items, draft?.content]);

  if (!detail) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h2 className="text-2xl font-semibold text-white">What can I help with?</h2>
        <p className="mt-2 text-sm text-slate-500">Start a new conversation or select one from the sidebar.</p>
      </div>
    );
  }

  const showSetupPrompt = !hasCredential && items.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showSetupPrompt ? (
        <div className="mx-auto w-full max-w-2xl rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
          <h2 className="text-lg font-medium text-white">Add your API key to start</h2>
          <p className="mt-2 text-sm text-slate-400">
            Credentials are stored in your OS keychain. Nothing leaves your machine.
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
          >
            Open Settings
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] space-y-6 px-6 py-6">
          {items.map((message) => {
            const isAssistant = message.role === 'assistant';
            return (
              <div key={message.id} className={`flex ${isAssistant ? '' : 'justify-end'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isAssistant
                      ? 'bg-white/[0.04] text-slate-100'
                      : 'bg-white/10 text-white'
                  }`}
                >
                  <div className="markdown-body text-sm leading-7">
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{message.content}</ReactMarkdown>
                  </div>
                  {message.status === 'complete' && message.latencyMs != null && (
                    <p className="mt-2 text-[11px] text-slate-600">
                      {message.latencyMs}ms
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {draft && (
            <div className="flex">
              <div className="max-w-[85%] rounded-2xl bg-white/[0.04] px-4 py-3 text-slate-100">
                <div className="markdown-body text-sm leading-7">
                  <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                    {draft.content || (draft.status === 'streaming' ? '_Thinking..._' : `_${draft.errorMessage ?? 'Stopped.'}_`)}
                  </ReactMarkdown>
                </div>
                {draft.status === 'streaming' && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 [animation-delay:300ms]" />
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={scrollAnchorRef} />
        </div>
      </div>
    </div>
  );
}
