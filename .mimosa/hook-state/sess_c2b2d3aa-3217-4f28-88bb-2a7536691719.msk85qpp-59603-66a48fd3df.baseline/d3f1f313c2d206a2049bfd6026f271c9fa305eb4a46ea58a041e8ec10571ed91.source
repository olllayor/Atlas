import { Check, Copy, Download } from 'lucide-react';

import { SlotLabel } from './ui/slot-label';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import { cn } from '../lib/utils';
import { useClipboard } from '../hooks/useClipboard';
import { fileExtensions, resolveLanguageAlias } from './ai-elements/codeLanguages';

type CodeBlockProps = {
  code: string;
  language?: string;
  isIncomplete?: boolean;
  className?: string;
};

/**
 * Shiki's dual-theme output. In `themes` mode a token never carries a flat
 * `.color`; the resolved colours live in `htmlStyle`, which holds the
 * default theme's real CSS properties *plus* one `--shiki-<variant>` custom
 * property per theme. Reading `.color` (as this component used to) yields
 * `undefined` for every token, which is why highlighting rendered as a
 * uniform grey wall.
 */
type ShikiToken = {
  content: string;
  color?: string;
  bgColor?: string;
  htmlStyle?: Record<string, string> | string;
};

type HighlightResult = {
  tokens: ShikiToken[][];
  bg?: string;
  fg?: string;
};

type HighlightCallback = (result: HighlightResult | null) => void;
type HighlightOptions = {
  code: string;
  language: string;
  themes: string[];
};
type CodeHighlighter = {
  getSupportedLanguages(): string[];
  getThemes(): string[];
  highlight(options: HighlightOptions, callback?: HighlightCallback): HighlightResult | null;
};

const MAX_HIGHLIGHT_CACHE_SIZE = 120;
const highlightCache = new Map<string, HighlightResult | null>();

// Lazily import the streamdown code highlighter. Importing the module eagerly
// pulls in all 700+ shiki language grammars as static data, which is the
// single largest contributor to the renderer bundle. Keeping the import
// inside a getter means the highlighter (and the grammars it lazily loads on
// first use) only lands in memory after a code block actually streams in.
let highlighterPromise: Promise<CodeHighlighter> | null = null;
async function loadHighlighter(): Promise<CodeHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('@streamdown/code').then((mod) => mod.code as unknown as CodeHighlighter);
  }
  return highlighterPromise;
}

let supportedLanguagesPromise: Promise<Set<string>> | null = null;
function loadSupportedLanguages(): Promise<Set<string>> {
  if (!supportedLanguagesPromise) {
    supportedLanguagesPromise = loadHighlighter().then((highlighter) => new Set(highlighter.getSupportedLanguages()));
  }
  return supportedLanguagesPromise;
}

async function resolveLanguage(language?: string): Promise<string | null> {
  const aliased = resolveLanguageAlias(language);
  if (!aliased) return null;

  const supported = await loadSupportedLanguages();
  return supported.has(aliased) ? aliased : null;
}

function getDownloadFilename(language?: string) {
  const aliased = resolveLanguageAlias(language) || 'text';
  const extension = fileExtensions[aliased] ?? 'txt';
  return `snippet.${extension}`;
}

