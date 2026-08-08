import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, Undo2, Eye } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SavedVisual } from '../../../shared/contracts';
import { buildVisualSrcDoc } from '../../../shared/visualDocument';
import { detectRequiredLibraries } from '../../../shared/visualParser';
import { chartJs, d3Js } from '../../visual/bundles';
import { detectDiagramSpec } from '../../../shared/diagramSpec';
import { detectRiveContent } from './rive-visual';
import { readThemeTokens } from './visual';

type VisualGalleryProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (visual: SavedVisual) => void;
};

/** How long a deleted visual stays undoable before the delete is committed. */
const UNDO_WINDOW_MS = 6000;
const SEARCH_DEBOUNCE_MS = 250;

type VisualType = 'Diagram' | 'Animation' | 'Chart';

function visualType(content: string): VisualType {
  if (detectDiagramSpec(content)) return 'Diagram';
  if (detectRiveContent(content)) return 'Animation';
  return 'Chart';
}

/**
 * Distinct per type. All three branches used to return identical classes,
 * so the badge carried no information the label did not already carry —
 * either differentiate it or drop it, and differentiating is cheap.
 */
const TYPE_BADGE: Record<VisualType, string> = {
  Diagram: 'border-[var(--accent)]/35 bg-[var(--accent-surface)] text-[var(--accent)]',
  Animation: 'border-[var(--warning)]/35 text-[var(--warning)]',
  Chart: 'border-border-default bg-bg-elevated text-text-secondary',
};

