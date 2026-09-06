import {
  Check,
  ExternalLink,
  PackagePlus,
  Palette,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  importOpenVsxThemeExtension,
  searchOpenVsxThemes,
  type OpenVsxThemeExtension,
  type OpenVsxThemeSort,
} from '../../lib/openVsxThemes';
import type { ThemeDefinition } from '../../../shared/themePalettes';
import {
  getCustomThemes,
  getStoredCustomThemeCollection,
  replaceCustomThemeCollection,
} from '../../lib/themePalette';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Spinner } from '../ui/spinner';
import { GitHubIcon } from '../icons/GitHubIcon';

const DOWNLOAD_FORMAT = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const SUGGESTED_SEARCHES = ['Dracula', 'Catppuccin', 'Tokyo Night', 'Nord', 'One Dark', 'Solarized'];

const SORT_OPTIONS: ReadonlyArray<{ value: OpenVsxThemeSort; label: string }> = [
  { value: 'downloadCount', label: 'Most downloaded' },
  { value: 'rating', label: 'Best rated' },
  { value: 'timestamp', label: 'Newest' },
  { value: 'relevance', label: 'Most relevant' },
];

const SEARCH_DEBOUNCE_MS = 300;

export type CuratedThemeExtension = OpenVsxThemeExtension & {
  previewColors?: string[];
};