function buildHighlightCacheKey(language: string, code: string) {
  let hash = 2166136261;

  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${language}:${hash >>> 0}:${code.length}`;
}

function getCachedHighlightResult(key: string) {
  if (!highlightCache.has(key)) {
    return undefined;
  }

  const value = highlightCache.get(key) ?? null;
  highlightCache.delete(key);
  highlightCache.set(key, value);
  return value;
}

function setCachedHighlightResult(key: string, value: HighlightResult | null) {
  if (highlightCache.has(key)) {
    highlightCache.delete(key);
  }

  highlightCache.set(key, value);

  while (highlightCache.size > MAX_HIGHLIGHT_CACHE_SIZE) {
    const oldestKey = highlightCache.keys().next().value;
    if (!oldestKey) {
      return;
    }

    highlightCache.delete(oldestKey);
  }
}

// ---------------------------------------------------------------------------
// Dual-theme token styling
// ---------------------------------------------------------------------------

const SHIKI_VAR = /^--shiki-([a-z0-9]+)(?:-(.+))?$/;

/** `background-color` → `backgroundColor`, for React's style object. */
function toCamelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function parseHtmlStyle(htmlStyle: Record<string, string> | string | undefined) {
  if (!htmlStyle) return null;
  if (typeof htmlStyle !== 'string') return htmlStyle;

  // Older shiki builds hand back the already-stringified form.
  const parsed: Record<string, string> = {};
  for (const declaration of htmlStyle.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    parsed[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
  }
  return parsed;
}

/**
 * Resolve one shiki token to a plain React style object for the active
 * theme.
 *
 * `htmlStyle` looks like
 * `{ color: '#24292e', '--shiki-dark': '#e1e4e8', '--shiki-dark-font-style': 'italic' }`
 * — the default (light) variant as real CSS properties, every other variant
 * behind a custom property. The upstream pattern is a global
 * `html.dark .shiki span { color: var(--shiki-dark) }` rule; resolving in JS
 * instead keeps the whole fix inside this component and avoids `!important`
 * fights with Tailwind.
 */
function tokenStyle(token: ShikiToken, variant: string): CSSProperties {
  const style: Record<string, string> = {};
  const htmlStyle = parseHtmlStyle(token.htmlStyle);

  if (!htmlStyle) {
    // Single-theme output — the flat token properties are populated.
    if (token.color) style.color = token.color;
    if (token.bgColor) style.backgroundColor = token.bgColor;
    return style as CSSProperties;
  }

  const variantStyle: Record<string, string> = {};

  for (const [key, value] of Object.entries(htmlStyle)) {
    if (!value || value === 'inherit') continue;

    const match = key.match(SHIKI_VAR);
    if (!match) {
      // Plain CSS property: the default variant's resolved value.
      style[toCamelCase(key)] = value;
      continue;
    }

    const [, tokenVariant, property] = match;
    if (tokenVariant !== variant) continue;
    variantStyle[toCamelCase(property ?? 'color')] = value;
  }

  // The requested variant, when present, overrides the default variant.
  return { ...style, ...variantStyle } as CSSProperties;
}

/** `light` | `dark` — App.tsx stamps the resolved scheme on `<html>`. */
function readThemeVariant(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function useThemeVariant(): 'light' | 'dark' {
  const [variant, setVariant] = useState<'light' | 'dark'>(readThemeVariant);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setVariant(readThemeVariant()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return variant;
}

// One code leading everywhere — CodeBlock, TerminalBlock and DiffBlock all
// render at `--code-font-size` with `leading-[1.55]`. The old `min-h-6`
// forced ~1.85 here while the terminal ran 1.45, so a snippet and the
// command output right below it never lined up.
const CODE_LINE = 'block whitespace-pre leading-[1.55]';

function renderPlainCode(code: string) {
  return code.split('\n').map((line, index) => (
    <span key={`${index}-${line.length || 0}`} className={CODE_LINE}>
      {line || ' '}
    </span>
  ));
}

function renderHighlightedCode(result: HighlightResult, variant: 'light' | 'dark') {
  return result.tokens.map((line, lineIndex) => (
    <span key={`line-${lineIndex}`} className={CODE_LINE}>
      {line.length > 0
        ? line.map((token, tokenIndex) => (
            <span key={`token-${lineIndex}-${tokenIndex}`} style={tokenStyle(token, variant)}>
              {token.content}
            </span>
          ))
        : ' '}
    </span>
  ));
}

export function CodeBlock({ code, language, isIncomplete = false, className }: CodeBlockProps) {
  const { copied, copy } = useClipboard();
  const [highlighted, setHighlighted] = useState<HighlightResult | null>(null);
  const [resolvedLanguage, setResolvedLanguage] = useState<string | null>(null);
  const variant = useThemeVariant();

  // `text` is our routing tag for untagged fences, not something worth
  // labelling — an unlabelled block reads cleaner than one labelled "code".
  const languageLabel = useMemo(() => {
    const resolved = resolveLanguageAlias(language);
    return !resolved || resolved === 'text' ? null : resolved;
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    void resolveLanguage(language).then((value) => {
      if (!cancelled) {
        setResolvedLanguage(value);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    if (isIncomplete || !resolvedLanguage) {
      setHighlighted(null);
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = buildHighlightCacheKey(resolvedLanguage, code);
    const cached = getCachedHighlightResult(cacheKey);
    if (cached !== undefined) {
      setHighlighted(cached);
      return () => {
        cancelled = true;
      };
    }

    let resolveHighlight: ((value: HighlightResult | null) => void) | null = null;

    const setResult = (value: HighlightResult | null) => {
      if (cancelled) {
        return;
      }
      setCachedHighlightResult(cacheKey, value);
      setHighlighted(value);
    };

    void loadHighlighter().then((highlighter) => {
      if (cancelled) {
        return;
      }
      const maybeResult = highlighter.highlight(
        {
          code,
          language: resolvedLanguage,
          themes: highlighter.getThemes(),
        },
        (result) => setResult(result),
      );

      if (resolveHighlight) {
        resolveHighlight(maybeResult);
      } else {
        setResult(maybeResult);
      }
    });

    return () => {
      cancelled = true;
      resolveHighlight = null;
    };
  }, [code, isIncomplete, resolvedLanguage]);

  const handleCopy = useCallback(() => {
    void copy(code);
  }, [code, copy]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getDownloadFilename(language);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [code, language]);

  return (
    <div
      className={cn(
        'group/code my-3 overflow-hidden rounded-lg border border-border-default bg-[var(--bg-subtle)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle/80 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-3">
          {languageLabel && (
            <span className="font-code-sans text-2xs font-normal lowercase tracking-[0.04em] text-text-faint">
              {languageLabel}
            </span>
          )}
          {isIncomplete && <span className="text-2xs text-text-faint">Streaming</span>}
        </div>

        {/*
          Hover- and focus-revealed: the chrome should not compete with the
          code at rest, but a keyboard user must still be able to reach it.
        */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border-subtle/80 p-0.5 opacity-0 transition-opacity duration-fast group-hover/code:opacity-100 group-focus-within/code:opacity-100 motion-reduce:transition-none">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-sm p-1.5 text-text-muted transition hover:bg-[var(--bg-subtle)] hover:text-text-primary"
                aria-label="Download code"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Download code</TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-text-muted transition hover:bg-[var(--bg-subtle)] hover:text-text-primary"
            aria-label={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="min-w-[34px] text-left text-2xs font-medium tracking-[0.01em]">
              <SlotLabel text={copied ? 'Copied' : 'Copy'} />
            </span>
          </button>
        </div>
      </div>

      {/*
        `bg`/`fg` from a dual-theme highlight are semicolon-joined custom
        property lists (`#24292e;--shiki-dark:#e1e4e8`) — CSSOM rejects them
        outright, so the old inline styles were silently dropped and took the
        intended fallback with them. The surface is a theme token instead.
      */}
      <pre
        className="app-code-text scrollbar-auto-hide m-0 max-h-[min(60vh,40rem)] overflow-auto bg-[var(--bg-code)] px-3 py-3 leading-[1.55] text-text-secondary"
      >
        {highlighted ? renderHighlightedCode(highlighted, variant) : renderPlainCode(code)}
      </pre>
    </div>
  );
}
