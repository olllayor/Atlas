import { Copy, Download, Trash2 } from 'lucide-react';
import type { ThemeAppearance, ThemeCardDefinition } from '../../../shared/themePalettes';
import { ThemePreviewCircles } from './ThemePreviewCircles';

export function ThemeLibraryCard({
  theme,
  activeModes,
  onSelectTheme,
  onSelectMode,
  onDuplicate,
  onDownload,
  onRemove,
}: {
  theme: ThemeCardDefinition;
  activeModes: ReadonlyArray<ThemeAppearance>;
  onSelectTheme: (themeId: string) => void;
  onSelectMode: (themeId: string, mode: ThemeAppearance) => void;
  onDuplicate?: (themeId: string) => void;
  onDownload?: (themeId: string) => void;
  onRemove?: (themeId: string) => void;
}) {
  const isPartiallyActive = activeModes.length > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectTheme(theme.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectTheme(theme.id);
        }
      }}
      style={isPartiallyActive ? { boxShadow: 'inset 0 0 0 1px var(--ring)' } : undefined}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border p-2 transition-all cursor-pointer select-none ${
        isPartiallyActive
          ? 'border-transparent bg-[var(--accent-surface)]/20 shadow-sm'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)]'
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]`}
    >
      <ThemePreviewCircles
        label={theme.label}
        activeModes={activeModes}
        onSelectMode={(mode) => onSelectMode(theme.id, mode)}
        previews={theme.previews}
      />

      <div className="mt-2 flex items-center justify-between px-2 pb-1">
        <span
          className={`text-xs font-medium truncate ${
            isPartiallyActive ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'
          }`}
        >
          {theme.label}
        </span>

        <div className="flex items-center gap-1">
          {onDuplicate && (
            <button
              type="button"
              aria-label={`Duplicate ${theme.label} theme`}
              title="Duplicate theme"
              className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(theme.id);
              }}
            >
              <Copy className="size-3" />
            </button>
          )}

          {onDownload && (
            <button
              type="button"
              aria-label={`Export ${theme.label} theme`}
              title="Export theme JSON"
              className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onDownload(theme.id);
              }}
            >
              <Download className="size-3" />
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              aria-label={`Delete ${theme.label} theme`}
              title="Delete theme"
              className="flex size-6 items-center justify-center rounded-md text-[var(--error)] opacity-0 transition-opacity hover:bg-[var(--error-surface)] hover:text-[var(--error)] group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(theme.id);
              }}
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
