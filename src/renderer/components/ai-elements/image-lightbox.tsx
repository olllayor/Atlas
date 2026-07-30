import { Download, Minus, Plus, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { notify } from '../../lib/notify';
import { cn } from '../../lib/utils';

/** Multiplier per zoom step. 1.25 reaches 2× in three presses. */
const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
/** Chrome the image must not sit under: the buttons and the zoom pill. */
const VIEWPORT_INSET = 128;

type ImageLightboxProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  /** Used for the accessible name and as the download filename. */
  filename: string;
};

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/**
 * Full-window image viewer: scrim, fit-to-window image, download and close in
 * the top-right, and a zoom pill along the bottom.
 *
 * Zoom is expressed against the image's *natural* size, not against whatever
 * it happened to open at, so the readout answers "how much of the real pixels
 * am I seeing" rather than "how far have I strayed from the default". A 4000px
 * photo therefore opens at something like 37%, and 100% is always 1:1.
 */
export function ImageLightbox({ open, onOpenChange, src, filename }: ImageLightboxProps) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  /** null until the user touches the controls — until then the fit wins. */
  const [userScale, setUserScale] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reopening on a different attachment must not inherit the last one's zoom.
  useEffect(() => {
    if (!open) {
      return;
    }
    setNatural(null);
    setUserScale(null);
    setFitScale(1);
  }, [open, src]);

  /**
   * The scale at which the whole image is visible. Recomputed on resize —
   * a viewer that keeps its launch-time fit is wrong the moment the window
   * changes, and this one has no other way back to "show me all of it".
   */
  useEffect(() => {
    if (!natural) {
      return;
    }

    const measure = () => {
      const availableWidth = Math.max(1, window.innerWidth - VIEWPORT_INSET);
      const availableHeight = Math.max(1, window.innerHeight - VIEWPORT_INSET);
      // Never scale *up* to fit: a 40px icon blown across the window is worse
      // than a 40px icon.
      setFitScale(
        clampScale(Math.min(1, availableWidth / natural.width, availableHeight / natural.height))
      );
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [natural]);

  const scale = userScale ?? fitScale;

  const zoomBy = useCallback(
    (factor: number) => setUserScale((current) => clampScale((current ?? fitScale) * factor)),
    [fitScale]
  );

  /**
   * Fetch first, then save the bytes through an object URL.
   *
   * `<a download>` pointed straight at `src` only honours the attribute for
   * same-origin and `data:`/`blob:` URLs — a stored attachment on its own
   * scheme would navigate instead of saving. Going through a blob makes every
   * source behave the same.
   */
  const download = useCallback(async () => {
    let objectUrl: string | null = null;

    try {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`The image could not be read (${response.status}).`);
      }

      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename || 'image';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Could not save the image',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      // Revoking synchronously races the download; a grace period is enough.
      const created = objectUrl;
      if (created) {
        setTimeout(() => URL.revokeObjectURL(created), 10_000);
      }
    }
  }, [filename, src]);

  // Radix handles Escape; the zoom keys are ours.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        setUserScale(null);
      }
    },
    [zoomBy]
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 duration-normal data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col outline-none duration-normal data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">{filename}</DialogPrimitive.Title>

          {/*
            The scroller *is* the backdrop hit target: clicking the empty space
            around a zoomed-in image closes the viewer, which is the gesture
            everyone tries first. The image itself stops the event.
          */}
          <div
            ref={scrollRef}
            onClick={() => onOpenChange(false)}
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
          >
            <img
              alt={filename}
              src={src}
              onClick={(event) => event.stopPropagation()}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              style={
                natural
                  ? { width: natural.width * scale, height: natural.height * scale }
                  : undefined
              }
              className="max-w-none select-none rounded-md"
            />
          </div>

          <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2">
            <LightboxButton label="Download image" onClick={() => void download()}>
              <Download className="size-4.5" strokeWidth={1.75} aria-hidden />
            </LightboxButton>
            <LightboxButton label="Close" onClick={() => onOpenChange(false)}>
              <X className="size-4.5" strokeWidth={1.75} aria-hidden />
            </LightboxButton>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-bg-elevated p-1 shadow-elevated">
              <LightboxButton
                label="Zoom out"
                onClick={() => zoomBy(1 / ZOOM_STEP)}
                disabled={scale <= MIN_SCALE}
                bare
              >
                <Minus className="size-4.5" strokeWidth={1.75} aria-hidden />
              </LightboxButton>
              {/* Click resets to fit — the only way back once you have zoomed. */}
              <button
                type="button"
                onClick={() => setUserScale(null)}
                title="Fit to window"
                className="min-w-14 rounded-full px-2 py-1 text-sm tabular-nums text-text-primary transition-colors hover:bg-bg-hover"
              >
                {Math.round(scale * 100)}%
              </button>
              <LightboxButton
                label="Zoom in"
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={scale >= MAX_SCALE}
                bare
              >
                <Plus className="size-4.5" strokeWidth={1.75} aria-hidden />
              </LightboxButton>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LightboxButton({
  label,
  onClick,
  disabled,
  bare,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Inside the zoom pill, which already supplies the surface. */
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'pointer-events-auto flex size-9 items-center justify-center rounded-full text-text-primary transition-colors',
        'hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-40',
        bare ? '' : 'bg-bg-elevated shadow-elevated'
      )}
    >
      {children}
    </button>
  );
}
