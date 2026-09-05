import React, {
  type DragEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Check,
  Code2,
  FileCode,
  FileUp,
  Globe,
  Palette,
  Plus,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  type ThemeDefinition,
  parseThemeFile,
} from '../../../shared/themePalettes';
import {
  getCustomThemes,
  installCustomTheme,
  removeCustomTheme,
  updateCustomTheme,
} from '../../lib/themePalette';
import {
  isVsCodeThemeFile,
  pairVsCodeThemes,
  parseVsCodeThemeFile,
  resolveThemeLabelCollisions,
} from '../../lib/vscodeThemeImport';
import { ThemeSearchSection } from './ThemeSearchSection';
import { Badge } from '../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

const MAX_THEME_FILE_BYTES = 512 * 1024;
const MAX_HIGHLIGHTED_JSON_LENGTH = 100_000;

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export function describeOversizedThemeFile(bytes: number): string | null {
  if (bytes <= MAX_THEME_FILE_BYTES) return null;
  return `That file is ${formatByteSize(bytes)}. Theme files are only a few KB, so this one was not read (limit ${formatByteSize(MAX_THEME_FILE_BYTES)}).`;
}

function escapeJsonHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function highlightJson(value: string): string {
  const tokenPattern =
    /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
  let highlighted = '';
  let cursor = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    highlighted += escapeJsonHtml(value.slice(cursor, index));

    // design-tokens-allow: json syntax highlighter colors
    let tokenClass = 'text-amber-500 dark:text-amber-400';
    if (token.startsWith('"')) {
      // design-tokens-allow: json syntax highlighter colors
      tokenClass = /^\s*:/.test(value.slice(index + token.length))
        // design-tokens-allow: json syntax highlighter colors
        ? 'text-sky-500 dark:text-sky-400 font-medium'
        // design-tokens-allow: json syntax highlighter colors
        : 'text-emerald-600 dark:text-emerald-400';
    } else if (token === 'true' || token === 'false' || token === 'null') {
      // design-tokens-allow: json syntax highlighter colors
      tokenClass = 'text-purple-500 dark:text-purple-400 font-semibold';
    }
    highlighted += `<span class="${tokenClass}">${escapeJsonHtml(token)}</span>`;
    cursor = index + token.length;
  }

  return highlighted + escapeJsonHtml(value.slice(cursor));
}

const THEME_TEMPLATES: Record<string, { label: string; json: string }> = {
  aurora: {
    label: 'Aurora (Minimal Light)',
    json: JSON.stringify(
      {
        version: 1,
        name: 'Aurora',
        appearance: 'light',
        colors: {
          canvas: '#f8fafc',
          surface: '#ffffff',
          accent: '#0284c7',
          text: '#0f172a',
          mutedText: '#64748b',
          border: '#e2e8f0',
          borderSubtle: '#f1f5f9',
          borderHover: '#cbd5e1',
        },
      },
      null,
      2,
    ),
  },
  obsidian: {
    label: 'Obsidian (OLED Dark)',
    json: JSON.stringify(
      {
        version: 1,
        name: 'Obsidian',
        appearance: 'dark',
        colors: {
          canvas: '#090a0f',
          surface: '#12141c',
          accent: '#8b5cf6',
          text: '#f3f4f6',
          mutedText: '#9ca3af',
          border: '#27272a',
          borderSubtle: '#18181b',
          borderHover: '#3f3f46',
        },
      },
      null,
      2,
    ),
  },
  nordic: {
    label: 'Nordic Dusk (Arctic Teal)',
    json: JSON.stringify(
      {
        version: 1,
        name: 'Nordic Dusk',
        appearance: 'dark',
        colors: {
          canvas: '#2e3440',
          surface: '#3b4252',
          accent: '#88c0d0',
          text: '#eceff4',
          mutedText: '#d8dee9',
          border: '#434c5e',
          borderSubtle: '#3b4252',
          borderHover: '#4c566a',
        },
      },
      null,
      2,
    ),
  },
  tokyoNeon: {
    label: 'Tokyo Neon (Cyberpunk)',
    json: JSON.stringify(
      {
        version: 1,
        name: 'Tokyo Neon',
        appearance: 'dark',
        colors: {
          canvas: '#1a1b26',
          surface: '#24283b',
          accent: '#f7768e',
          text: '#c0caf5',
          mutedText: '#9aa5ce',
          border: '#414868',
          borderSubtle: '#2f3549',
          borderHover: '#565f89',
        },
      },
      null,
      2,
    ),
  },
};

