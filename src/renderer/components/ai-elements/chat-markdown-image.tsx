import { AlertTriangle } from 'lucide-react';
import {
  useCallback,
  useState,
  type CSSProperties,
  type ComponentProps
} from 'react';

import { cn } from '../../lib/utils';
import { ImageLightbox } from './image-lightbox';

export type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export function meaningfulHastChildren(node: HastNode): HastNode[] {
  return (node.children ?? []).filter(
    (child) => !(child.type === 'text' && (child as { value?: string }).value?.trim() === '')
  );
}

/** Containers whose sole child image reads as a figure rather than part of a sentence. */
const STANDALONE_IMAGE_BLOCKS = new Set([
  'p',
  'div',
  'li',
  'td',
  'th',
  'figure',
  'center',
  'blockquote'
]);

export function soleImageDescendant(node: HastNode): HastNode | undefined {
  const children = meaningfulHastChildren(node);
  if (children.length !== 1) return undefined;
  const only = children[0];
  if (only?.type !== 'element') return undefined;
  if (only.tagName === 'img') return only;
  // A link, emphasis, or similar inline wrapper around the image still counts
  // as long as nothing else shares the block.
  return only.tagName === 'a' || only.tagName === 'strong' || only.tagName === 'em'
    ? soleImageDescendant(only)
    : undefined;
}

/**
 * An image that is the only content of its block (optionally wrapped in a
 * link) is almost always a screenshot or figure, so it gets a reserved slot
 * while it loads. Images mixed with text or other images — badge rows, icons
 * in a sentence — stay inline at their natural size, since a placeholder taller
 * than the image would move the page more than the image itself does.
 */
export function rehypeMarkStandaloneImages() {
  return (tree: HastNode) => {
    const mark = (node: HastNode) => {
      if (node.type === 'root' || (node.tagName && STANDALONE_IMAGE_BLOCKS.has(node.tagName))) {
        const image = soleImageDescendant(node);
        if (image) {
          image.properties = { ...image.properties, 'data-standalone': 'true' };
        }
      }
      node.children?.forEach((child) => {
        if (child.type === 'element') mark(child);
      });
    };
    mark(tree);
  };
}

export function resolveImageStatus(input: {
  src: string | null;
  loadedSrc: string | null;
  failedSrc: string | null;
  standalone: boolean;
  sourceFailed?: boolean;
}): { effectiveSrc: string | null; failed: boolean; settled: boolean } {
  const effectiveSrc = input.src ?? input.loadedSrc;
  const failed =
    input.sourceFailed === true || (effectiveSrc !== null && input.failedSrc === effectiveSrc);
  // Standalone images settle only once their own URL decoded. Any decoded
  // bitmap is not enough: a new URL for a different file must load behind
  // the slot, otherwise it renders bare at zero height and shifts the page.
  // A null src falls back to the last decoded image so re-resolution (or a
  // re-signed URL swap upstream) keeps pixels on screen.
  const settled =
    effectiveSrc !== null && !failed && (!input.standalone || input.loadedSrc === effectiveSrc);
  return { effectiveSrc, failed, settled };
}

/**
 * The URL a decoded image should be recorded under.
 *
 * This is the URL we *asked for*, never `image.currentSrc`: the browser
 * resolves relative sources, so `currentSrc` can never equal a relative `src`,
 * and `settled` requires the two to match. An image already complete at mount
 * does not fire `onLoad` either, so recording `currentSrc` would leave it
 * behind the 16:9 slot permanently — worse than the layout shift this whole
 * component exists to prevent.
 */
export function decodedSrcFromImage(
  image: HTMLImageElement | null,
  requested: string | null
): string | null {
  if (requested === null) return null;
  return image?.complete === true && image.naturalWidth > 0 ? requested : null;
}

export function authoredImageSizeStyle(
  width: string | number | undefined,
  height: string | number | undefined
): CSSProperties | undefined {
  const parsedWidth = typeof width === 'number' ? `${width}px` : width;
  const parsedHeight = typeof height === 'number' ? `${height}px` : height;
  if (!parsedWidth && !parsedHeight) return undefined;
  return {
    ...(parsedWidth ? { width: parsedWidth } : {}),
    ...(parsedHeight ? { height: parsedHeight } : {})
  };
}

