import { Check, Copy, Download } from 'lucide-react';

import { SlotLabel } from './ui/slot-label';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import { cn } from '../lib/utils';
import { useClipboard } from '../hooks/useClipboard';

type CodeBlockProps = {
  code: string;
  language?: string;
  isIncomplete?: boolean;
  meta?: string;
  className?: string;
};

type HighlightResult = {
  tokens: Array<Array<{ content: string; color?: string; bgColor?: string }>>;
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

const languageAliases: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  txt: 'text',
  plaintext: 'text',
};

const fileExtensions: Record<string, string> = {
  javascript: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  tsx: 'tsx',
  python: 'py',
  bash: 'sh',
  zsh: 'sh',
  json: 'json',
  html: 'html',
  css: 'css',
  markdown: 'md',
  yaml: 'yml',
  sql: 'sql',
  rust: 'rs',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
};

// Static language list kept for streamdown's renderer match check. We pass
// this to Streamdown so it knows which languages should hand off to our
// custom CodeBlock. Streamdown only uses the list to filter — it does not
// require a real shiki grammar to be present here. See codeLanguages.ts.


async function resolveLanguage(language?: string): Promise<string | null> {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const aliased = languageAliases[normalized] ?? normalized;
  const supported = await loadSupportedLanguages();
  return supported.has(aliased) ? aliased : null;
}

function getDownloadFilename(language?: string) {
  const normalized = language?.trim().toLowerCase();
  const aliased = normalized ? languageAliases[normalized] ?? normalized : 'text';
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

function renderPlainCode(code: string) {
  return code.split('\n').map((line, index) => (
    <span key={`${index}-${line.length || 0}`} className="block min-h-6 whitespace-pre">
      {line || ' '}
    </span>
  ));
}

function renderHighlightedCode(result: HighlightResult) {
  return result.tokens.map((line, lineIndex) => (
    <span key={`line-${lineIndex}`} className="block min-h-6 whitespace-pre">
      {line.length > 0
        ? line.map((token, tokenIndex) => (
            <span
              key={`token-${lineIndex}-${tokenIndex}`}
              style={
                {
                  backgroundColor: token.bgColor,
                  color: token.color,
                } satisfies CSSProperties
              }
            >
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
  const languageLabel = (language?.trim() || 'code').toLowerCase();

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
        'group/code my-3 overflow-hidden border border-border-default bg-[var(--bg-subtle)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-code-sans text-[10px] font-normal uppercase tracking-[0.16em] text-text-faint">
            {languageLabel}
          </span>
          {isIncomplete && <span className="text-[10px] text-text-faint">Streaming</span>}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 border border-border-subtle/80 p-0.5">
          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 text-text-muted transition hover:bg-[var(--bg-subtle)] hover:text-text-primary"
            title="Download code"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-1.5 py-1 text-text-muted transition hover:bg-[var(--bg-subtle)] hover:text-text-primary"
            title={copied ? 'Copied!' : 'Copy code'}
            aria-label={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="min-w-[34px] text-left text-[11px] font-medium tracking-[0.01em]">
              <SlotLabel text={copied ? 'Copied' : 'Copy'} />
            </span>
          </button>
        </div>
      </div>

      <pre
        className="app-code-text m-0 overflow-x-auto px-3 py-3 text-text-secondary"
        style={{
          background: highlighted?.bg ?? 'linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.008))',
          color: highlighted?.fg ?? 'var(--text-secondary)',
        }}
      >
        {highlighted ? renderHighlightedCode(highlighted) : renderPlainCode(code)}
      </pre>
    </div>
  );
}
