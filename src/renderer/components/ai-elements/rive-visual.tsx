import { AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRive, useStateMachineInput, Layout, Fit, Alignment } from '@rive-app/react-webgl2';

import { cn } from '../../lib/utils';

type RiveVisualProps = {
  content: string;
  title?: string;
  className?: string;
};

type RiveConfig = {
  src: string;
  stateMachines?: string[];
  inputs?: Record<string, boolean | number | string>;
};

function parseRiveConfig(content: string): RiveConfig | null {
  const trimmed = content.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.src || parsed.url || parsed.animation) {
      return {
        src: parsed.src || parsed.url || parsed.animation,
        stateMachines: parsed.stateMachines || parsed.stateMachine ? [parsed.stateMachines || parsed.stateMachine] : undefined,
        inputs: parsed.inputs,
      };
    }
  } catch {
    // not JSON
  }

  const srcMatch = trimmed.match(/src\s*[:=]\s*["']([^"']+)["']/);
  if (srcMatch) {
    return {
      src: srcMatch[1],
    };
  }

  if (trimmed.startsWith('http') || trimmed.startsWith('data:')) {
    return { src: trimmed };
  }

  return null;
}

export function detectRiveContent(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  if (trimmed.includes('.riv') || trimmed.includes('rive')) return true;
  if (trimmed.includes('"src"') && (trimmed.includes('.riv') || trimmed.includes('data:'))) return true;
  return false;
}

const BUILT_IN_ANIMATIONS: Record<string, string> = {
  loading: 'https://public.rive.app/community/runtime-files/1350-2748-loading-animation.riv',
  check: 'https://public.rive.app/community/runtime-files/1424-2857-success-check.riv',
  error: 'https://public.rive.app/community/runtime-files/1425-2858-error-cross.riv',
};

export function RiveVisual({ content, title, className }: RiveVisualProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const config = parseRiveConfig(content);

  const resolvedSrc = config?.src
    ? BUILT_IN_ANIMATIONS[config.src] || config.src
    : null;

  const { RiveComponent, rive } = useRive({
    src: resolvedSrc || '',
    stateMachines: config?.stateMachines,
    layout: new Layout({
      fit: Fit.Contain,
      alignment: Alignment.Center,
    }),
    autoplay: true,
    onLoad: () => {
      setIsReady(true);
      setError(null);
    },
    onLoadError: (e) => {
      setError(`Failed to load Rive animation: ${e instanceof Error ? e.message : String(e)}`);
      setIsReady(false);
    },
  });

  useEffect(() => {
    if (!rive || !config?.inputs) return;

    Object.entries(config.inputs).forEach(([name, value]) => {
      const defaultValue = typeof value === 'string' ? 0 : value;
      const input = useStateMachineInput(rive, config.stateMachines?.[0] || '', name, defaultValue);
      if (input) {
        if (typeof value === 'boolean') input.value = value;
        else if (typeof value === 'number') input.value = value;
      }
    });
  }, [rive, config?.inputs, config?.stateMachines]);

  const handlePlay = useCallback(() => {
    rive?.play();
  }, [rive]);

  const handlePause = useCallback(() => {
    rive?.pause();
  }, [rive]);

  if (!resolvedSrc) {
    return (
      <div className={cn('my-3 rounded-xl border border-border/50 bg-bg-subtle/35', className)}>
        <div className="flex min-h-44 items-center justify-center px-5 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-error-border/20 bg-error-bg/10 px-4 py-4 text-error-text">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="text-sm font-semibold">Rive animation not found</div>
                <div className="mt-1 text-sm leading-6">
                  No valid Rive animation source was specified. Provide a .riv file URL or use a built-in animation name.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('my-3 rounded-xl border border-border/50 bg-bg-subtle/35', className)}>
        <div className="flex min-h-44 items-center justify-center px-5 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-error-border/20 bg-error-bg/10 px-4 py-4 text-error-text">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="text-sm font-semibold">Animation failed to load</div>
                <div className="mt-1 text-sm leading-6">{error}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('group my-3 overflow-hidden rounded-xl border border-border/50 bg-bg-subtle/35', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-bg-subtle px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold tracking-[0.02em] text-text-secondary">
            {title?.trim() || 'Rive animation'}
          </div>
          <div className="text-[11px] text-text-muted">
            {isReady ? 'Playing' : 'Loading...'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={handlePause}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-[11px] font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
            title="Pause animation"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={handlePlay}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-[11px] font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
            title="Play animation"
          >
            Play
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex h-64 w-full items-center justify-center bg-bg-subtle/55">
        {RiveComponent && <RiveComponent style={{ width: '100%', height: '100%' }} />}
      </div>
    </div>
  );
}
