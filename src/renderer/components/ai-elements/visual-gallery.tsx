import { useEffect, useMemo, useState } from 'react';
import { Search, X, Trash2, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SavedVisual } from '../../../shared/contracts';
import { detectDiagramSpec } from './interactive-diagram';
import { detectRiveContent } from './rive-visual';

type VisualGalleryProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (visual: SavedVisual) => void;
};

export function VisualGallery({ isOpen, onClose, onSelect }: VisualGalleryProps) {
  const [visuals, setVisuals] = useState<SavedVisual[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVisual, setSelectedVisual] = useState<SavedVisual | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadVisuals = async (query?: string) => {
    setIsLoading(true);
    try {
      const results = query
        ? await window.atlasChat.visuals.search(query)
        : await window.atlasChat.visuals.list(100);
      setVisuals(results);
    } catch (e) {
      console.error('Failed to load visuals:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadVisuals(searchQuery || undefined);
    }
  }, [isOpen]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    loadVisuals(query || undefined);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.atlasChat.visuals.delete(id);
    setVisuals((prev) => prev.filter((v) => v.id !== id));
    if (selectedVisual?.id === id) {
      setSelectedVisual(null);
    }
  };

  const visualType = (content: string) => {
    if (detectDiagramSpec(content)) return 'Diagram';
    if (detectRiveContent(content)) return 'Animation';
    return 'Chart';
  };

  const typeBadgeColor = (type: string) => {
    switch (type) {
      case 'Diagram':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Animation':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      default:
        return 'bg-green-500/10 text-green-400 border-green-500/20';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex h-[80vh] w-[90vw] max-w-5xl flex-col rounded-2xl border border-border/50 bg-bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Visual Gallery</h2>
            <p className="text-xs text-text-muted">Browse and reuse your saved visuals</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-text-muted transition hover:bg-bg-hover hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border/50 px-6 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search visuals..."
              className="w-full rounded-lg border border-border/50 bg-bg-base py-2 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Visual list */}
          <div className="w-80 border-r border-border/50 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-text-muted" />
              </div>
            ) : visuals.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-muted">
                <p className="text-sm">No saved visuals yet</p>
                <p className="text-xs">Generate and save visuals from conversations</p>
              </div>
            ) : (
              <div className="p-2">
                {visuals.map((visual) => (
                  <button
                    key={visual.id}
                    onClick={() => setSelectedVisual(visual)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                      selectedVisual?.id === visual.id
                        ? 'bg-bg-hover'
                        : 'hover:bg-bg-subtle'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {visual.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                            typeBadgeColor(visualType(visual.content))
                          )}
                        >
                          {visualType(visual.content)}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {new Date(visual.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(visual.id, e)}
                      className="rounded p-1 text-text-muted opacity-0 transition hover:text-error-text hover:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="flex-1 overflow-y-auto p-6">
            {selectedVisual ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-text-primary">
                      {selectedVisual.title}
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      {visualType(selectedVisual.content)} · Saved {new Date(selectedVisual.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => onSelect(selectedVisual)}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent/90"
                  >
                    <Eye className="h-4 w-4" />
                    Insert into conversation
                  </button>
                </div>
                <div className="rounded-xl border border-border/50 bg-bg-subtle/35 overflow-hidden">
                  <iframe
                    srcDoc={selectedVisual.content}
                    sandbox="allow-scripts"
                    className="w-full min-h-[400px] border-0"
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
      </div>
    </div>
  );
}
