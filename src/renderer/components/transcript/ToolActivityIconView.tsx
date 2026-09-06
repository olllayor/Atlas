import React, { useEffect, useState } from 'react';

import type { ToolActivityIcon, ToolActivitySurface } from '../../../shared/contracts';
import { toolActivityFaviconUrl } from '../../../shared/favicon';
import { buildNativeAppIconUrl } from '../../../shared/nativeAppIconUrl';
import { cn } from '../../lib/utils';
import { BrowserAppIcon } from '../icons/BrowserAppIcon';
import { ComputerUseAppIcon } from '../icons/ComputerUseAppIcon';

function readThemeVariant(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useThemeVariant(): 'light' | 'dark' {
  const [variant, setVariant] = useState<'light' | 'dark'>(readThemeVariant);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setVariant(readThemeVariant()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return variant;
}

const loadedToolActivityIconSrcs = new Map<string, string>();

interface ToolActivityImageIconProps {
  cacheKey: string;
  src: string;
  className?: string;
  muted?: boolean;
  fallback: React.ReactNode;
}

function ToolActivityImageIcon({
  cacheKey,
  src,
  className,
  muted,
  fallback,
}: ToolActivityImageIconProps) {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(
    () => loadedToolActivityIconSrcs.get(cacheKey) ?? null,
  );
  const isLoading = displayedSrc !== src;

  const handleLoadError = (failedSrc: string) => {
    if (loadedToolActivityIconSrcs.get(cacheKey) === failedSrc) {
      loadedToolActivityIconSrcs.delete(cacheKey);
    }
    setDisplayedSrc((currentSrc) => (currentSrc === failedSrc ? null : currentSrc));
  };

  return (
    <>
      {displayedSrc === null ? fallback : null}
      {displayedSrc ? (
        <span
          className={cn(
            'inline-block overflow-hidden rounded-[3px] bg-background',
            className,
            muted && 'opacity-70',
          )}
        >
          <img
            src={displayedSrc}
            alt=""
            aria-hidden
            decoding="async"
            referrerPolicy="no-referrer"
            className={cn(
              'block size-full object-contain',
              muted && '[html[data-theme=light]_&]:brightness-[.6]',
            )}
            onError={() => handleLoadError(displayedSrc)}
          />
        </span>
      ) : null}
      {isLoading ? (
        <img
          src={src}
          alt=""
          aria-hidden
          decoding="async"
          referrerPolicy="no-referrer"
          className="hidden"
          onLoad={() => {
            loadedToolActivityIconSrcs.set(cacheKey, src);
            setDisplayedSrc(src);
          }}
          onError={() => handleLoadError(src)}
        />
      ) : null}
    </>
  );
}

export interface ToolActivityIconViewProps {
  icon?: ToolActivityIcon;
  surface?: ToolActivitySurface;
  fallback?: React.ReactNode;
  className?: string;
  muted?: boolean;
}

export function ToolActivityIconView({
  icon,
  surface,
  fallback,
  className = 'size-4 shrink-0',
  muted = false,
}: ToolActivityIconViewProps) {
  const theme = useThemeVariant();
  const fallbackClassName = cn(
    className,
    muted && 'opacity-70 [html[data-theme=light]_&]:brightness-[.6]',
  );

  const defaultSurfaceFallback =
    surface === 'browser' ? (
      <BrowserAppIcon className={fallbackClassName} />
    ) : surface === 'computer' ? (
      <ComputerUseAppIcon className={fallbackClassName} />
    ) : (
      (fallback ?? null)
    );

  if (!icon) {
    return <>{defaultSurfaceFallback}</>;
  }

  if (icon._tag === 'website') {
    const src = toolActivityFaviconUrl(icon, theme, 32);
    if (!src) return <>{defaultSurfaceFallback}</>;
    return (
      <ToolActivityImageIcon
        key={src}
        cacheKey={src}
        src={src}
        className={className}
        muted={muted}
        fallback={defaultSurfaceFallback}
      />
    );
  }

  if (icon._tag === 'themed-logo') {
    const src = theme === 'dark' ? (icon.logoUrlDark ?? icon.logoUrl) : icon.logoUrl;
    if (!src) return <>{defaultSurfaceFallback}</>;
    return (
      <ToolActivityImageIcon
        key={src}
        cacheKey={src}
        src={src}
        className={className}
        muted={muted}
        fallback={defaultSurfaceFallback}
      />
    );
  }

  if (icon._tag === 'native-app') {
    const src = buildNativeAppIconUrl(icon.app);
    return (
      <ToolActivityImageIcon
        key={src}
        cacheKey={src}
        src={src}
        className={className}
        muted={muted}
        fallback={defaultSurfaceFallback}
      />
    );
  }

  return <>{defaultSurfaceFallback}</>;
}
