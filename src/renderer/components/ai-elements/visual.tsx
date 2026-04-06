import { AlertCircle, Bookmark, Check, Copy, Expand } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatPartState, VisualThemeTokens } from '../../../shared/contracts';
import { detectRequiredLibraries } from '../../../shared/visualParser';
import { buildVisualSrcDoc } from '../../../shared/visualDocument';
import { chartJs, d3Js } from '../../visual/bundles';
import { detectDiagramSpec, InteractiveDiagram } from './interactive-diagram';
import { detectRiveContent, RiveVisual } from './rive-visual';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(120);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    heightRef.current = 120;
  }, [trimmedContent, visualId]);

  const isDiagram = useMemo(() => {
    if (isStreaming || isEmptyComplete) return false;
    return detectDiagramSpec(trimmedContent);
  }, [isStreaming, isEmptyComplete, trimmedContent]);

  const isRive = useMemo(() => {
    if (isStreaming || isEmptyComplete) return false;
    return detectRiveContent(trimmedContent);
  }, [isStreaming, isEmptyComplete, trimmedContent]);

  const requiredLibraries = useMemo(() => {
    const detected = detectRequiredLibraries(trimmedContent);
    const libs: string[] = [];
    if (detected.includes('chartjs')) libs.push(chartJs);
    if (detected.includes('d3')) libs.push(d3Js);
    return libs;
  }, [trimmedContent]);

  const srcdoc = useMemo(() => {
    if (trimmedContent.length === 0) {
      return '';
    }

    return buildVisualSrcDoc({
      visualId,
      content: trimmedContent,
      theme,
      libraries: requiredLibraries,
    });
  }, [trimmedContent, theme, visualId, requiredLibraries]);

  const handleMessage = useCallback((event: MessageEvent<VisualIframeMessage>) => {
    if (event.data?.source !== 'atlas-visual' || event.data.visualId !== visualId) {
      return;
    }

    if (event.data.type === 'visual-resize' && typeof event.data.height === 'number') {
      const newHeight = Math.max(event.data.height, 120);
      if (!Number.isFinite(newHeight)) return;
      if (Math.abs(newHeight - heightRef.current) <= 2) return;
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        heightRef.current = newHeight;
        setHeight(newHeight);
        resizeTimerRef.current = null;
      }, 50);
      return;
    }

    if (event.data.type === 'visual-error') {
      console.error('[VisualBlock] iframe error:', event.data);
      setErrorMessage(event.data.message?.trim() || 'The visual failed to render.');
    }
  }, [visualId]);

  useEffect(() => {
    return () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const openInWindow = useCallback(async () => {
    if (!trimmedContent) return;
    await window.atlasChat.chat.openVisualWindow({
      visualId,
      title,
      content: trimmedContent,
      theme,
    });
  }, [theme, title, trimmedContent, visualId]);

  const copySource = useCallback(async () => {
    if (!trimmedContent) return;
    await copy(trimmedContent);
  }, [copy, trimmedContent]);

  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const saveVisual = useCallback(async () => {
    if (!trimmedContent || isSaving) return;
    setIsSaving(true);
    try {
      const visualType = isDiagram ? 'diagram' : isRive ? 'rive' : 'iframe';
      await window.atlasChat.visuals.save({
        title: title?.trim() || 'Untitled visual',
        content: trimmedContent,
        visualType,
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save visual:', e);
    } finally {
      setIsSaving(false);
    }
  }, [trimmedContent, isSaving, isDiagram, isRive, title]);

  return (
    <VisualUiErrorBoundary key={visualId}>
      <div ref={containerRef} className={cn('group relative -mx-6 my-4 w-[calc(100%+3rem)] sm:-mx-7 sm:w-[calc(100%+3.5rem)] lg:-mx-7 lg:w-[calc(100%+3.5rem)] xl:-mx-8 xl:w-[calc(100%+4rem)]', className)}>
        {!isStreaming && !errorMessage && !isEmptyComplete && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-border/30 bg-bg-surface/90 px-1.5 py-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => void saveVisual()}
              disabled={isStreaming}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted transition hover:text-text-primary',
                isSaved && 'text-accent'
              )}
              title="Save to gallery"
            >
              <Bookmark className={cn('h-3.5 w-3.5', isSaved && 'fill-accent')} />
              {isSaved ? 'Saved' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => void copySource()}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted transition hover:text-text-primary"
              title="Copy source"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => void openInWindow()}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted transition hover:text-text-primary"
              title="Expand"
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {isStreaming ? (
          <div className="flex h-52 w-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-text-muted" />
              <span className="text-sm text-text-muted">Building visual...</span>
            </div>
          </div>
        ) : errorMessage || isEmptyComplete ? (
          <div className="flex min-h-44 w-full items-center justify-center px-5 py-6">
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
        ) : isDiagram ? (
          <InteractiveDiagram
            content={trimmedContent}
            title={title}
            className="border-0 bg-transparent"
          />
        ) : isRive ? (
          <RiveVisual
            content={trimmedContent}
            title={title}
            className="border-0 bg-transparent"
          />
        ) : (
          <iframe
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            style={{
              width: '100%',
              height: Math.max(height, 120),
              maxHeight: '80vh',
              border: 'none',
              display: 'block',
              background: 'transparent',
              overflow: 'hidden',
            }}
            title={title?.trim() || 'visualization'}
          />
        )}
      </div>
    </VisualUiErrorBoundary>
  );
}
