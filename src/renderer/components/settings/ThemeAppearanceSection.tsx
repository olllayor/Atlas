import { Paintbrush, Plus, Undo2 } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
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
  ATLAS_THEME,
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
  removeCustomThemeCollection,
  saveCustomTheme,
  subscribeCustomThemes,
} from '../../lib/themePalette';
import { ThemeImportDialog } from './ThemeImportDialog';
import { ThemeLibraryCard } from './ThemeLibraryCard';
import { ThemeWireframe, type ThemeWireframeColors } from './ThemeWireframe';
import { applyAppearanceContrast } from '../../lib/themeOverrides';

type ThemeCardItem = {
  key: string;
  id: string;
  label: string;
  card: ThemeCardDefinition;
  isCustom: boolean;
  collectionId?: string;
  variants?: ThemeDefinition[];
  activeTheme: ThemeDefinition;
};

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
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [editingThemeJson, setEditingThemeJson] = useState('');
  const [importInitialTab, setImportInitialTab] = useState<'community' | 'file' | 'code'>('community');

  useEffect(() => {
    return subscribeCustomThemes(() => {
      setCustomThemes(getCustomThemes());
    });
  }, []);

  const currentThemeId = appearance.themeId || 'default';
  const lightOwner = appearance.themeHalves?.light ?? currentThemeId;
  const darkOwner = appearance.themeHalves?.dark ?? currentThemeId;

  // Build theme cards grouped by collection
  const themeItems = useMemo<ReadonlyArray<ThemeCardItem>>(() => {
    // 1. Built-in themes: ATLAS_THEME ("Atlas") + 5 presets
    const builtIns: ThemeCardItem[] = [ATLAS_THEME, ...BUILT_IN_THEMES].map((theme) => {
      const card = getThemeCardDefinition(theme);
      return {
        key: `builtin-${theme.id}`,
        id: theme.id,
        label: theme.id === 'default' ? 'Atlas' : theme.label,
        card: {
          ...card,
          label: theme.id === 'default' ? 'Atlas' : theme.label,
        },
        isCustom: false,
        activeTheme: theme,
      };
    });

    // 2. Custom themes: group collections by collection.id
    const collectionMap = new Map<string, ThemeDefinition[]>();
    const standaloneCustoms: ThemeDefinition[] = [];

    for (const theme of customThemes) {
      if (theme.collection?.id) {
        const list = collectionMap.get(theme.collection.id) ?? [];
        list.push(theme);
        collectionMap.set(theme.collection.id, list);
      } else {
        standaloneCustoms.push(theme);
      }
    }

    const customs: ThemeCardItem[] = [];

    for (const [colId, variants] of collectionMap.entries()) {
      const collectionLabel =
        variants[0]?.collection?.label || variants[0]?.label || 'Theme Collection';

      // Pick active variant: priority to currently activated half, then selected, then first
      const activeVariant =
        variants.find(
          (v) => v.id === currentThemeId || v.id === lightOwner || v.id === darkOwner,
        ) ??
        variants.find((v) => v.id === selectedVariants[colId]) ??
        variants[0]!;

      const activeCard = getThemeCardDefinition(activeVariant);

      customs.push({
        key: `col-${colId}`,
        id: activeVariant.id,
        label: collectionLabel,
        card: {
          ...activeCard,
          id: activeVariant.id,
          label: collectionLabel,
        },
        isCustom: true,
        collectionId: colId,
        variants,
        activeTheme: activeVariant,
      });
    }

    for (const theme of standaloneCustoms) {
      customs.push({
        key: `custom-${theme.id}`,
        id: theme.id,
        label: theme.label,
        card: getThemeCardDefinition(theme),
        isCustom: true,
        activeTheme: theme,
      });
    }

    return [...builtIns, ...customs];
  }, [customThemes, currentThemeId, lightOwner, darkOwner, selectedVariants]);

  // Helper to extract wireframe colors for light and dark
  const getWireframeColors = (ownerId: string, mode: ThemeAppearance): ThemeWireframeColors => {
    const defaultTheme = ATLAS_THEME;
    const fallbackColors = getThemeColorsForAppearance(defaultTheme, mode) ?? defaultTheme.colors;

    const theme = getThemeDefinition(ownerId);
    const themeColors = theme ? getThemeColorsForAppearance(theme, mode) : null;
    const colors = themeColors ?? fallbackColors;

    return {
      sidebar: (colors as any).sidebar ?? colors.chrome ?? fallbackColors.sidebar ?? (mode === 'light' ? '#ffffff' : '#0f0f10'),
      canvas: colors.canvas ?? fallbackColors.canvas ?? (mode === 'light' ? '#ffffff' : '#07080b'),
      surface: colors.surface ?? fallbackColors.surface ?? (mode === 'light' ? '#f4f4f5' : '#18181b'),
      accentSurface: colors.accentSurface ?? fallbackColors.accentSurface ?? (mode === 'light' ? '#e4e4e7' : '#27272a'),
      accent: colors.accent ?? '#6366f1',
      messageSurface: colors.messageSurface ?? fallbackColors.messageSurface ?? (mode === 'light' ? '#ffffff' : '#18181b'),
      messageAction: colors.accent ?? '#6366f1',
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

  const handleSelectVariant = (collectionId: string, variantId: string) => {
    setSelectedVariants((prev) => ({ ...prev, [collectionId]: variantId }));
    handleSelectTheme(variantId);
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
      collection: undefined, // duplicated theme becomes a standalone custom theme
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

  const handleEditTheme = (themeDef: ThemeDefinition) => {
    setEditingThemeJson(serializeThemeFile(themeDef));
    setImportInitialTab('code');
    setIsImportOpen(true);
  };

  const handleDownloadTheme = (themeDef: ThemeDefinition) => {
    downloadThemeFile(`${themeDef.id}.json`, serializeThemeFile(themeDef));
    notify({
      tone: 'success',
      title: `Exported ${themeDef.label}`,
      description: `Saved ${themeDef.id}.json`,
    });
  };

  const handleRemoveItem = (item: ThemeCardItem) => {
    if (item.collectionId) {
      removeCustomThemeCollection(item.collectionId);
      if (item.variants?.some((v) => v.id === currentThemeId || v.id === lightOwner || v.id === darkOwner)) {
        onAppearancePatch({
          themeId: 'default',
          themeHalves: null,
        });
      }
      notify({
        tone: 'success',
        title: `Deleted ${item.label}`,
        description: `Removed ${item.variants?.length ?? 1} variants from this collection.`,
      });
    } else {
      removeCustomTheme(item.activeTheme.id);
      if (currentThemeId === item.activeTheme.id || lightOwner === item.activeTheme.id || darkOwner === item.activeTheme.id) {
        onAppearancePatch({
          themeId: 'default',
          themeHalves: null,
        });
      }
      notify({
        tone: 'success',
        title: `Deleted ${item.label}`,
      });
    }
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

  // Contrast slider with local draft to prevent async IPC rubber-banding during drag
  const contrastValue = appearance.contrast ?? CONTRAST_DEFAULT;
  const [draftContrast, setDraftContrast] = useState<number>(contrastValue);

  useEffect(() => {
    setDraftContrast(contrastValue);
  }, [contrastValue]);

  const contrastProgress = Math.min(
    100,
    Math.max(0, ((draftContrast - CONTRAST_MIN) / (CONTRAST_MAX - CONTRAST_MIN)) * 100),
  );

  // Glass opacity slider with local draft
  const glassOpacityValue = appearance.glassOpacity ?? GLASS_OPACITY_DEFAULT;
  const [draftGlassOpacity, setDraftGlassOpacity] = useState<number>(glassOpacityValue);

  useEffect(() => {
    setDraftGlassOpacity(glassOpacityValue);
  }, [glassOpacityValue]);

  const glassProgress = Math.min(
    100,
    Math.max(0, ((draftGlassOpacity - GLASS_OPACITY_MIN) / (GLASS_OPACITY_MAX - GLASS_OPACITY_MIN)) * 100),
  );

  const contrastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (contrastTimerRef.current) clearTimeout(contrastTimerRef.current);
      if (glassTimerRef.current) clearTimeout(glassTimerRef.current);
    };
  }, []);

  const handleContrastChange = (val: number) => {
    setDraftContrast(val);
    applyAppearanceContrast(document.documentElement, val);
    if (contrastTimerRef.current) clearTimeout(contrastTimerRef.current);
    contrastTimerRef.current = setTimeout(() => {
      onAppearancePatch({ contrast: val });
    }, 150);
  };

  const handleContrastCommit = (val: number) => {
    if (contrastTimerRef.current) clearTimeout(contrastTimerRef.current);
    setDraftContrast(val);
    applyAppearanceContrast(document.documentElement, val);
    onAppearancePatch({ contrast: val });
  };

  const handleGlassOpacityChange = (val: number) => {
    setDraftGlassOpacity(val);
    if (glassTimerRef.current) clearTimeout(glassTimerRef.current);
    glassTimerRef.current = setTimeout(() => {
      onAppearancePatch({ glassOpacity: val });
    }, 150);
  };

  const handleGlassOpacityCommit = (val: number) => {
    if (glassTimerRef.current) clearTimeout(glassTimerRef.current);
    setDraftGlassOpacity(val);
    onAppearancePatch({ glassOpacity: val });
  };

  return (
    <div className="space-y-8">
      {/* 1. Color Scheme Wireframe Cards */}
      <div>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Color scheme</h3>
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
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent)] bg-transparent shadow-sm'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div className="w-full">
                  <ThemeWireframe
                    light={lightWireframe}
                    dark={darkWireframe}
                    active={mode}
                  />
                </div>
                <span
                  className={`text-xs capitalize ${
                    isActive ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] font-normal'
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
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Themes</h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCreateTheme}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs font-medium text-[var(--text-secondary)] shadow-2xs transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
            >
              <Paintbrush className="size-3 text-[var(--text-muted)]" />
              <span>Create theme</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setImportInitialTab('community');
                setEditingThemeJson('');
                setIsImportOpen(true);
              }}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs font-medium text-[var(--text-secondary)] shadow-2xs transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
            >
              <Plus className="size-3 text-[var(--text-muted)]" />
              <span>Add theme</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {themeItems.map((item) => {
            const activeModes: ThemeAppearance[] = [];
            if (lightOwner === item.activeTheme.id) activeModes.push('light');
            if (darkOwner === item.activeTheme.id) activeModes.push('dark');

            return (
              <ThemeLibraryCard
                key={item.key}
                theme={item.card}
                activeModes={activeModes}
                variants={item.variants}
                activeVariantId={item.activeTheme.id}
                onSelectTheme={() => handleSelectTheme(item.activeTheme.id)}
                onSelectMode={(mode) => handleSelectMode(item.activeTheme.id, mode)}
                onSelectVariant={(variantId) => {
                  if (item.collectionId) {
                    handleSelectVariant(item.collectionId, variantId);
                  } else {
                    handleSelectTheme(variantId);
                  }
                }}
                onDuplicate={() => handleDuplicateTheme(item.activeTheme.id)}
                onEdit={item.isCustom ? () => handleEditTheme(item.activeTheme) : undefined}
                onDownload={item.isCustom ? () => handleDownloadTheme(item.activeTheme) : undefined}
                onRemove={item.isCustom ? () => handleRemoveItem(item) : undefined}
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
            {draftContrast !== CONTRAST_DEFAULT ? (
              <button
                type="button"
                aria-label="Reset contrast"
                title="Reset to default contrast"
                onClick={() => handleContrastCommit(CONTRAST_DEFAULT)}
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
          <span className="min-w-[52px] rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 text-center font-mono text-xs font-medium tabular-nums text-[var(--text-primary)]">
            {draftContrast}%
          </span>
          <input
            type="range"
            min={CONTRAST_MIN}
            max={CONTRAST_MAX}
            value={draftContrast}
            aria-label="Contrast"
            onChange={(e) => handleContrastChange(Number(e.target.value))}
            onPointerUp={() => handleContrastCommit(draftContrast)}
            onKeyUp={(e) => {
              if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
                handleContrastCommit(Number((e.target as HTMLInputElement).value));
              }
            }}
            style={{ '--settings-slider-progress': `${contrastProgress}%` } as CSSProperties}
            className="settings-range h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--bg-active)] accent-[var(--accent)]"
          />
        </div>
      </div>

      {/* Glass Opacity Slider */}
      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
        <div className="min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">Glass opacity</span>
            {draftGlassOpacity !== GLASS_OPACITY_DEFAULT ? (
              <button
                type="button"
                aria-label="Reset glass opacity"
                title="Reset to default glass opacity"
                onClick={() => handleGlassOpacityCommit(GLASS_OPACITY_DEFAULT)}
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
            {draftGlassOpacity}%
          </span>
          <input
            type="range"
            min={GLASS_OPACITY_MIN}
            max={GLASS_OPACITY_MAX}
            value={draftGlassOpacity}
            aria-label="Glass opacity"
            onChange={(e) => handleGlassOpacityChange(Number(e.target.value))}
            onPointerUp={() => handleGlassOpacityCommit(draftGlassOpacity)}
            onKeyUp={(e) => {
              if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
                handleGlassOpacityCommit(Number((e.target as HTMLInputElement).value));
              }
            }}
            style={{ '--settings-slider-progress': `${glassProgress}%` } as CSSProperties}
            className="settings-range h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--bg-active)] accent-[var(--accent)]"
          />
        </div>
      </div>

      <ThemeImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        initialTab={importInitialTab}
        initialThemeJson={editingThemeJson}
        onImported={(theme: ThemeDefinition) => {
          handleSelectTheme(theme.id);
          notify({
            tone: 'success',
            title: `Imported theme "${theme.label}"`,
          });
        }}
      />
    </div>
  );
}
