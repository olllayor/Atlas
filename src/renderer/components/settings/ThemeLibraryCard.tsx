import { Check, Copy, Pencil, Upload, Trash2 } from 'lucide-react';
import type { ThemeAppearance, ThemeCardDefinition, ThemeDefinition } from '../../../shared/themePalettes';
import { ThemePreviewCircles } from './ThemePreviewCircles';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { getVariantShortLabel } from '../../lib/themePalette';

export function ThemeLibraryCard({
  theme,
  activeModes,
  onSelectTheme,
  onSelectMode,
  variants,
  activeVariantId,
  onSelectVariant,
  onDuplicate,
  onEdit,
  onDownload,
  onRemove,
}: {
  theme: ThemeCardDefinition;
  activeModes: ReadonlyArray<ThemeAppearance>;
  onSelectTheme: () => void;
  onSelectMode: (mode: ThemeAppearance) => void;
  variants?: ReadonlyArray<ThemeDefinition>;
  activeVariantId?: string;
  onSelectVariant?: (variantId: string) => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDownload?: () => void;
  onRemove?: () => void;
}) {
  const isPartiallyActive = activeModes.length > 0;
  const hasMultipleVariants = Boolean(variants && variants.length > 1);
  const currentVariant = variants?.find((v) => v.id === activeVariantId) ?? variants?.[0];
  const shortLabel = currentVariant ? getVariantShortLabel(currentVariant.label, theme.label) : '';
  const otherCount = variants ? variants.length - 1 : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectTheme()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectTheme();
        }
      }}
      style={isPartiallyActive ? { boxShadow: 'inset 0 0 0 1px var(--ring)' } : undefined}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border p-2 transition-all cursor-pointer select-none ${
        isPartiallyActive
          ? 'border-transparent bg-[var(--accent-surface)]/20 shadow-sm'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)]'
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]`}
    >
      <div className="flex flex-col items-center">
        <ThemePreviewCircles
          label={theme.label}
          activeModes={activeModes}
          onSelectMode={(mode) => onSelectMode(mode)}
          previews={theme.previews}
        />

        {hasMultipleVariants && currentVariant && (
          <div className="mt-1 mb-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-2xs transition-colors hover:border-[var(--border-medium)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <span className="truncate max-w-28">{shortLabel}</span>
                  <span className="rounded-full bg-[var(--bg-elevated)] px-1 py-0.2 text-[9px] font-semibold text-[var(--text-muted)] border border-[var(--border-subtle)]">
                    +{otherCount}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="min-w-44 max-h-56 overflow-y-auto">
                {variants?.map((v) => {
                  const isSelected = v.id === currentVariant.id;
                  return (
                    <DropdownMenuItem
                      key={v.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectVariant?.(v.id);
                      }}
                      className="flex items-center justify-between text-xs cursor-pointer"
                    >
                      <span className="truncate">{v.label}</span>
                      {isSelected ? <Check className="size-3 text-[var(--accent)] ml-2 shrink-0" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between px-2 pb-1">
        <span
          className={`text-xs font-medium truncate ${
            isPartiallyActive ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'
          }`}
          title={theme.label}
        >
          {theme.label}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {onDuplicate && (
            <button
              type="button"
              aria-label={`Duplicate ${theme.label} theme`}
              title="Duplicate theme"
              className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
            >
              <Copy className="size-3.5" />
            </button>
          )}

          {onEdit && (
            <button
              type="button"
              aria-label={`Edit ${theme.label} theme`}
              title="Edit theme"
              className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Pencil className="size-3.5" />
            </button>
          )}

          {onDownload && (
            <button
              type="button"
              aria-label={`Export ${theme.label} theme`}
              title="Export theme JSON"
              className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
            >
              <Upload className="size-3.5" />
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              aria-label={`Delete ${theme.label} theme`}
              title="Delete theme"
              className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--error-surface)] hover:text-[var(--error)] cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