function ThemeJsonEditor({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const highlightedHtml = useMemo(() => {
    if (value.length > MAX_HIGHLIGHTED_JSON_LENGTH) return null;
    return highlightJson(value);
  }, [value]);

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    backdrop.scrollTop = event.currentTarget.scrollTop;
    backdrop.scrollLeft = event.currentTarget.scrollLeft;
  };

  return (
    <div
      className={`relative min-h-[220px] rounded-xl border bg-card/60 font-mono text-xs transition-colors ${
        error
          ? 'border-destructive/60 ring-1 ring-destructive/40'
          : 'border-border/80 focus-within:border-accent/80 focus-within:ring-1 focus-within:ring-accent/40'
      }`}
    >
      {highlightedHtml ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-all p-3 text-transparent selection:bg-transparent"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          ref={backdropRef}
        />
      ) : null}

      <textarea
        aria-label="Theme JSON"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="relative z-10 block h-64 w-full resize-y bg-transparent p-3 font-mono leading-relaxed text-foreground caret-accent outline-none placeholder:text-muted-foreground/40"
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
        onScroll={handleScroll}
        placeholder={`{\n  "version": 1,\n  "name": "My Custom Theme",\n  "appearance": "dark",\n  "colors": {\n    "canvas": "#1e1e2e",\n    "surface": "#252538",\n    "accent": "#cba6f7"\n  }\n}`}
        ref={textareaRef}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}

