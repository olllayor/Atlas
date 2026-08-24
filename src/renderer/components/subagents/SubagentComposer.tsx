import { ArrowUp, Lock, Square } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { SubagentComposerTakeover } from '../../hooks/useSubagentComposerState';
import { SUBAGENT_INTERRUPT_ONLY_HINT } from '../../hooks/useSubagentComposerState';

type TakenOverComposer = Exclude<SubagentComposerTakeover, { mode: 'normal' }>;

type SubagentComposerProps = {
  takeover: TakenOverComposer;
  /** Queues one followup turn; resolves at inbox acceptance. */
  onSend: (text: string) => Promise<void>;
  /** Interrupts the child's current turn without discarding its queue. */
  onStop: () => void;
};

const STOP_BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border-default px-3 text-xs text-text-secondary transition hover:border-border-strong hover:text-text-primary';

/**
 * The composer slab a subagent conversation gets instead of the ordinary one.
 *
 * Same outer geometry as `Composer` (full-bleed row, centered max-width slab)
 * so the dock height and column alignment do not jump between the two, but
 * deliberately smaller inside: subagent turns reuse the composition captured
 * in their descriptor, so there are no attachments, model picking or access
 * chips here — only the FIFO queue's front door.
 */
export function SubagentComposer({ takeover, onSend, onStop }: SubagentComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  const syncHeight = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    syncHeight();
  }, [syncHeight, value]);

  const canSend = Boolean(value.trim()) && !sending;

  const submit = useCallback(async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      await onSend(value.trim());
      // Accepted into the inbox — the transcript poll owns it from here.
      setValue('');
    } catch {
      // Keep the text so the failed send can be retried.
    } finally {
      setSending(false);
    }
  }, [canSend, onSend, sending, value]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (isComposing || event.nativeEvent.isComposing) return;
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="px-5 pb-3 lg:px-6">
      <div className="mx-auto max-w-content-max">
        <div className="composer-slab rounded-composer bg-bg-composer px-3.5 pb-2.5 pt-3">
          {takeover.mode === 'readOnly' ? (
            <div className="flex items-center gap-2 px-1 py-1 text-sm text-text-muted">
              <Lock aria-hidden className="size-4 shrink-0" />
              <span>{takeover.reason}</span>
            </div>
          ) : null}

          {takeover.mode === 'interruptOnly' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-0.5">
              <span className="min-w-0 flex-1 text-sm text-text-muted">{SUBAGENT_INTERRUPT_ONLY_HINT}</span>
              <button type="button" onClick={onStop} className={STOP_BUTTON}>
                <Square className="size-3 fill-current" />
                Stop
              </button>
            </div>
          ) : null}

          {takeover.mode === 'live' ? (
            <>
              <div className="relative px-1 pt-0.5">
                <textarea
                  ref={textareaRef}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  rows={1}
                  aria-label="Message this agent"
                  placeholder={takeover.running ? 'Queued as its next turn…' : 'Message this agent'}
                  className="max-h-composer-max-height min-h-6 w-full resize-none border-0 bg-transparent px-0 py-1 text-md leading-6 text-text-primary shadow-none outline-none ring-0 placeholder:text-text-muted focus-visible:outline-none"
                />
              </div>
              <div className="-mx-1.5 flex items-center gap-1 pt-1.5">
                {takeover.running ? (
                  <button type="button" onClick={onStop} className={`${STOP_BUTTON} ml-0.5`}>
                    <Square className="size-3 fill-current" />
                    Stop
                  </button>
                ) : null}

                <div className="ml-auto">
                  <button
                    type="button"
                    aria-label="Send message"
                    aria-disabled={!canSend}
                    onClick={() => void submit()}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-button text-text-inverse transition hover:bg-bg-button-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-bg-button"
                  >
                    <ArrowUp className="size-4.5" strokeWidth={2.25} />
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
