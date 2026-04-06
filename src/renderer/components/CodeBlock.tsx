import { code as codeHighlighter, type HighlightResult } from '@streamdown/code';
import { Check, Copy, Download } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '../lib/utils';
import { useClipboard } from '../hooks/useClipboard';

type CodeBlockProps = {
  code: string;
  language?: string;
  isIncomplete?: boolean;
  meta?: string;
  className?: string;
};

type SupportedLanguage = ReturnType<typeof codeHighlighter.getSupportedLanguages>[number];

const MAX_HIGHLIGHT_CACHE_SIZE = 120;
const highlightCache = new Map<string, HighlightResult | null>();

const supportedLanguages = new Set<SupportedLanguage>(codeHighlighter.getSupportedLanguages());

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
  zsh: 'zsh',
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

export const streamdownCodeLanguages = Array.from(
  new Set<string>([
    ...supportedLanguages,
    ...Object.keys(languageAliases),
    'text',
  ])
);

function resolveLanguage(language?: string): SupportedLanguage | null {
  const normalized = language?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const aliased = (languageAliases[normalized] ?? normalized) as SupportedLanguage;
  return supportedLanguages.has(aliased) ? aliased : null;
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

  const resolvedLanguage = useMemo(() => resolveLanguage(language), [language]);
  const languageLabel = (language?.trim() || 'code').toLowerCase();

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

    const maybeResult = codeHighlighter.highlight(
      {
        code,
        language: resolvedLanguage,
        themes: codeHighlighter.getThemes(),
      },
      (result) => {
        if (!cancelled) {
          setCachedHighlightResult(cacheKey, result);
          setHighlighted(result);
        }
      }
    );

    setCachedHighlightResult(cacheKey, maybeResult);
    setHighlighted(maybeResult);

    return () => {
      cancelled = true;
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
            <Download className="h-3.25 w-3.25" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 text-text-muted transition hover:bg-[var(--bg-subtle)] hover:text-text-primary"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? <Check className="h-3.25 w-3.25 text-[var(--text-tertiary)]" /> : <Copy className="h-3.25 w-3.25" />}
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
