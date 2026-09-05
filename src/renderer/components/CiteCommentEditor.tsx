import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH } from '../../shared/citations';
import { cn } from '../lib/utils';

export type CiteCommentAnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CiteCommentEditorProps = {
  initialComment?: string;
  anchor: CiteCommentAnchorRect | null;
  onSave: (comment: string) => void;
  onCancel: () => void;
};

/**
 * Optional-comment popover after a Cite. Anchored to the cited selection's
 * last line; falls back to bottom-center of the window when the range is gone.
 * Enter saves, Shift+Enter breaks the line, Escape cancels. Cancel keeps the
 * citation uncommented — only the comment is discarded.
 */
export function CiteCommentEditor({ initialComment = '', anchor, onSave, onCancel }: CiteCommentEditorProps) {
  const [comment, setComment] = useState(initialComment);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const tooLong = comment.length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH;

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onCancelRef.current();
      }
    };
    // Down, not click: the Cite pill used preventDefault on pointerdown, and a
    // click-only listener would miss the dismissal gesture it started.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const popupWidth = 288;
  const x = anchor
    ? Math.max(8, Math.min(anchor.x, window.innerWidth - popupWidth - 8))
    : Math.max(8, (window.innerWidth - popupWidth) / 2);
  // Prefer below the selection; flip above when space runs out.
  const below = anchor ? anchor.y + anchor.height + 8 : window.innerHeight - 200;
  const y = anchor && below > window.innerHeight - 190 ? Math.max(8, anchor.y - 190) : below;

  const submit = () => {
    if (!tooLong) onSaveRef.current(comment);
  };

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Add an optional comment"
      data-cite-comment-editor="true"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancelRef.current();
        }
      }}
      style={{ left: x, top: Math.max(8, y), width: popupWidth }}
      className="fixed z-50 rounded-lg border border-border-default bg-bg-overlay p-3 shadow-elevated"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={inputRef}
        aria-label="Comment on cited text"
        placeholder="Add an optional comment..."
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        className="block max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
      />
      {tooLong ? (
        <p role="status" className="pt-1 text-xs text-error-text">
          Comments can hold up to {ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString()} characters.
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onCancelRef.current()}
          className="inline-flex h-7 items-center rounded-md border border-border-default px-2.5 text-2xs text-text-secondary transition-colors hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={tooLong}
          onPointerDown={(event) => event.preventDefault()}
          onClick={submit}
          className={cn(
            'inline-flex h-7 items-center rounded-md bg-bg-button px-2.5 text-2xs text-text-inverse transition-opacity hover:opacity-90',
            tooLong && 'cursor-not-allowed opacity-50',
          )}
        >
          {tooLong ? 'Shorten comment' : 'Save'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