export interface ChatMarkdownImageProps
  extends Omit<ComponentProps<'img'>, 'src' | 'alt' | 'style'> {
  src?: string;
  /**
   * The source can never resolve (a missing file, an unresolvable asset URL).
   * Renders the failure state in the slot instead of reporting "loading"
   * forever. Defaults to true when there is no `src` at all.
   */
  sourceFailed?: boolean;
  alt?: string;
  style?: CSSProperties;
  width?: string | number;
  height?: string | number;
  'data-standalone'?: string | boolean;
  node?: unknown;
}

/**
 * A standalone image holds a 16:9 slot (or its authored size) until it has
 * decoded, and keeps that slot if it fails, so a timeline row moves at most
 * once: when the natural size arrives. A bare `<img>` is zero height until
 * then. Once decoded the image renders bare again so its box, hit area, and
 * alignment are exactly the image's own. Inline images (badges, icons in a
 * sentence) skip the slot: a placeholder taller than the image would move the
 * page more than the image does (PR #9938).
 */
export function ChatMarkdownImage({
  src,
  sourceFailed,
  alt = '',
  className,
  style,
  width,
  height,
  'data-standalone': dataStandalone,
  node: _node,
  ...imgProps
}: ChatMarkdownImageProps) {
  const standalone = dataStandalone === true || dataStandalone === 'true';
  const authoredSize = authoredImageSizeStyle(width, height);
  const combinedStyle = { ...authoredSize, ...style };

  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const { effectiveSrc, failed, settled } = resolveImageStatus({
    src: src ?? null,
    loadedSrc,
    failedSrc,
    standalone,
    // An image with no source at all can never decode, so it is a failure
    // rather than an open-ended "loading" slot.
    sourceFailed: sourceFailed ?? (src === undefined || src === '')
  });

  const markLoadedIfComplete = useCallback(
    (image: HTMLImageElement | null) => {
      const decoded = decodedSrcFromImage(image, effectiveSrc);
      if (decoded !== null) setLoadedSrc(decoded);
    },
    [effectiveSrc]
  );

  const imageEvents = (loadingSrc: string) => ({
    onLoad: () => {
      setLoadedSrc(loadingSrc);
      setFailedSrc(null);
    },
    onError: () => {
      setFailedSrc(loadingSrc);
      setLoadedSrc(null);
    }
  });

  if (settled && effectiveSrc) {
    return (
      <>
        <img
          {...imgProps}
          ref={markLoadedIfComplete}
          src={effectiveSrc}
          alt={alt}
          decoding="async"
          draggable={false}
          className={cn(
            'inline-block h-auto w-auto max-h-[30rem] max-w-[min(100%,30rem)] rounded-lg object-contain cursor-zoom-in',
            className
          )}
          style={combinedStyle}
          onClick={() => setLightboxOpen(true)}
          {...imageEvents(effectiveSrc)}
        />
        <ImageLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={effectiveSrc}
          filename={alt || 'image'}
        />
      </>
    );
  }

  if (!standalone) {
    return failed ? (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-muted px-2 py-1 text-xs text-text-muted">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
        {alt.length > 0 ? `Image unavailable · ${alt}` : 'Image unavailable'}
      </span>
    ) : (
      <span
        id={imgProps.id}
        role="status"
        aria-label="Loading image"
        className="inline-block"
      />
    );
  }

  return (
    <span
      id={imgProps.id}
      className={cn(
        'relative inline-block aspect-video w-full max-w-[min(100%,30rem)] overflow-hidden rounded-lg bg-bg-muted/60 border border-border-subtle',
        className
      )}
      style={combinedStyle}
      {...(failed
        ? { role: 'alert' as const }
        : { role: 'status' as const, 'aria-label': 'Loading image' })}
    >
      {failed ? (
        <span className="flex size-full items-center justify-center p-2 text-center text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            {alt.length > 0 ? `Image unavailable · ${alt}` : 'Image unavailable'}
          </span>
        </span>
      ) : effectiveSrc ? (
        <img
          ref={markLoadedIfComplete}
          src={effectiveSrc}
          alt={alt}
          decoding="async"
          draggable={false}
          className="invisible absolute inset-0 size-full"
          {...imageEvents(effectiveSrc)}
        />
      ) : null}
    </span>
  );
}