export const CURATED_THEMES: ReadonlyArray<CuratedThemeExtension> = [
  {
    id: 'dracula-theme.theme-dracula',
    collectionId: 'open-vsx:dracula-theme.theme-dracula',
    name: 'Dracula Theme Official',
    publisher: 'dracula-theme',
    description: 'Official Dracula Theme. A famous dark theme for 200+ apps.',
    downloadCount: 420000,
    iconUrl: 'https://open-vsx.org/api/dracula-theme/theme-dracula/2.25.1/file/icon.png',
    sourceUrl: 'https://github.com/dracula/visual-studio-code',
    manifestUrl: 'https://open-vsx.org/api/dracula-theme/theme-dracula/2.25.1/file/package.json',
    sha256Url: 'https://open-vsx.org/api/dracula-theme/theme-dracula/2.25.1/file/dracula-theme.theme-dracula-2.25.1.sha256',
    vsixUrl: 'https://open-vsx.org/api/dracula-theme/theme-dracula/2.25.1/file/dracula-theme.theme-dracula-2.25.1.vsix',
    version: '2.25.1',
    license: 'MIT',
    previewColors: ['#282a36', '#44475a', '#bd93f9', '#f8f8f2', '#ff79c6'],
  },
  {
    id: 'catppuccin.catppuccin-vsc',
    collectionId: 'open-vsx:catppuccin.catppuccin-vsc',
    name: 'Catppuccin for VS Code',
    publisher: 'catppuccin',
    description: 'Soothing pastel theme with Latte, Frappé, Macchiato, and Mocha.',
    downloadCount: 380000,
    iconUrl: 'https://open-vsx.org/api/catppuccin/catppuccin-vsc/3.16.0/file/icon.png',
    sourceUrl: 'https://github.com/catppuccin/vscode',
    manifestUrl: 'https://open-vsx.org/api/catppuccin/catppuccin-vsc/3.16.0/file/package.json',
    sha256Url: 'https://open-vsx.org/api/catppuccin/catppuccin-vsc/3.16.0/file/catppuccin.catppuccin-vsc-3.16.0.sha256',
    vsixUrl: 'https://open-vsx.org/api/catppuccin/catppuccin-vsc/3.16.0/file/catppuccin.catppuccin-vsc-3.16.0.vsix',
    version: '3.16.0',
    license: 'MIT',
    previewColors: ['#1e1e2e', '#313244', '#cba6f7', '#cdd6f4', '#89b4fa'],
  },
  {
    id: 'enkia.tokyo-night',
    collectionId: 'open-vsx:enkia.tokyo-night',
    name: 'Tokyo Night',
    publisher: 'enkia',
    description: 'Celebrates the vibrant neon lights of downtown Tokyo at night.',
    downloadCount: 290000,
    iconUrl: 'https://open-vsx.org/api/enkia/tokyo-night/1.1.2/file/icon.png',
    sourceUrl: 'https://github.com/enkia/tokyo-night-vscode-theme',
    manifestUrl: 'https://open-vsx.org/api/enkia/tokyo-night/1.1.2/file/package.json',
    sha256Url: 'https://open-vsx.org/api/enkia/tokyo-night/1.1.2/file/enkia.tokyo-night-1.1.2.sha256',
    vsixUrl: 'https://open-vsx.org/api/enkia/tokyo-night/1.1.2/file/enkia.tokyo-night-1.1.2.vsix',
    version: '1.1.2',
    license: 'MIT',
    previewColors: ['#1a1b26', '#24283b', '#7aa2f7', '#c0caf5', '#bb9af7'],
  },
  {
    id: 'arcticicestudio.nord-visual-studio-code',
    collectionId: 'open-vsx:arcticicestudio.nord-visual-studio-code',
    name: 'Nord',
    publisher: 'arcticicestudio',
    description: 'An arctic, north-bluish clean and elegant color palette.',
    downloadCount: 250000,
    iconUrl: 'https://open-vsx.org/api/arcticicestudio/nord-visual-studio-code/0.19.0/file/icon.png',
    sourceUrl: 'https://github.com/nordtheme/visual-studio-code',
    manifestUrl: 'https://open-vsx.org/api/arcticicestudio/nord-visual-studio-code/0.19.0/file/package.json',
    sha256Url: 'https://open-vsx.org/api/arcticicestudio/nord-visual-studio-code/0.19.0/file/arcticicestudio.nord-visual-studio-code-0.19.0.sha256',
    vsixUrl: 'https://open-vsx.org/api/arcticicestudio/nord-visual-studio-code/0.19.0/file/arcticicestudio.nord-visual-studio-code-0.19.0.vsix',
    version: '0.19.0',
    license: 'MIT',
    previewColors: ['#2e3440', '#3b4252', '#88c0d0', '#eceff4', '#81a1c1'],
  },
  {
    id: 'zhuangtongfa.material-theme',
    collectionId: 'open-vsx:zhuangtongfa.material-theme',
    name: 'One Dark Pro',
    publisher: 'zhuangtongfa',
    description: 'Atom’s iconic One Dark theme with high contrast syntax.',
    downloadCount: 820000,
    iconUrl: 'https://open-vsx.org/api/zhuangtongfa/material-theme/3.18.4/file/icon.png',
    sourceUrl: 'https://github.com/Binaryify/OneDark-Pro',
    manifestUrl: 'https://open-vsx.org/api/zhuangtongfa/material-theme/3.18.4/file/package.json',
    sha256Url: 'https://open-vsx.org/api/zhuangtongfa/material-theme/3.18.4/file/zhuangtongfa.material-theme-3.18.4.sha256',
    vsixUrl: 'https://open-vsx.org/api/zhuangtongfa/material-theme/3.18.4/file/zhuangtongfa.material-theme-3.18.4.vsix',
    version: '3.18.4',
    license: 'MIT',
    previewColors: ['#282c34', '#21252b', '#61afef', '#abb2bf', '#98c379'],
  },
  {
    id: 'solarized-theme.solarized',
    collectionId: 'open-vsx:solarized-theme.solarized',
    name: 'Solarized',
    publisher: 'solarized-theme',
    description: 'Precision color scheme designed for terminal & editor contrast.',
    downloadCount: 160000,
    iconUrl: null,
    sourceUrl: 'https://github.com/solarized/solarized',
    manifestUrl: 'https://open-vsx.org/api/solarized-theme/solarized/0.0.3/file/package.json',
    sha256Url: 'https://open-vsx.org/api/solarized-theme/solarized/0.0.3/file/solarized-theme.solarized-0.0.3.sha256',
    vsixUrl: 'https://open-vsx.org/api/solarized-theme/solarized/0.0.3/file/solarized-theme.solarized-0.0.3.vsix',
    version: '0.0.3',
    license: 'MIT',
    previewColors: ['#002b36', '#073642', '#268bd2', '#839496', '#2aa198'],
  },
];

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}



