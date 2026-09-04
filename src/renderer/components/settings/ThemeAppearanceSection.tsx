import { Plus, Sparkles, Undo2 } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  CONTRAST_DEFAULT,
  CONTRAST_MAX,
  CONTRAST_MIN,
  GLASS_OPACITY_DEFAULT,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  type SettingsAppearanceSummary,
  type ThemeMode,
} from '../../../shared/contracts';
import {
  BUILT_IN_THEMES,
  type ThemeAppearance,
  type ThemeCardDefinition,
  type ThemeDefinition,
  getThemeCardDefinition,
  getThemeColorsForAppearance,
  serializeThemeFile,
} from '../../../shared/themePalettes';
import {
  downloadThemeFile,
  getCustomThemes,
  getThemeDefinition,
  removeCustomTheme,
  saveCustomTheme,
  subscribeCustomThemes,
} from '../../lib/themePalette';
import { ThemeImportDialog } from './ThemeImportDialog';
import { ThemeLibraryCard } from './ThemeLibraryCard';
import { ThemeWireframe, type ThemeWireframeColors } from './ThemeWireframe';

export function ThemeAppearanceSection({
  appearance,
  themeMode,
  onThemeModeChange,
  onAppearancePatch,
  notify,
}: {
  appearance: SettingsAppearanceSummary;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  onAppearancePatch: (patch: Partial<SettingsAppearanceSummary>) => void;
  notify: (opts: { tone: 'success' | 'warning' | 'error'; title: string; description?: string }) => void;
}) {
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(getCustomThemes);
  const [isImportOpen, setIsImportOpen] = useState(false);

  useEffect(() => {
    return subscribeCustomThemes(() => {
      setCustomThemes(getCustomThemes());
    });
  }, []);

  const currentThemeId = appearance.themeId || 'default';
  const lightOwner = appearance.themeHalves?.light ?? currentThemeId;
  const darkOwner = appearance.themeHalves?.dark ?? currentThemeId;

  // Build theme cards: Built-in themes (including Atlas) + custom themes
  const themeCards = useMemo<ReadonlyArray<ThemeCardDefinition>>(() => {
    const builtIns = BUILT_IN_THEMES.map(getThemeCardDefinition);
    const customs = customThemes.map(getThemeCardDefinition);
    return [...builtIns, ...customs];
  }, [customThemes]);

  // Helper to extract wireframe colors for light and dark
  const getWireframeColors = (ownerId: string, mode: ThemeAppearance): ThemeWireframeColors => {
    const theme = getThemeDefinition(ownerId) ?? getThemeDefinition('default');
    if (!theme) {
      return {
        sidebar: mode === 'light' ? '#fafafa' : '#0f0f10',
        canvas: mode === 'light' ? '#ffffff' : '#07080b',
        surface: mode === 'light' ? '#f2f4f7' : '#101319',
        accentSurface: mode === 'light' ? '#e2e8f0' : '#1e293b',
        accent: '#2563eb',
        messageSurface: mode === 'light' ? '#ffffff' : '#101319',
        messageAction: mode === 'light' ? '#10131a' : '#2563eb',
      };
    }
    const colors = getThemeColorsForAppearance(theme, mode) ?? theme.colors;
    return {
      sidebar: colors.sidebar,
      canvas: colors.canvas,
      surface: colors.surface,
      accentSurface: colors.accentSurface,
      accent: colors.accent,
      messageSurface: colors.messageSurface,
      messageAction: colors.messageAction,
    };
  };

  const lightWireframe = useMemo(() => getWireframeColors(lightOwner, 'light'), [lightOwner]);
  const darkWireframe = useMemo(() => getWireframeColors(darkOwner, 'dark'), [darkOwner]);

  const handleSelectTheme = (themeId: string) => {
    onAppearancePatch({
      themeId,
      themeHalves: null,
    });
  };

  const handleSelectMode = (themeId: string, mode: ThemeAppearance) => {
    const nextLight = mode === 'light' ? themeId : lightOwner;
    const nextDark = mode === 'dark' ? themeId : darkOwner;

    if (nextLight === nextDark) {
      onAppearancePatch({
        themeId: nextLight,
        themeHalves: null,
      });
    } else {
      onAppearancePatch({
        themeHalves: {
          light: nextLight,
          dark: nextDark,
        },
      });
    }
  };

  const handleDuplicateTheme = (themeId: string) => {
    const themeDef = getThemeDefinition(themeId);
    if (!themeDef) return;

    let counter = 1;
    let newId = `${themeDef.id}-copy`;
    while (customThemes.some((t) => t.id === newId)) {
      newId = `${themeDef.id}-copy-${counter++}`;
    }

    const newTheme: ThemeDefinition = {
      ...themeDef,
      id: newId,
      label: `${themeDef.label} Copy`,
    };

    saveCustomTheme(newTheme);
    handleSelectTheme(newTheme.id);

    try {
      navigator.clipboard.writeText(serializeThemeFile(newTheme));
      notify({
        tone: 'success',
        title: `Duplicated "${themeDef.label}"`,
        description: 'Created new theme and copied its JSON to clipboard.',
      });
    } catch {
      notify({
        tone: 'success',
        title: `Duplicated "${themeDef.label}"`,
      });
    }
  };

  const handleDownloadTheme = (themeId: string) => {
    const themeDef = getThemeDefinition(themeId);
    if (!themeDef) return;
    downloadThemeFile(`${themeDef.id}.json`, serializeThemeFile(themeDef));
    notify({
      tone: 'success',
      title: `Exported ${themeDef.label}`,
      description: `Saved ${themeDef.id}.json`,
    });
  };

  const handleRemoveTheme = (themeId: string) => {
    const themeDef = getThemeDefinition(themeId);
    removeCustomTheme(themeId);
    if (currentThemeId === themeId || lightOwner === themeId || darkOwner === themeId) {
      onAppearancePatch({
        themeId: 'default',
        themeHalves: null,
      });
    }
    notify({
      tone: 'success',
      title: `Deleted ${themeDef?.label ?? 'theme'}`,
    });
  };

  const handleCreateTheme = () => {
    const activeOwner = themeMode === 'light' ? lightOwner : darkOwner;
    const baseTheme = getThemeDefinition(activeOwner) ?? getThemeDefinition('default')!;

    let counter = 1;
    let newId = 'custom-theme';
    while (customThemes.some((t) => t.id === newId)) {
      newId = `custom-theme-${counter++}`;
    }

    const newTheme: ThemeDefinition = {
      ...baseTheme,
      id: newId,
      label: `Custom Theme ${counter > 1 ? counter : ''}`.trim(),
    };

    saveCustomTheme(newTheme);
    handleSelectTheme(newTheme.id);
    notify({
      tone: 'success',
      title: 'Created custom theme',
      description: `New theme "${newTheme.label}" created from ${baseTheme.label}.`,
    });
  };

  // Contrast slider
  const contrastValue = appearance.contrast ?? CONTRAST_DEFAULT;
  const contrastProgress = Math.min(
    100,
    Math.max(0, ((contrastValue - CONTRAST_MIN) / (CONTRAST_MAX - CONTRAST_MIN)) * 100)
  );

  // Glass opacity slider
  const glassOpacityValue = appearance.glassOpacity ?? GLASS_OPACITY_DEFAULT;
  const glassProgress = Math.min(
    100,
    Math.max(0, ((glassOpacityValue - GLASS_OPACITY_MIN) / (GLASS_OPACITY_MAX - GLASS_OPACITY_MIN)) * 100)
  );

  return (
    <div className="space-y-8">
      {/* 1. Color Scheme Wireframe Cards */}
      <div>
        <div className="mb-3">
          <h3 className="text-md font-semibold text-[var(--text-primary)]">Color scheme</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Choose whether Atlas follows your system appearance or stays fixed.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(['system', 'light', 'dark'] as const).map((mode) => {
            const isActive = themeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={isActive}
                onClick={() => onThemeModeChange(mode)}
                className={`group flex flex-col items-center gap-2 rounded-xl border p-2.5 outline-none transition-all cursor-pointer ${
                  isActive
                    ? 'border-[var(--ring)] bg-[var(--accent-subtle)] shadow-sm'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-hover)]'
                }`}
                style={isActive ? { boxShadow: 'inset 0 0 0 1px var(--ring)' } : undefined}
              >
                <div className="w-full">
                  <ThemeWireframe
                    light={lightWireframe}
                    dark={darkWireframe}
                    active={mode}
                  />
                </div>
                <span
                  className={`text-xs font-medium capitalize ${
                    isActive ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {mode}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Themes Library Grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-md font-semibold text-[var(--text-primary)]">Themes</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Use a built-in theme or pair different light and dark appearances.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreateTheme}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow-xs transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
            >
              <Sparkles className="size-3 text-[var(--accent)]" />
              <span>Create theme</span>
            </button>
            <button
              type="button"
              onClick={() => setIsImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow-xs transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
            >
              <Plus className="size-3" />
              <span>Add theme</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {themeCards.map((card) => {
            const activeModes: ThemeAppearance[] = [];
            if (lightOwner === card.id) activeModes.push('light');
            if (darkOwner === card.id) activeModes.push('dark');
            const isCustom = customThemes.some((t) => t.id === card.id);

            return (
              <ThemeLibraryCard
                key={card.id}
                theme={card}
                activeModes={activeModes}
                onSelectTheme={handleSelectTheme}
                onSelectMode={handleSelectMode}
                onDuplicate={() => handleDuplicateTheme(card.id)}
                onDownload={() => handleDownloadTheme(card.id)}
                onRemove={isCustom ? () => handleRemoveTheme(card.id) : undefined}
              />
            );
          })}
        </div>
      </div>

      {/* 3. Contrast Slider */}
      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
        <div className="min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">Contrast</span>
            {contrastValue !== CONTRAST_DEFAULT ? (
              <button
                type="button"
                aria-label="Reset contrast"
                title="Reset to default contrast"
                onClick={() => onAppearancePatch({ contrast: CONTRAST_DEFAULT })}
                className="inline-flex size-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
              >
                <Undo2 className="size-3.5" />
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Adjust the contrast of colors and borders across the interface.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 w-56">
          <span className="min-w-12 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 text-center font-mono text-xs font-medium tabular-nums text-[var(--text-primary)]">
            {contrastValue}%\n          </span>
          <input
            type="range"
            min={CONTRAST_MIN}
            max={CONTRAST_MAX}
            value={contrastValue}
            aria-label="Contrast"
            onChange={(e) => onAppearancePatch({ contrast: Number(e.target.value) })}
            style={{ '--settings-slider-progress': `${contrastProgress}%` } as CSSProperties}
            className="settings-range h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--bg-active)] accent-[var(--accent)]"
          />
        </div>
      </div>

      {/* 4. Glass Opacity Slider */}
      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
        <div className="min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">Glass opacity</span>
            {glassOpacityValue !== GLASS_OPACITY_DEFAULT ? (
              <button
                type="button"
                aria-label="Reset glass opacity"
                title="Reset to default glass opacity"
                onClick={() => onAppearancePatch({ glassOpacity: GLASS_OPACITY_DEFAULT })}
                className="inline-flex size-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
              >
                <Undo2 className="size-3.5" />
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Control how transparent glass surfaces are. Higher values make menus, dialogs, and the composer more solid.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 w-56">
          <span className="min-w-12 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 text-center font-mono text-xs font-medium tabular-nums text-[var(--text-primary)]">
            {glassOpacityValue}%
          </span>
          <input
            type="range"
            min={GLASS_OPACITY_MIN}
            max={GLASS_OPACITY_MAX}
            value={glassOpacityValue}
            aria-label="Glass opacity"
            onChange={(e) => onAppearancePatch({ glassOpacity: Number(e.target.value) })}
            style={{ '--settings-slider-progress': `${glassProgress}%` } as CSSProperties}
            className="settings-range h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--bg-active)] accent-[var(--accent)]"
          />
        </div>
      </div>

      {/* Import Modal */}
      <ThemeImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImported={(theme) => {
          handleSelectTheme(theme.id);
          notify({
            tone: 'success',
            title: `Added theme "${theme.label}"`,
          });
        }}
      />
    </div>
  );
}
