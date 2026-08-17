import { useState } from 'react';
import { cn } from '../../lib/utils';

// design-tokens-allow: brand glyphs sit on fixed brand-colour tiles (the inline
// backgroundColor in PluginIcon below) that deliberately never follow the
// theme, so the white glyph fill is part of the artwork, not app chrome.
const BRAND_SVG_CLASS = 'size-5 fill-white';

/**
 * Brand-specific SVG icons for popular plugins.
 */
function getBrandIcon(name: string): { bg: string; svg: React.ReactNode } | null {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  switch (key) {
    case 'github':
      return {
        bg: '#24292e',
        svg: (
          <svg className={BRAND_SVG_CLASS} viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
        )
      };
    case 'gmail':
      return {
        bg: '#ffffff',
        svg: (
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22 6c0-.9-.6-1.7-1.5-1.9L12 10.5 3.5 4.1C2.6 4.3 2 5.1 2 6v12c0 1.1.9 2 2 2h3V10.5l5 3.8 5-3.8V20h3c1.1 0 2-.9 2-2V6z"/>
            <path fill="#EA4335" d="M20.5 4.1L12 10.5 3.5 4.1A2 2 0 014 4h16c.6 0 1.1.3 1.5.8z"/>
          </svg>
        )
      };
    case 'googledrive':
    case 'gdrive':
      return {
        bg: '#ffffff',
        svg: (
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="#FFC107" d="M8.2 2.5l5.5 9.5H2.7L8.2 2.5z"/>
            <path fill="#4CAF50" d="M13.7 12l5.5 9.5H8.2L13.7 12z"/>
            <path fill="#2196F3" d="M19.2 21.5L8.2 2.5h5.5l11 19h-5.5z"/>
          </svg>
        )
      };
    case 'googlecalendar':
    case 'gcalendar':
      return {
        bg: '#ffffff',
        svg: (
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/>
            <text x="12" y="17" fill="#4285F4" fontSize="8" fontWeight="bold" textAnchor="middle">31</text>
          </svg>
        )
      };
    case 'notion':
      return {
        bg: '#000000',
        svg: (
          <svg className={BRAND_SVG_CLASS} viewBox="0 0 24 24">
            <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l11.455-.7c.42 0 .093-.42-.047-.56L16.27 2.062c-.42-.326-.98-.7-2.148-.606L3.339 2.295c-.467.047-.56.327-.373.513l1.493 1.4zm-.233 2.893v13.533c0 .653.373 1.026 1.073.98l13.136-.793c.7-.047.84-.467.84-1.027V6.307c0-.56-.233-.84-.793-.793l-13.463.84c-.56.046-.793.326-.793.747zm11.385 1.54c.093.42 0 .84-.42.887l-.934.186v8.401c-.513.28-.98.42-1.447.42-.747 0-1.074-.233-1.68-.98l-3.874-6.068v5.882l1.213.28c.373.093.467.42.467.793 0 0-.28.187-.84.233l-2.707.187c-.094-.42.046-.793.373-.84l.887-.233V8.828l-1.073-.093c-.093-.42.093-.747.513-.794l2.847-.186 4.108 6.301V8.641l-1.073-.187c-.094-.42.14-.793.56-.84l2.568-.186z"/>
          </svg>
        )
      };
    case 'slack':
      return {
        bg: '#4A154B',
        svg: (
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>
            <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>
            <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/>
            <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
          </svg>
        )
      };
    case 'linear':
      return {
        bg: '#5E6AD2',
        svg: (
          <svg className={BRAND_SVG_CLASS} viewBox="0 0 24 24">
            <path d="M2.5 17.5L9.5 3.5h5L7.5 17.5h-5zm7 3L16.5 6.5h5L14.5 20.5h-5z"/>
          </svg>
        )
      };
    case 'figma':
      return {
        bg: '#1E1E1E',
        svg: (
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="#F24E1E" d="M8 2h4v5H8a2.5 2.5 0 010-5z"/>
            <path fill="#A259FF" d="M8 7h4v5H8a2.5 2.5 0 010-5z"/>
            <path fill="#0ACF83" d="M8 17a2.5 2.5 0 012.5-2.5H12v2.5a2.5 2.5 0 01-5 0z"/>
            <path fill="#FF7262" d="M12 2h3.5a2.5 2.5 0 010 5H12V2z"/>
            <path fill="#1ABCFE" d="M14.5 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/>
          </svg>
        )
      };
    case 'spotify':
      return {
        bg: '#1DB954',
        svg: (
          <svg className={BRAND_SVG_CLASS} viewBox="0 0 24 24">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        )
      };
    case 'postgres':
    case 'postgresql':
      return {
        bg: '#336791',
        svg: (
          <svg className={BRAND_SVG_CLASS} viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.93c-2.83.48-5.33-1.46-5.83-4.32-.47-2.73 1.34-5.32 4.07-5.82 2.76-.5 5.37 1.36 5.86 4.12.51 2.85-1.3 5.54-4.1 6.02z"/>
          </svg>
        )
      };
    case 'sentry':
      return {
        bg: '#362D59',
        svg: (
          <svg className={BRAND_SVG_CLASS} viewBox="0 0 24 24">
            <path d="M13.2 2.6a2 2 0 00-2.4 0L1.7 8.7a2 2 0 00-1 1.7v7.2a2 2 0 001 1.7l9.1 6.1a2 2 0 002.4 0l9.1-6.1a2 2 0 001-1.7V10.4a2 2 0 00-1-1.7L13.2 2.6z"/>
          </svg>
        )
      };
    case 'bravesearch':
    case 'brave':
      return {
        bg: '#FB542B',
        svg: (
          <svg className={BRAND_SVG_CLASS} viewBox="0 0 24 24">
            <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4zm0 4.8c1.86 0 3.44.78 4.6 2.02l-1.68 1.62c-.67-.64-1.57-1.04-2.92-1.04-2.5 0-4.52 2.04-4.52 4.6s2.02 4.6 4.52 4.6c2.88 0 3.96-2.06 4.12-3.14H12v-2.26h6.46c.06.36.1.72.1 1.14 0 3.88-2.6 6.64-6.56 6.64-3.86 0-7-3.14-7-7s3.14-7 7-7z"/>
          </svg>
        )
      };
    default:
      return null;
  }
}

/**
 * A plugin's artwork, with brand SVG or fallback monogram.
 */
export function PluginIcon({
  name,
  iconUrl,
  size = 'md'
}: {
  name: string;
  iconUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const box =
    size === 'sm'
      ? 'size-7 rounded-md text-2xs'
      : size === 'lg'
      ? 'size-12 rounded-2xl text-base'
      : 'size-10 rounded-xl text-sm';

  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        onError={() => setFailed(true)}
        className={cn(box, 'shrink-0 object-cover')}
      />
    );
  }

  const brand = getBrandIcon(name);

  if (brand) {
    return (
      <span
        aria-hidden
        className={cn(box, 'flex shrink-0 items-center justify-center shadow-sm')}
        style={{ backgroundColor: brand.bg }}
      >
        {brand.svg}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        box,
        'flex shrink-0 items-center justify-center bg-bg-hover font-medium uppercase text-text-primary shadow-sm'
      )}
      style={{ backgroundColor: `oklch(0.32 0.08 ${hueFor(name)})` }}
    >
      {name.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?'}
    </span>
  );
}

function hueFor(name: string): number {
  let hash = 0;

  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }

  return hash;
}
