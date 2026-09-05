import { MoonIcon, SunIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  THEME_PREVIEW_RENDER_SPECS,
  type ThemeAppearance,
  type ThemeCardDefinition,
  type ThemePreviewRole,
} from '../../../shared/themePalettes';

export type ThemeCardPreviewColors = Readonly<Record<ThemePreviewRole, string>>;

function getThemePreviewStyle(
  colors: ThemeCardPreviewColors,
  mode: ThemeAppearance
): CSSProperties {
  const spec = THEME_PREVIEW_RENDER_SPECS[mode];
  const modeBase = `color-mix(in oklab, ${colors.canvas} ${spec.baseWeight * 100}%, ${spec.baseTarget})`;
  const accentPosition = `${spec.accent.center[0] * 100}% ${spec.accent.center[1] * 100}%`;
  const actionPosition = `${spec.action.center[0] * 100}% ${spec.action.center[1] * 100}%`;

  return {
    backgroundColor: modeBase,
    backgroundImage: [
      `radial-gradient(circle at ${accentPosition} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accent.middleOpacity * 100}%, transparent) ${spec.accent.middleOffset * 100}%, transparent ${spec.accent.endOffset * 100}%)`,
      `radial-gradient(circle at ${actionPosition} in oklab, color-mix(in oklab, ${colors.messageAction} ${spec.action.startOpacity * 100}%, transparent) 0%, transparent ${spec.action.endOffset * 100}%)`,
    ].join(', '),
  };
}

function themePreviewEdgeShadow(mode: ThemeAppearance): string {
  return mode === 'dark'
    ? 'inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)'
    : 'inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)';
}

export function ThemePreviewCircle({
  colors,
  mode,
}: {
  colors: ThemeCardPreviewColors;
  mode: ThemeAppearance;
}) {
  return (
    <span
      aria-hidden
      className="relative block size-14 shrink-0 overflow-hidden rounded-full border-2 border-[var(--bg-base)]"
      style={{ boxShadow: themePreviewEdgeShadow(mode) }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          ...getThemePreviewStyle(colors, mode),
          filter: `blur(${THEME_PREVIEW_RENDER_SPECS[mode].blurAt56Px}px)`,
          transform: `scale(${THEME_PREVIEW_RENDER_SPECS[mode].scale})`,
        }}
      />
    </span>
  );
}

export function ThemePreviewCircles({
  label,
  activeModes,
  onSelectMode,
  previews,
}: {
  label: string;
  activeModes: ReadonlyArray<ThemeAppearance>;
  onSelectMode: (mode: ThemeAppearance) => void;
  previews: ThemeCardDefinition['previews'];
}) {
  return (
    <div className="flex min-h-16 items-center justify-center gap-3 px-3 pt-3">
      {previews.map((preview) => {
        const mode = preview.mode;
        const isPicked = activeModes.includes(mode);

        return (
          <button
            key={mode}
            aria-label={`Use ${label} for ${mode} mode`}
            title={mode === 'light' ? 'Use for light mode only' : 'Use for dark mode only'}
            type="button"
            className={`relative flex size-[68px] shrink-0 cursor-pointer items-center justify-center rounded-full p-1 outline-none transition-transform ${
              isPicked ? 'scale-100' : 'hover:scale-105'
            } focus-visible:ring-2 focus-visible:ring-[var(--ring)]`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectMode(mode);
            }}
          >
            <ThemePreviewCircle colors={preview.colors} mode={mode} />
            {isPicked ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{ boxShadow: 'inset 0 0 0 2px var(--ring)' }}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                >
                  {mode === 'light' ? (
                    <SunIcon className="size-3 text-warning" />
                  ) : (
                    <MoonIcon className="size-3 text-accent" />
                  )}
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
