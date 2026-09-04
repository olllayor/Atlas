import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Quote } from 'lucide-react';

import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  createAssistantCitation,
  type AssistantCitation,
} from '../../shared/citations';
import { captureCiteSelection, type CiteSourceAnchor } from '../lib/citeSelection';
import { cn } from '../lib/utils';

type CiteToolbarProps = {
  viewport: HTMLElement | null;
  conversationId: string | null;
  onCite: (citation: AssistantCitation, anchor: CiteSourceAnchor) => void;
};

type ToolbarSelection = {
  citation: AssistantCitation | null;
  anchor: CiteSourceAnchor;
  x: number;
  y: number;
};

/** Delay so double/triple-click word/paragraph selections settle before capture. */
const MULTI_CLICK_DELAY_MS = 500;

/**
 * Floating Cite pill for transcript selections.
 *
 * Shows only for selections captured inside an assistant message source.
 * Overlong selections render disabled with a shorten hint instead of silently
 * truncating. Dismisses on scroll, Escape, right-click, or selection loss.
 */
export function CiteToolbar({ viewport, conversationId, onCite }: CiteToolbarProps) {
  const [selection, setSelection] = useState<ToolbarSelection | null>(null);
  const toolbarRef = useRef<HTMLButtonElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const onCiteRef = useRef(onCite);
  onCiteRef.current = onCite;

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    let timer: number | null = null;
    let frame: number | null = null;

    const clear = () => setSelection(null);

    const update = () => {
      if (!conversationId) {
        clear();
        return;
      }
      const captured = captureCiteSelection(viewport, window.getSelection());
      if (!captured) {
        clear();
        return;
      }
      const rangeRect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (
        rangeRect.bottom < viewportRect.top ||
        rangeRect.top > viewportRect.bottom ||
        rangeRect.width === 0
      ) {
        clear();
        return;
      }
      const citation = createAssistantCitation({
        conversationId,
        messageId: captured.messageId,
        ...captured.selector,
      });
      // Null means the capture failed validation, almost always overlong
      // text. Blank selections never reach here; capture rejects them.
      const tooLong = citation === null && captured.selector.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
      if (citation === null && !tooLong) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const lastRect = rects.item(rects.length - 1) ?? rangeRect;
      const pointer = pointerRef.current;
      setSelection({
        citation,
        anchor: { source: captured.source, range: captured.range, viewport },
        x: pointer?.x ?? lastRect.right,
        y: (pointer?.y ?? lastRect.bottom) + 4,
      });
    };

    const schedule = (delay: number) => {
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      timer = window.setTimeout(() => {
        timer = null;
        frame = window.requestAnimationFrame(() => {
          frame = null;
          update();
        });
      }, delay);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (!viewport.contains(event.target as Node)) return;
      schedule(event.detail >= 2 ? MULTI_CLICK_DELAY_MS : 0);
    };
    const onSelectionChange = () => {
      // Mouse drags report through mouseup; keyboard selections arrive here.
      schedule(0);
    };
    const onScroll = () => clear();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    const onContextMenu = () => clear();
    // Tab reaches the pill without a pointer: t3code parity for keyboard users.
    const onTabFocus = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== 'Tab' ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.disabled ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      setSelection((current) => {
        if (!current) return current;
        event.preventDefault();
        event.stopPropagation();
        toolbar.focus({ preventScroll: true });
        return current;
      });
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onTabFocus, true);
    viewport.addEventListener('scroll', onScroll, { capture: true, passive: true });
    viewport.addEventListener('keydown', onKeyDown);
    viewport.addEventListener('contextmenu', onContextMenu);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onTabFocus, true);
      viewport.removeEventListener('scroll', onScroll, { capture: true });
      viewport.removeEventListener('keydown', onKeyDown);
      viewport.removeEventListener('contextmenu', onContextMenu);
    };
  }, [viewport, conversationId]);

  if (!selection || !conversationId) return null;
  const tooLong = selection.citation === null;
  const cite = () => {
    if (!selection.citation) return;
    onCiteRef.current(selection.citation, selection.anchor);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  return createPortal(
    <button
      ref={toolbarRef}
      type="button"
      disabled={tooLong}
      aria-label={tooLong ? 'Selection is too long to cite' : 'Cite selection in composer'}
      onPointerDown={(event) => event.preventDefault()}
      onClick={cite}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          setSelection(null);
        }
      }}
      style={{ left: selection.x, top: selection.y }}
      className={cn(
        'fixed z-50 inline-flex h-7 max-w-[calc(100vw-1rem)] items-center gap-1.5 rounded-full border border-border-subtle bg-bg-overlay px-2.5 text-2xs text-text-secondary shadow-elevated transition-colors hover:text-text-primary',
        tooLong && 'cursor-not-allowed opacity-70 hover:text-text-secondary',
      )}
    >
      <Quote aria-hidden className="size-3.5" />
      <span>{tooLong ? 'Shorten selection' : 'Cite'}</span>
    </button>,
    document.body,
  );
}
