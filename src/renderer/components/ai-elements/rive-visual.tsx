import { AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StateMachineInput } from '@rive-app/react-webgl2';
import { useRive, Layout, Fit, Alignment, StateMachineInputType } from '@rive-app/react-webgl2';

import { useReducedMotion } from '../../lib/reducedMotion';
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

/**
 * `stateMachines` reaches Rive as `string | string[]`, and `config.stateMachines[0]`
 * has to be a name we can hand to `rive.stateMachineInputs()`. The old expression
 * was `a || b ? [a || b] : undefined`, and `||` binds tighter than `?:` — so a JSON
 * config that already spelled `"stateMachines": ["Machine"]` (the documented shape)
 * got wrapped a second time into `[["Machine"]]`, and every downstream lookup was
 * handed an array where a name belonged.
 */
function normalizeStateMachines(value: unknown): string[] | undefined {
  const candidates = Array.isArray(value) ? value : [value];
  const names = candidates.filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  );
  return names.length > 0 ? names : undefined;
}

function parseRiveConfig(content: string): RiveConfig | null {
  const trimmed = content.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.src || parsed.url || parsed.animation) {
      return {
        src: parsed.src || parsed.url || parsed.animation,
        stateMachines: normalizeStateMachines(parsed.stateMachines ?? parsed.stateMachine),
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

/**
 * Rive has exactly three input types — Number, Boolean and Trigger (see
 * `StateMachineInputType`). There is no string input, so a string in the config
 * has nothing on the runtime side to be assigned to and is dropped.
 *
 * That drop was already happening: the old code computed
 * `defaultValue = typeof value === 'string' ? 0 : value` and then had no branch
 * that assigned a string. The `0` was dead — worse than dead, because it made the
 * string look handled while quietly seeding the input with zero. The behaviour is
 * right; only the pretence is gone.
 *
 * Matching on the input's declared type also stops the config from writing a
 * boolean into a Number input, and gives Trigger inputs the one thing they
 * understand: `fire()`. A trigger carries no value, so `true` is the only way this
 * config shape can ask for one, and `input.value = true` would have been a no-op.
 */
function applyRiveInput(input: StateMachineInput, value: boolean | number | string): void {
  switch (input.type) {
    case StateMachineInputType.Trigger:
      if (value === true) input.fire();
      return;
    case StateMachineInputType.Boolean:
      if (typeof value === 'boolean') input.value = value;
      return;
    case StateMachineInputType.Number:
      if (typeof value === 'number' && Number.isFinite(value)) input.value = value;
      return;
    default:
      return;
  }
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

  /**
   * This is content, not chrome: the model emitted a `<visual>` block and the user is
   * reading it, so the fix here is *autoplay*, not the animation. Reduce motion means
   * nothing starts moving without being asked; it does not mean the user is refused
   * the thing they were shown. The Play control below already exists, so withholding
   * autoplay costs one click rather than access.
   *
   * The hook rather than the imperative read, because a transcript stays mounted for a
   * long time and a mid-session toggle has to reach an animation that is already looping.
   */
  const reducedMotion = useReducedMotion();
  const [isPlaying, setIsPlaying] = useState(!reducedMotion);

  /**
   * Memoised because `parseRiveConfig` builds a fresh object every call, and the
   * input effect below depends on `config`. Parsing on each render handed that
   * effect a new `inputs` reference every render, so its dependency array never
   * held it still and the effect re-ran on every single render — including the
   * renders caused by hovering the controls.
   */
  const config = useMemo(() => parseRiveConfig(content), [content]);

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
    autoplay: !reducedMotion,
    onLoad: () => {
      setIsReady(true);
      setError(null);
    },
    onLoadError: (e) => {
      setError(`Failed to load Rive animation: ${e instanceof Error ? e.message : String(e)}`);
      setIsReady(false);
    },
  });

  /**
   * `useStateMachineInput` used to be called from inside this effect, inside a
   * `forEach` over `config.inputs` — a map whose size comes from model-emitted
   * content. That breaks the rules of hooks twice over: a hook cannot run from a
   * callback at all, and the number of hook calls per render cannot depend on
   * data. React indexes hooks positionally, so a config that grew or shrank
   * between renders would slide every later hook in this component onto the wrong
   * slot.
   *
   * A map of unknown size cannot be expressed as a fixed list of hook calls, so
   * the fix is to stop using a hook. The loaded Rive instance exposes the same
   * inputs imperatively via `stateMachineInputs(name)` — which is in fact all
   * `useStateMachineInput` does internally, wrapped in state we do not need here.
   * It is happy inside an effect and happy with any number of inputs.
   *
   * `useRive` only publishes `rive` from its `Load` handler, so by the time this
   * runs the state machine is instanced and its inputs exist.
   */
  useEffect(() => {
    const requested = config?.inputs;
    if (!rive || !requested) return;

    // `|| ''` here used to guarantee a miss whenever the config named no state
    // machine; the artboard's own first machine is the thing the config meant.
    const stateMachineName = config.stateMachines?.[0] ?? rive.stateMachineNames[0];
    if (!stateMachineName) return;

    const available = new Map(
      rive.stateMachineInputs(stateMachineName).map((input) => [input.name, input]),
    );

    for (const [name, value] of Object.entries(requested)) {
      const input = available.get(name);
      if (input) applyRiveInput(input, value);
    }
  }, [rive, config]);

  // `autoplay` is only read when the runtime initialises, so it cannot answer for a
  // toggle that happens later. Stop what is already looping; do not auto-resume when
  // the setting goes back off — restarting motion the user never asked for is the same
  // mistake in the other direction, and Play is right there.
  useEffect(() => {
    if (!rive || !reducedMotion) return;
    rive.pause();
    setIsPlaying(false);
  }, [rive, reducedMotion]);

  const handlePlay = useCallback(() => {
    rive?.play();
    setIsPlaying(true);
  }, [rive]);

  const handlePause = useCallback(() => {
    rive?.pause();
    setIsPlaying(false);
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
          {/* Was hardcoded 'Playing', which would now lie whenever autoplay was withheld. */}
          <div className="text-2xs text-text-muted">
            {isReady ? (isPlaying ? 'Playing' : 'Paused') : 'Loading…'}
          </div>
        </div>
        {/*
          Hover-revealed controls are fine next to something already playing, but if
          autoplay was withheld then Play is the only way in — and hiding the only way
          in behind a hover is not a way in at all for keyboard and touch. Under reduced
          motion the controls stay visible.
        */}
        <div
          className={cn(
            'flex items-center gap-1.5 transition-opacity',
            reducedMotion
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={handlePause}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-2xs font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
            title="Pause animation"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={handlePlay}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-2xs font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
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