export function VisualGallery({ isOpen, onClose, onSelect }: VisualGalleryProps) {
  const [visuals, setVisuals] = useState<SavedVisual[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVisual, setSelectedVisual] = useState<SavedVisual | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  /** The visual currently sitting in the undo window, if any. */
  const [pendingDelete, setPendingDelete] = useState<SavedVisual | null>(null);

  /**
   * Monotonic request id. Search fired one IPC call per keystroke with no
   * ordering guarantee, so a slow `d` could land after a fast `dashboard`
   * and repopulate the list with stale results.
   */
  const requestSeq = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadVisuals = useCallback(async (query?: string) => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    try {
      const results = query
        ? await window.atlasChat.visuals.search(query)
        : await window.atlasChat.visuals.list(100);
      if (seq !== requestSeq.current) return;
      setVisuals(results);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      console.error('Failed to load visuals:', e);
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, []);

  // Debounced: one query 250ms after typing stops, not one per keystroke.
  // `searchQuery` is in the dependency list now — its absence was why
  // reopening the gallery could re-run a stale query.
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(
      () => {
        void loadVisuals(searchQuery.trim() || undefined);
      },
      searchQuery ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [isOpen, searchQuery, loadVisuals]);

  // Clear transient state when the dialog closes so it never reopens
  // mid-undo or mid-search.
  useEffect(() => {
    if (isOpen) return;
    setSearchQuery('');
    setPendingDelete(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  const commitDelete = useCallback(async (visual: SavedVisual) => {
    try {
      await window.atlasChat.visuals.delete(visual.id);
    } catch (e) {
      console.error('Failed to delete visual:', e);
      // Put it back rather than lying about the outcome.
      setVisuals((prev) =>
        prev.some((item) => item.id === visual.id) ? prev : [visual, ...prev]
      );
    }
  }, []);

  /**
   * Delete had no confirmation of any kind. Rather than a modal on top of a
   * modal, the row leaves immediately and an undo bar holds the deletion
   * for a few seconds — reversible beats confirmable.
   */
  const requestDelete = useCallback(
    (visual: SavedVisual) => {
      // A second delete during an open undo window commits the first.
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setPendingDelete((previous) => {
        if (previous && previous.id !== visual.id) void commitDelete(previous);
        return visual;
      });

      setVisuals((prev) => prev.filter((item) => item.id !== visual.id));
      setSelectedVisual((current) => (current?.id === visual.id ? null : current));

      undoTimer.current = setTimeout(() => {
        setPendingDelete((current) => {
          if (current) void commitDelete(current);
          return null;
        });
      }, UNDO_WINDOW_MS);
    },
    [commitDelete]
  );

  const undoDelete = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setPendingDelete((visual) => {
      if (visual) {
        setVisuals((prev) =>
          prev.some((item) => item.id === visual.id)
            ? prev
            : [visual, ...prev].sort(
                (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
              )
        );
      }
      return null;
    });
  }, []);

  // Preview goes through the same document builder the transcript uses, so
  // a saved visual previews with the app's theme and its required libraries
  // rather than as raw, unstyled HTML.
  const previewSrcDoc = useMemo(() => {
    if (!selectedVisual) return '';
    const detected = detectRequiredLibraries(selectedVisual.content);
    const libraries: string[] = [];
    if (detected.includes('chartjs')) libraries.push(chartJs);
    if (detected.includes('d3')) libraries.push(d3Js);

    return buildVisualSrcDoc({
      visualId: `gallery-${selectedVisual.id}`,
      content: selectedVisual.content,
      theme: readThemeTokens(),
      libraries,
    });
  }, [selectedVisual]);

  const isSearching = searchQuery.trim().length > 0;

  return (
    // Radix Dialog: focus trap, focus restore, scroll lock, Esc and
    // backdrop dismissal all come for free. The hand-rolled overlay had a
    // global keydown listener and none of the rest.
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border-default px-6 py-4">
          <DialogTitle className="text-lg font-semibold text-text-primary">
            Visual Gallery
          </DialogTitle>
          <DialogDescription className="text-xs text-text-muted">
            Browse and reuse your saved visuals
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border-default px-6 py-3">
          <div className="relative">
            <Search
              aria-hidden
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search visuals..."
              aria-label="Search visuals"
              className="w-full rounded-lg border border-border-default bg-bg-base py-2 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="scrollbar-auto-hide w-80 overflow-y-auto border-r border-border-default">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-text-muted" />
              </div>
            ) : visuals.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-text-muted">
                {/*
                  Zero search results is not the same state as an empty
                  gallery — telling someone to "generate and save visuals"
                  when they already have twenty is simply wrong.
                */}
                {isSearching ? (
                  <>
                    <p className="text-sm">No visuals match “{searchQuery.trim()}”</p>
                    <p className="text-xs">Try a different search term</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm">No saved visuals yet</p>
                    <p className="text-xs">Generate and save visuals from conversations</p>
                  </>
                )}
              </div>
            ) : (
              <div className="p-2">
                {visuals.map((visual) => {
                  const type = visualType(visual.content);
                  const isSelected = selectedVisual?.id === visual.id;

                  return (
                    // The row is a flex container, not a button. Delete used
                    // to be a <button> nested inside the row <button>, which
                    // is invalid HTML — browsers reparent it and the click
                    // target becomes undefined behaviour.
                    <div
                      key={visual.id}
                      className={cn(
                        'group flex w-full items-center gap-2 rounded-lg transition',
                        isSelected ? 'bg-bg-hover' : 'hover:bg-bg-subtle'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedVisual(visual)}
                        aria-current={isSelected}
                        className="min-w-0 flex-1 cursor-pointer rounded-lg px-3 py-2.5 text-left"
                      >
                        <div className="truncate text-sm font-medium text-text-primary">
                          {visual.title}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-3xs font-medium',
                              TYPE_BADGE[type]
                            )}
                          >
                            {type}
                          </span>
                          <span className="text-3xs text-text-muted">
                            {new Date(visual.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => requestDelete(visual)}
                            aria-label={`Delete ${visual.title}`}
                            // 28px hit target, revealed by focus as well as
                            // hover — the old one had no `group` ancestor at
                            // all, so it never appeared.
                            className="mr-2 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted opacity-0 transition hover:bg-bg-hover hover:text-error-text focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Delete {visual.title}</TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="scrollbar-auto-hide flex-1 overflow-y-auto p-6">
            {selectedVisual ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-text-primary">
                      {selectedVisual.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {visualType(selectedVisual.content)} · Saved{' '}
                      {new Date(selectedVisual.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(selectedVisual)}
                    className="btn-primary inline-flex shrink-0 cursor-pointer items-center gap-2 px-4 py-2 text-sm"
                  >
                    <Eye className="h-4 w-4" />
                    Insert into conversation
                  </button>
                </div>
                <div className="overflow-hidden rounded-xl border border-border-default bg-bg-elevated">
                  <iframe
                    key={selectedVisual.id}
                    srcDoc={previewSrcDoc}
                    sandbox="allow-scripts"
                    title={`Preview of ${selectedVisual.title}`}
                    className="min-h-[400px] w-full border-0"
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-text-muted">
                <p className="text-sm">Select a visual to preview</p>
              </div>
            )}
          </div>
        </div>

        {pendingDelete && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 border-t border-border-default bg-bg-elevated px-6 py-3"
          >
            <span className="min-w-0 truncate text-sm text-text-secondary">
              Deleted “{pendingDelete.title}”
            </span>
            <button
              type="button"
              onClick={undoDelete}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border-default px-3 text-xs font-medium text-text-primary transition hover:bg-bg-hover"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