export function ThemeImportDialog({
  open,
  onOpenChange,
  onImported,
  onImportedMany,
  initialTab = "community",
  initialThemeJson = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (theme: ThemeDefinition) => boolean | void;
  onImportedMany?: (
    themes: ReadonlyArray<ThemeDefinition>,
    context: { updated: boolean },
  ) => void;
  initialTab?: "community" | "file" | "code";
  initialThemeJson?: string;
}) {
  const [activeTab, setActiveTab] = useState<"community" | "file" | "code">(initialTab);
  const [themeJson, setThemeJson] = useState(initialThemeJson);
  const [error, setError] = useState<string | null>(null);
  const [pendingThemes, setPendingThemes] = useState<ReadonlyArray<ThemeDefinition>>([]);
  const [stagedFileTheme, setStagedFileTheme] = useState<{
    theme: ThemeDefinition;
    fileName: string;
    fileSize: number;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setThemeJson(initialThemeJson || "");
      setError(null);
      setPendingThemes([]);
      setStagedFileTheme(null);
      setIsDragOver(false);
    }
  }, [open, initialTab, initialThemeJson]);

  const handleInstallSingleTheme = useCallback(
    (theme: ThemeDefinition, updateId?: string): boolean => {
      let saved: ThemeDefinition;
      try {
        saved = updateId ? updateCustomTheme(theme) : installCustomTheme(theme);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Theme could not be saved.');
        return false;
      }
      const shouldClose = onImported(saved);
      if (shouldClose !== false) {
        onOpenChange(false);
      }
      return true;
    },
    [onImported, onOpenChange],
  );

  const handleCommitThemes = useCallback(
    (themes: ReadonlyArray<ThemeDefinition>, options?: { allowCollisions?: boolean }) => {
      if (themes.length === 0) return;
      if (themes.length === 1) {
        const theme = themes[0]!;
        const existing = getCustomThemes().find((t) => t.id === theme.id);
        if (existing && !options?.allowCollisions) {
          setPendingThemes([theme]);
          return;
        }
        handleInstallSingleTheme(theme, existing?.id);
        return;
      }

      const existingThemes = getCustomThemes();
      const conflicts = themes.filter((candidate) =>
        existingThemes.some((e) => e.id === candidate.id),
      );
      if (conflicts.length > 0 && !options?.allowCollisions) {
        setPendingThemes(themes);
        return;
      }

      const installed = themes.map((t) => {
        const match = existingThemes.find((e) => e.id === t.id);
        return match ? updateCustomTheme(t) : installCustomTheme(t);
      });

      if (onImportedMany) {
        onImportedMany(installed, { updated: false });
      } else if (installed.length > 0) {
        onImported(installed[0]!);
      }
      onOpenChange(false);
    },
    [handleInstallSingleTheme, onImported, onImportedMany, onOpenChange],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      setError(null);
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      for (const file of files) {
        const oversized = describeOversizedThemeFile(file.size);
        if (oversized) {
          setError(oversized);
          return;
        }
      }

      try {
        const readFiles = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            size: file.size,
            text: await file.text(),
          })),
        );

        const vsCodeCandidates: ThemeDefinition[] = [];
        const nativeThemes: ThemeDefinition[] = [];

        for (const item of readFiles) {
          if (isVsCodeThemeFile(item.text)) {
            vsCodeCandidates.push(parseVsCodeThemeFile(item.text, { name: item.name }));
          } else {
            nativeThemes.push(parseThemeFile(item.text));
          }
        }

        const paired = pairVsCodeThemes(vsCodeCandidates);
        const resolvedThemes = resolveThemeLabelCollisions([...nativeThemes, ...paired].map((theme) => ({ theme })));

        if (resolvedThemes.length === 0) {
          setError('No valid themes were found in the selected files.');
          return;
        }

        if (resolvedThemes.length === 1) {
          setStagedFileTheme({
            theme: resolvedThemes[0]!,
            fileName: readFiles[0]?.name || 'theme.json',
            fileSize: readFiles[0]?.size || 0,
          });
        } else {
          handleCommitThemes(resolvedThemes);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to parse theme file.');
      }
    },
    [handleCommitThemes],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      void handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleAddJson = useCallback(() => {
    setError(null);
    if (!themeJson.trim()) {
      setError('Please paste theme JSON before submitting.');
      return;
    }
    try {
      const parsedTheme = isVsCodeThemeFile(themeJson)
        ? parseVsCodeThemeFile(themeJson, { name: 'Pasted VS Code Theme' })
        : parseThemeFile(themeJson);
      handleCommitThemes([parsedTheme]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid theme JSON.');
    }
  }, [themeJson, handleCommitThemes]);

  const handleFormatJson = useCallback(() => {
    if (!themeJson.trim()) return;
    try {
      const obj = JSON.parse(themeJson);
      setThemeJson(JSON.stringify(obj, null, 2));
      setError(null);
    } catch {
      // Ignore if invalid JSON
    }
  }, [themeJson]);

  const liveParsedTheme = useMemo(() => {
    if (!themeJson.trim()) return null;
    try {
      if (isVsCodeThemeFile(themeJson)) {
        return parseVsCodeThemeFile(themeJson, { name: 'Preview' });
      }
      return parseThemeFile(themeJson);
    } catch {
      return null;
    }
  }, [themeJson]);

  const pendingTheme = pendingThemes[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[640px] flex flex-col gap-0 p-0 overflow-hidden bg-background border border-border/80 shadow-2xl rounded-2xl">
        <DialogHeader className="shrink-0 p-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold tracking-tight">Add a Theme</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Install themes from the Open VSX registry, import a file, or create custom JSON.
              </DialogDescription>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(val) => {
              setActiveTab(val as 'community' | 'file' | 'code');
              setError(null);
            }}
            className="pt-3"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="community">
                <Globe className="size-3.5" />
                Community
              </TabsTrigger>
              <TabsTrigger value="file">
                <FileUp className="size-3.5" />
                Import File
              </TabsTrigger>
              <TabsTrigger value="code">
                <Code2 className="size-3.5" />
                Theme Code
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </DialogHeader>

        {/* Conflict Resolution Banner */}
        {pendingThemes.length > 0 && pendingTheme ? (
          <div className="border-b border-warning/20 bg-warning/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-4 shrink-0 text-warning mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">
                  A theme named “{pendingTheme.label}” is already installed.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Would you like to overwrite the existing theme or keep both with a unique name?
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const themes = pendingThemes;
                      setPendingThemes([]);
                      themes.forEach((t) => {
                        const existing = getCustomThemes().find((e) => e.id === t.id);
                        if (existing) updateCustomTheme(t);
                      });
                      if (onImportedMany) onImportedMany(themes, { updated: true });
                      else if (themes.length > 0) onImported(themes[0]!);
                      onOpenChange(false);
                    }}
                  >
                    Update existing
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      const disambiguated = resolveThemeLabelCollisions(pendingThemes.map((theme) => ({ theme })));
                      setPendingThemes([]);
                      handleCommitThemes(disambiguated, { allowCollisions: true });
                    }}
                  >
                    Keep both
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setPendingThemes([])}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex flex-col p-5 overflow-hidden">
          {/* TAB 1: COMMUNITY THEMES */}
          {activeTab === 'community' ? (
            <ThemeSearchSection
              open={open && activeTab === 'community'}
              onInstalled={(themes, context) => {
                if (themes.length > 0) {
                  if (onImportedMany) {
                    onImportedMany(themes, context);
                  } else {
                    onImported(themes[0]!);
                  }
                  onOpenChange(false);
                }
              }}
            />
          ) : null}

          {/* TAB 2: IMPORT FILE */}
          {activeTab === 'file' ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.currentTarget.files)}
              />

              {stagedFileTheme ? (
                <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-3 shadow-2xs">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-accent/10 border border-accent/20 text-accent">
                        <Palette className="size-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {stagedFileTheme.theme.label}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {stagedFileTheme.fileName} · {formatByteSize(stagedFileTheme.fileSize)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="capitalize text-[11px]">
                      {stagedFileTheme.theme.variants?.dark || stagedFileTheme.theme.variants?.light
                        ? 'Dual appearance'
                        : stagedFileTheme.theme.appearance === 'light'
                          ? 'Light mode'
                          : 'Dark mode'}
                    </Badge>
                  </div>

                  {/* Swatch preview */}
                  <div className="rounded-lg border border-border/50 bg-background/50 p-3 space-y-2">
                    <span className="text-[11px] font-medium text-muted-foreground">Palette Preview</span>
                    <div className="flex items-center gap-2">
                      {Object.entries(
                        stagedFileTheme.theme.colors,
                      )
                        .slice(0, 7)
                        .map(([role, hex]) => (
                          <div key={role} className="flex flex-col items-center gap-1">
                            <span
                              className="size-5 rounded-full border border-border-subtle shadow-2xs"
                              style={{ backgroundColor: String(hex) }}
                              title={`${role}: ${hex}`}
                            />
                            <span className="text-[9px] text-muted-foreground font-mono truncate max-w-10">
                              {role.slice(0, 4)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setStagedFileTheme(null)}
                    >
                      Choose different file
                    </Button>
                    <Button
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => handleCommitThemes([stagedFileTheme.theme])}
                    >
                      <Check className="size-3.5" />
                      Install Theme
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all cursor-pointer ${
                    isDragOver
                      ? 'border-accent bg-accent/5 scale-[0.99]'
                      : 'border-border/70 hover:border-border hover:bg-card/40'
                  }`}
                >
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/70 text-accent mb-3 border border-border/50">
                    <UploadCloud className="size-7" />
                  </div>
                  <h4 className="text-sm font-semibold text-foreground">
                    Drop your theme file here
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                    Drag and drop any VS Code, T3 Code, or Atlas <code className="font-mono text-foreground font-medium">.json</code> theme file, or click to browse.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <FileCode className="size-3.5" />
                    Browse Files
                  </Button>
                </div>
              )}

              {error ? (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* TAB 3: THEME CODE */}
          {activeTab === 'code' ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Preset Template:</span>
                  <Select
                    onValueChange={(val) => {
                      const template = THEME_TEMPLATES[val];
                      if (template) {
                        setThemeJson(template.json);
                        setError(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 w-46 text-xs bg-muted/40 border-border/60">
                      <SelectValue placeholder="Load a template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(THEME_TEMPLATES).map(([key, t]) => (
                        <SelectItem key={key} value={key} className="text-xs">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleFormatJson}
                    disabled={!themeJson.trim()}
                  >
                    <Wand2 className="size-3 mr-1" />
                    Format JSON
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setThemeJson('');
                      setError(null);
                    }}
                    disabled={!themeJson.trim()}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>

              <ThemeJsonEditor
                value={themeJson}
                onChange={(val) => {
                  setThemeJson(val);
                  setError(null);
                }}
                error={error}
              />

              {liveParsedTheme ? (
                <div className="flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                  <div className="flex items-center gap-2">
                    <Check className="size-3.5" />
                    <span>Valid theme: <strong>{liveParsedTheme.label}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {Object.entries(
                      liveParsedTheme.colors,
                    )
                      .slice(0, 5)
                      .map(([k, hex]) => (
                        <span
                          key={k}
                          className="size-3 rounded-full border border-border-subtle"
                          style={{ backgroundColor: String(hex) }}
                          title={`${k}: ${hex}`}
                        />
                      ))}
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 p-4 border-t border-border/40 bg-muted/20 flex items-center justify-between sm:justify-between">
          <div className="text-[11px] text-muted-foreground">
            Supports Atlas, T3 Code, and VS Code themes
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {activeTab === 'code' ? (
              <Button
                size="sm"
                className="text-xs gap-1.5"
                onClick={handleAddJson}
                disabled={!themeJson.trim()}
              >
                <Plus className="size-3.5" />
                Add Theme
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
