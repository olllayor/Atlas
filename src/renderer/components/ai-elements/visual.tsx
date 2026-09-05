import { AlertCircle, Bookmark, Check, Copy, Expand } from 'lucide-react';
import {
  Component,
  Suspense,
  lazy,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ChatPartState, VisualThemeTokens } from '../../../shared/contracts';
import { detectRequiredLibraries } from '../../../shared/visualParser';
import { buildVisualSrcDoc } from '../../../shared/visualDocument';
import { chartJs, d3Js } from '../../visual/bundles';
import { detectDiagramSpec } from '../../../shared/diagramSpec';
import { detectRiveContent } from './riveContent';
import { useClipboard } from '../../hooks/useClipboard';
import { SlotLabel } from '../ui/slot-label';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { AtlasLoader } from '../ui/atlas-loader';
import { notify } from '../../lib/notify';
import { cn } from '../../lib/utils';

/*
  The two heaviest renderers a visual can ask for, split out of the entry chunk.
  A diagram pulls in the flow-graph library and its layout engine; a Rive block
  pulls in the WebGL2 runtime. Most transcripts contain neither, and the choice
  is made from the visual's own content, so the import can wait until one
  actually arrives.
*/
const InteractiveDiagram = lazy(() =>
  import('./interactive-diagram').then((module) => ({ default: module.InteractiveDiagram }))
);
const RiveVisual = lazy(() =>
  import('./rive-visual').then((module) => ({ default: module.RiveVisual }))
);

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

/**
 * The theme contract handed to sandboxed visual documents.
 *
 * Exported so the gallery's preview can build its `srcdoc` the same way the
 * transcript does — a saved visual rendered without these tokens comes back
 * unthemed (black text on transparent) and looks broken.
 */
export function readThemeTokens(): VisualThemeTokens {
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

/**
 * Placeholder while a diagram or Rive chunk loads. Sized like the block it is
 * standing in for so the transcript does not jump when the real one lands.
 */
function VisualRendererFallback() {
  return (
    <div className="flex h-48 items-center justify-center text-xs text-text-muted">
      <AtlasLoader size="sm" />
    </div>
  );
}

export function VisualBlock({ visualId, content, state, title, className }: VisualBlockProps) {
  const [theme, setTheme] = useState<VisualThemeTokens>(() => readThemeTokens());
  const [height, setHeight] = useState(220);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { copied, copy } = useClipboard();
  const heightRef = useRef(120);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight
  );

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
      // The "Saved" flash timer used to be started with no handle kept, so
      // unmounting mid-flash left it to fire `setIsSaved` on a dead
      // component.
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
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
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setIsSaved(false), 2000);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('Failed to save visual:', e);
      notify({ tone: 'error', title: 'Could not save the visual', description: message });
    } finally {
      setIsSaving(false);
    }
  }, [trimmedContent, isSaving, isDiagram, isRive, title]);

  // The iframe is clipped at 80vh with `overflow: hidden`, which silently
  // eats the bottom of any taller visual. Knowing when that happens lets us
  // fade the cut edge and promote the escape hatch instead of pretending the
  // visual simply ends there.
  const maxVisualHeight = Math.round(viewportHeight * 0.8);
  const isClipped = !isStreaming && !errorMessage && !isEmptyComplete && !isDiagram && !isRive
    ? Math.max(height, 120) > maxVisualHeight
    : false;

  return (
    <VisualUiErrorBoundary key={visualId}>
      {/*
        A visual sits in the message column, not outside it.

        This used to bleed sideways with `-mx-6 … xl:-mx-8` plus a matching
        `w-[calc(100% + …)]`, which was written to cancel the transcript's
        *inner* padding back when the transcript had any (`px-6 lg:px-7
        xl:px-8` inside its max width). That padding now lives outside the
        max width (`ChatWindow.COLUMN_PADDING`), so the negative margins
        cancelled nothing: they dragged every visual 24–32px left of the
        message text and the composer slab, while the right edge stopped
        short of both. Three elements in one column, three different left
        edges. Full width of the measure, no bleed, is the whole fix —
        anything wider than the column has the expand button.
      */}
      <div className={cn('group relative my-4 w-full', className)}>
        {!isStreaming && !errorMessage && !isEmptyComplete && (
          <div
            className={cn(
              'absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-border/30 bg-bg-surface/90 px-1.5 py-1 backdrop-blur-sm transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none',
              // A clipped visual must always advertise the way to see the
              // rest of it — a zero-opacity escape hatch is not an escape
              // hatch.
              isClipped ? 'opacity-100' : 'opacity-0'
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void saveVisual()}
                  disabled={isStreaming}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-md px-2 text-2xs font-medium text-text-muted transition hover:text-text-primary',
                    isSaved && 'text-accent'
                  )}
                >
                  <Bookmark className={cn('h-3.5 w-3.5', isSaved && 'fill-accent')} />
                  {/* Fixed width: "Save" → "Saved" used to reflow the whole toolbar. */}
                  <span className="inline-block min-w-[34px] text-left">
                    <SlotLabel text={isSaved ? 'Saved' : 'Save'} />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Save to gallery</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void copySource()}
                  aria-label="Copy source"
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-2xs font-medium text-text-muted transition hover:text-text-primary"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied' : 'Copy source'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void openInWindow()}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-2xs font-medium text-text-muted transition hover:text-text-primary"
                  aria-label="Open full size"
                >
                  <Expand className="h-3.5 w-3.5" />
                  {isClipped && <span>Open full size</span>}
                </button>
              </TooltipTrigger>
              <TooltipContent>Open full size</TooltipContent>
            </Tooltip>
          </div>
        )}

        {isStreaming ? (
          <div className="flex h-52 w-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <AtlasLoader size="md" real />
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
          // `hideChrome` — this block already floats its own save/copy/expand
          // toolbar, and the diagram's header used to sit underneath it with
          // a second copy button.
          // `bg-transparent` used to ride along here and did nothing — the
          // diagram paints its surface as an inline style, which a class
          // cannot override — so the card lost only its border and read as a
          // borderless slab floating in the transcript.
          <Suspense fallback={<VisualRendererFallback />}>
            <InteractiveDiagram content={trimmedContent} title={title} hideChrome className="my-0" />
          </Suspense>
        ) : isRive ? (
          <Suspense fallback={<VisualRendererFallback />}>
            <RiveVisual
              content={trimmedContent}
              title={title}
              className="border-0 bg-transparent"
            />
          </Suspense>
        ) : (
          <div className="relative">
            <iframe
              srcDoc={srcdoc}
              sandbox="allow-scripts"
              style={{
                width: '100%',
                height: Math.max(height, 120),
                maxHeight: `${maxVisualHeight}px`,
                border: 'none',
                display: 'block',
                background: 'transparent',
                overflow: 'hidden',
              }}
              title={title?.trim() || 'visualization'}
            />
            {isClipped && (
              // A soft cut edge, so a truncated visual reads as truncated
              // rather than as one that happens to end abruptly.
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-bg-base"
              />
            )}
          </div>
        )}
      </div>
    </VisualUiErrorBoundary>
  );
}
