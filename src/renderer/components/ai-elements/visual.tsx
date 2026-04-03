import { AlertCircle, Check, Copy, Expand } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import type { ChatPartState, VisualThemeTokens } from '../../../shared/contracts';
import { buildVisualSrcDoc } from '../../../shared/visualDocument';
import { useClipboard } from '../../hooks/useClipboard';
import { cn } from '../../lib/utils';

type VisualBlockProps = {
  visualId: string;
  content: string;
  state: ChatPartState;
  title?: string;
  className?: string;
};

type VisualIframeMessage = {
  source?: string;
  type?: 'visual-ready' | 'visual-resize' | 'visual-error';
  visualId?: string;
  height?: number;
  message?: string;
};

class VisualUiErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('VisualBlock UI error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="my-3 rounded-xl border border-border/50 bg-bg-subtle/45 px-4 py-4 text-sm text-text-secondary">
          Something went wrong while rendering this visual block. Try collapsing the message or starting a new reply.
        </div>
      );
    }
    return this.props.children;
  }
}

function readThemeTokens(): VisualThemeTokens {
  if (typeof window === 'undefined') {
    return {
      colorScheme: 'dark',
      background: '#07080b',
      panel: '#101319',
      text: '#ffffff',
      mutedText: '#94a3b8',
      border: 'rgba(255, 255, 255, 0.08)',
      accent: '#60a5fa',
      errorBackground: 'rgba(244, 63, 94, 0.1)',
      errorBorder: 'rgba(244, 63, 94, 0.2)',
      errorText: '#fecdd3',
    };
  }

  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

  return {
    colorScheme: root.dataset.theme === 'light' ? 'light' : 'dark',
    background: read('--bg-base', '#07080b'),
    panel: read('--bg-surface', '#101319'),
    text: read('--text-primary', '#ffffff'),
    mutedText: read('--text-tertiary', '#94a3b8'),
    border: read('--border-default', 'rgba(255, 255, 255, 0.08)'),
    accent: read('--bg-button', '#ffffff'),
    errorBackground: read('--error-bg', 'rgba(244, 63, 94, 0.1)'),
    errorBorder: read('--error-border', 'rgba(244, 63, 94, 0.2)'),
    errorText: read('--error-text', '#fecdd3'),
  };
}

export function VisualBlock({ visualId, content, state, title, className }: VisualBlockProps) {
  const [theme, setTheme] = useState<VisualThemeTokens>(() => readThemeTokens());
  const [height, setHeight] = useState(220);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { copied, copy } = useClipboard();

  const trimmedContent = content.trim();
  const isStreaming = state === 'streaming';
  const isEmptyComplete = state === 'done' && trimmedContent.length === 0;

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(readThemeTokens());
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setErrorMessage(null);
    setHeight(220);
  }, [trimmedContent, visualId]);

  const srcdoc = useMemo(() => {
    if (trimmedContent.length === 0) {
      return '';
    }

    return buildVisualSrcDoc({
      visualId,
      content: trimmedContent,
      theme,
    });
  }, [trimmedContent, theme, visualId]);

  const handleMessage = useCallback((event: MessageEvent<VisualIframeMessage>) => {
    if (event.data?.source !== 'atlas-visual' || event.data.visualId !== visualId) {
      return;
    }

    if (event.data.type === 'visual-resize' && typeof event.data.height === 'number') {
      const next = event.data.height + 4;
      if (Number.isFinite(next)) {
        setHeight(Math.max(next, 140));
      }
      return;
    }

    if (event.data.type === 'visual-error') {
      setErrorMessage(event.data.message?.trim() || 'The visual failed to render.');
    }
  }, [visualId]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const openInWindow = useCallback(async () => {
    if (!trimmedContent) {
      return;
    }

    await window.atlasChat.chat.openVisualWindow({
      visualId,
      title,
      content: trimmedContent,
      theme,
    });
  }, [theme, title, trimmedContent, visualId]);

  const copySource = useCallback(async () => {
    if (!trimmedContent) {
      return;
    }

    await copy(trimmedContent);
  }, [copy, trimmedContent]);

  return (
    <VisualUiErrorBoundary key={visualId}>
      <div className={cn('group my-3 overflow-hidden rounded-xl border border-border/50 bg-bg-subtle/35', className)}>
        <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-bg-subtle px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold tracking-[0.02em] text-text-secondary">
              {title?.trim() || 'Inline visual'}
            </div>
            <div className="text-[11px] text-text-muted">
              {isStreaming ? 'Streaming visual…' : errorMessage ? 'Render failed' : 'Sandboxed visual'}
            </div>
          </div>
          <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => void copySource()}
              disabled={!trimmedContent}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-[11px] font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              title="Copy HTML/SVG source"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copied' : 'Copy source'}</span>
            </button>
            <button
              type="button"
              onClick={() => void openInWindow()}
              disabled={!trimmedContent}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-[11px] font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              title="Open visual in a separate window"
            >
              <Expand className="h-3.5 w-3.5" />
              <span>Expand</span>
            </button>
          </div>
        </div>

        {isStreaming ? (
          <div className="flex h-52 items-center justify-center bg-bg-subtle/55">
            <div className="flex flex-col items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-text-muted" />
              <span className="text-sm text-text-muted">Building visual...</span>
            </div>
          </div>
        ) : errorMessage || isEmptyComplete ? (
          <div className="flex min-h-44 items-center justify-center bg-bg-subtle/45 px-5 py-6">
            <div
              className="w-full max-w-lg rounded-2xl border px-4 py-4"
              style={{
                background: theme.errorBackground,
                borderColor: theme.errorBorder,
                color: theme.errorText,
              }}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="text-sm font-semibold">Visual could not be displayed</div>
                  <div className="mt-1 text-sm leading-6">
                    {errorMessage || 'The model finished the visual block without any renderable HTML or SVG content.'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <iframe
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            style={{ width: '100%', height, border: 'none', display: 'block' }}
            title={title?.trim() || 'visualization'}
          />
        )}
      </div>
    </VisualUiErrorBoundary>
  );
}