function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.6 9.6l-2.7-8.3c-.2-.6-.9-.6-1.1 0L17.1 9.6H6.9L4.2 1.3c-.2-.6-.9-.6-1.1 0L.4 9.6c-.2.6 0 1.2.5 1.6L12 19.9l11.1-8.7c.5-.4.7-1 .5-1.6z" />
    </svg>
  );
}

function SourceLinkIcon({ url }: { url: string }) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'github.com' || host.endsWith('.github.com')) {
      return <GitHubIcon className="size-3.5" />;
    }
    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) {
      return <GitLabIcon className="size-3.5" />;
    }
  } catch {
    // Fall through
  }
  return <ExternalLink className="size-3.5" />;
}

function ThemeExtensionIcon({ extension }: { extension: OpenVsxThemeExtension }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground border border-border/50">
      {extension.iconUrl && !failed ? (
        <img
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={extension.iconUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <Palette className="size-4 text-accent" />
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card/40 p-3.5 animate-pulse">
      <div className="flex gap-2.5 items-center">
        <div className="size-9 rounded-lg bg-muted/80" />
        <div className="space-y-1.5 flex-1">
          <div className="h-3.5 w-32 rounded bg-muted/80" />
          <div className="h-2.5 w-20 rounded bg-muted/60" />
        </div>
      </div>
      <div className="h-2.5 w-full rounded bg-muted/40" />
      <div className="h-2.5 w-3/4 rounded bg-muted/40" />
      <div className="mt-2 flex items-center justify-between pt-1 border-t border-border/30">
        <div className="size-4 rounded bg-muted/60" />
        <div className="h-6 w-16 rounded bg-muted/80" />
      </div>
    </div>
  );
}

export function ThemeSearchSection({
  open,
  onInstalled,
}: {
  open: boolean;
  onInstalled: (themes: ReadonlyArray<ThemeDefinition>, context: { updated: boolean }) => void;
}) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<OpenVsxThemeSort>('downloadCount');
  const [results, setResults] = useState<ReadonlyArray<OpenVsxThemeExtension> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<OpenVsxThemeExtension | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lastSearchKeyRef = useRef<string | null>(null);
  // The (query, sort) pair from the previous effect run, so a search error
  // that belongs to an older key can be cleared when the user returns to
  // already-shown results without clearing a fresh install error.
  const prevSearchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    if (open) {
      lastSearchKeyRef.current = null;
      prevSearchKeyRef.current = null;
      setQuery('');
      setSortBy('downloadCount');
      setResults(null);
      setError(null);
      setIsSearching(false);
      setInstallingId(null);
      setPendingUpdate(null);
    }
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [open]);

  const runSearch = useCallback(
    async (searchText: string, nextSort = sortBy) => {
      const trimmed = searchText.trim();
      if (!trimmed) {
        setResults(null);
        setIsSearching(false);
        setError(null);
        return;
      }
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setError(null);
      setIsSearching(true);
      try {
        const nextResults = await searchOpenVsxThemes(trimmed, {
          signal: controller.signal,
          sortBy: nextSort,
        });
        if (!controller.signal.aborted) {
          setResults(nextResults);
          lastSearchKeyRef.current = `${trimmed}\u0000${nextSort}`;
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResults(null);
          lastSearchKeyRef.current = null;
          const msg = cause instanceof Error ? cause.message : 'Search failed';
          setError(
            msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network')
              ? 'Unable to connect to Open VSX registry. Please check your internet connection.'
              : msg,
          );
        }
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsSearching(false);
      }
    },
    [sortBy],
  );

  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (!open) return;
    // The debounced value trails the visible input mid-keystroke; running the
    // search off it would fetch a query the user already changed.
    if (debouncedQuery !== query.trim()) return;
    if (installingId !== null) return;
    if (!debouncedQuery) {
      // Clearing the box answers immediately instead of waiting out the
      // debounce, and aborts the in-flight request so a late response cannot
      // repopulate results the user just dismissed.
      requestRef.current?.abort();
      requestRef.current = null;
      setResults(null);
      setIsSearching(false);
      setError(null);
      return;
    }
    const searchKey = `${debouncedQuery}\u0000${sortBy}`;
    if (lastSearchKeyRef.current === searchKey) {
      // Results already match this query. A request for a newer key may still
      // be in flight (typed then undone); abort it so it cannot overwrite
      // what is shown, and stop the spinner it started. A stale search error
      // belongs to the older key and goes, while an install error on this
      // unchanged query survives.
      requestRef.current?.abort();
      requestRef.current = null;
      setIsSearching(false);
      if (prevSearchKeyRef.current !== searchKey) setError(null);
      prevSearchKeyRef.current = searchKey;
      return;
    }
    prevSearchKeyRef.current = searchKey;
    void runSearch(debouncedQuery, sortBy);
  }, [open, query, debouncedQuery, sortBy, installingId, runSearch]);

  const handleInstall = useCallback(
    async (extension: OpenVsxThemeExtension, allowUpdate: boolean) => {
      setError(null);
      let installedCollection: ReadonlyArray<ThemeDefinition>;
      try {
        installedCollection = getStoredCustomThemeCollection(extension.collectionId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Installed themes could not be read.');
        return;
      }
      const updated = installedCollection.length > 0;
      if (updated && !allowUpdate) {
        setPendingUpdate(extension);
        return;
      }

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setIsSearching(false);
      setInstallingId(extension.id);
      try {
        const themes = await importOpenVsxThemeExtension(extension, controller.signal);
        if (!controller.signal.aborted) {
          const imported = replaceCustomThemeCollection(extension.collectionId, themes, {
            expectedCollection: installedCollection,
          });
          onInstalled(imported, { updated });
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          const msg = cause instanceof Error ? cause.message : 'Could not add theme';
          setError(
            msg.toLowerCase().includes('failed to fetch')
              ? 'Failed to download theme package. Check connection or try again.'
              : msg,
          );
        }
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
        setInstallingId(null);
      }
    },
    [onInstalled],
  );

  const displayedThemes = useMemo(() => {
    if (results !== null) return results;
    return CURATED_THEMES;
  }, [results]);

  const installedThemes = getCustomThemes();

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Pinned search header */}
      <div className="shrink-0 space-y-2.5">
        <InputGroup className="bg-card/70 border-border/80 shadow-2xs h-9">
          <InputGroupAddon align="inline-start">
            {isSearching ? (
              <Spinner className="size-4 text-accent" />
            ) : (
              <Search className="size-4 text-muted-foreground" />
            )}
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search Open VSX themes"
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter' && !isSearching && installingId === null) {
                void runSearch(query.trim());
              }
            }}
            placeholder="Search 1,000+ community themes..."
            type="text"
            value={query}
          />
          {query.trim() ? (
            <InputGroupAddon align="inline-end">
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  setResults(null);
                  setError(null);
                }}
                className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <X className="size-3.5" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap min-w-0 items-center gap-1.5 py-0.5">
            <span className="text-[11px] font-medium text-muted-foreground shrink-0 flex items-center gap-1 mr-1">
              <Sparkles className="size-3 text-accent" /> Popular:
            </span>
            {SUGGESTED_SEARCHES.map((suggestion) => {
              const isSelected = query.trim().toLowerCase() === suggestion.toLowerCase();
              return (
                <button
                  key={suggestion}
                  type="button"
                  disabled={installingId !== null}
                  onClick={() => {
                    setQuery(suggestion);
                    void runSearch(suggestion);
                  }}
                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-accent-foreground shadow-2xs font-semibold'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40'
                  }`}
                >
                  {suggestion}
                </button>
              );
            })}
          </div>

          {results && results.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1.5 ml-auto pl-2 border-l border-border/40">
              <span className="text-[11px] text-muted-foreground shrink-0">Sort:</span>
              <Select
                disabled={installingId !== null}
                value={sortBy}
                onValueChange={(val) => {
                  const s = val as OpenVsxThemeSort;
                  setSortBy(s);
                  if (query.trim()) void runSearch(query.trim(), s);
                }}
              >
                <SelectTrigger className="h-6.5 w-44 text-xs bg-muted/40 border-border/60">
                  <SelectValue>
                    {SORT_OPTIONS.find((option) => option.value === sortBy)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
            <p className="min-w-0 flex-1">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2 shrink-0 ml-2"
              onClick={() => void runSearch(query.trim() || 'Dracula')}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>

      {/* Scrollable list - single clean scroll container */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-2">
        {isSearching ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : displayedThemes.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 text-center p-6">
            <Palette className="size-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">No themes matching “{query}”</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try searching for “Dracula”, “Catppuccin”, “Tokyo”, or “Nord”.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 pb-2">
            {displayedThemes.map((extension) => {
              const isInstalling = installingId === extension.id;
              const isInstalled = installedThemes.some(
                (theme) => theme.collection?.id === extension.collectionId,
              );
              const previewColors = (extension as CuratedThemeExtension).previewColors ?? [];

              return (
                <div
                  key={extension.id}
                  className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-3.5 transition-all hover:bg-muted/30 hover:border-border hover:shadow-2xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <ThemeExtensionIcon extension={extension} />
                      <div className="min-w-0 flex-1">
                        <h4
                          className="truncate text-xs font-semibold text-foreground"
                          title={extension.name}
                        >
                          {extension.name}
                        </h4>
                        <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                          {extension.publisher} · {DOWNLOAD_FORMAT.format(extension.downloadCount)}{' '}
                          installs
                        </p>
                      </div>
                    </div>

                    <p className="line-clamp-2 min-h-7 text-[11px] text-muted-foreground leading-relaxed">
                      {extension.description || 'Community color theme for Atlas and VS Code.'}
                    </p>

                    {previewColors.length > 0 ? (
                      <div className="flex items-center gap-1.5 pt-0.5" aria-hidden="true">
                        {previewColors.map((hex, i) => (
                          <span
                            key={i}
                            className="size-3 rounded-full ring-1 ring-border/50 shadow-2xs transition-transform hover:scale-125"
                            style={{ backgroundColor: hex }}
                            title={hex}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                    <div>
                      {extension.sourceUrl ? (
                        <a
                          aria-label={`View source for ${extension.name}`}
                          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          href={extension.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                          title="View source repository"
                        >
                          <SourceLinkIcon url={extension.sourceUrl} />
                        </a>
                      ) : null}
                    </div>

                    <Button
                      aria-label={`${isInstalling ? 'Installing' : isInstalled ? 'Update' : 'Install'} ${extension.name}`}
                      disabled={installingId !== null}
                      size="sm"
                      variant={isInstalled ? 'outline' : 'default'}
                      className="h-7 px-3 text-xs gap-1.5"
                      onClick={() => void handleInstall(extension, false)}
                    >
                      {isInstalling ? (
                        <Spinner className="size-3" />
                      ) : isInstalled ? (
                        <Check className="size-3 text-success" />
                      ) : (
                        <PackagePlus className="size-3" />
                      )}
                      {isInstalling ? 'Installing…' : isInstalled ? 'Installed' : 'Install'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={pendingUpdate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingUpdate(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update “{pendingUpdate?.name}”?</DialogTitle>
            <DialogDescription>
              This will update all variants in this theme family to the latest version from Open VSX.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingUpdate(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const extension = pendingUpdate;
                setPendingUpdate(null);
                if (extension) void handleInstall(extension, true);
              }}
            >
              Update theme
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
